"""Public-data-only OpenAI developer judge with an explicit shared spending cap.

No checkpoint weights are exposed by the provider. Pin the published model ID,
request profile and returned model instead of inventing a weight checksum.
Secrets stay in memory; only public judgments and usage metadata are saved.
"""
import argparse
from contextlib import contextmanager
from decimal import Decimal
import json
import os
from pathlib import Path
import re
import sys
from urllib.request import Request,build_opener,ProxyHandler,HTTPRedirectHandler
from urllib.error import HTTPError,URLError
from common import digest,read,write,execution_stamp,require_unchanged,output_path
from judge import validate
from judge_protocol import INSTRUCTION,GRAMMAR_AWARE_INSTRUCTION,DEFECTS,document_json
from judge_server import canonical_payload,restore_labels

ENDPOINT='https://api.openai.com/v1/'
PRICES={'gpt-6-luna':('0.1','0.5'),'gpt-6.1-sol':('2','10'),'gpt-6-astra':('10','50')}
SCHEMA={'type':'object','properties':{
    'winner':{'type':'string','enum':['A','B','tie','abstain']},'defects':DEFECTS},
    'required':['winner','defects'],'additionalProperties':False}


class Unavailable(RuntimeError):pass
class BudgetExceeded(Unavailable):pass


def implementation():
    result={}
    for name in ('cloud_judge.py','judge.py','judge_protocol.py','judge_server.py','common.py'):
        result.update(execution_stamp(Path(__file__).with_name(name)))
    return result


def identity(profile):
    allowed=[{'model':'gpt-6.1-sol','reasoningEffort':'low','maxOutputTokens':2048},
             {'model':'gpt-6.1-sol','reasoningEffort':'low','maxOutputTokens':2048,'maxInputTokens':2048,'editorialRubric':'grammar-aware-v1'},
             {'model':'gpt-6-luna','reasoningEffort':'medium','maxOutputTokens':2048,'maxInputTokens':2048,'editorialRubric':'grammar-aware-v1'},
             {'model':'gpt-6-luna','reasoningEffort':'medium','maxOutputTokens':2048,'maxInputTokens':2048}]
    if profile not in allowed:
        raise ValueError('Use the separately frozen initial OpenAI profile.')
    return {'provider':'OpenAI','model':profile['model'],'profile':profile,
        'modelWeightsSHA256':None,'identityKind':'published-provider-model-and-request-profile',
        'instructionSHA256':digest(instruction(profile)),'schemaSHA256':digest(SCHEMA),
        'implementationSHA256':digest(implementation()),'ordering':'canonical-pair-v1',
        'orderStability':'Structural cache symmetry; not intrinsic editorial order robustness.',
        'reproducibilityLimitation':'Provider weights and an immutable dated snapshot are not published; no weight identity claim.'}


def instruction(profile):
    selected=profile.get('editorialRubric')
    if selected not in (None,'grammar-aware-v1'):raise ValueError('Unknown editorial rubric.')
    return GRAMMAR_AWARE_INSTRUCTION if selected else INSTRUCTION


def load_key(path):
    # Never print the file, matching lines, a key prefix or exception text.
    content=Path(path).read_text('utf-8-sig')
    keys={m.group() for m in re.finditer(r'\bsk-(?!ant-)[A-Za-z0-9_-]{20,}',content)}
    if len(keys)!=1:raise ValueError('Expected one unambiguous existing OpenAI credential.')
    return next(iter(keys))


def authorize(payload,permit,profile_identity):
    if set(payload)!={'source','context','dialect','profile','A','B','rubric'}:
        raise ValueError('Unexpected grader payload fields.')
    if (permit.get('protocol')!='alder-public-cloud-inputs-v1' or permit.get('publicDataOnly') is not True
            or permit.get('modelIdentitySHA256')!=digest(profile_identity)
            or any(not isinstance(payload[k],str) for k in ('source','context','dialect','profile','A','B'))):
        raise ValueError('Use an unchanged public-data permit and model profile.')
    canonical,swapped=canonical_payload(payload)
    if digest(canonical) not in permit.get('allowedCanonicalPayloads',[]):
        raise ValueError('This input is not in the authorized public benchmark.')
    return canonical,swapped


def request_body(payload,profile):
    return {'model':profile['model'],'instructions':instruction(profile),
        'input':[{'role':'user','content':document_json(payload)}],
        'reasoning':{'effort':profile['reasoningEffort']},
        'text':{'format':{'type':'json_schema','name':'grammar_judgment','strict':True,'schema':SCHEMA}},
        'max_output_tokens':profile['maxOutputTokens'],'store':False,'tools':[],
        'service_tier':'default','truncation':'disabled'}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise Unavailable('Redirect disabled.')


def post(resource,body,key):
    if resource not in ('responses','responses/input_tokens'):raise ValueError('Unexpected API resource.')
    opener=build_opener(ProxyHandler({}),NoRedirect())
    request=Request(ENDPOINT+resource,data=json.dumps(body,ensure_ascii=False).encode('utf8'),
                    headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    try:
        with opener.open(request,timeout=180) as stream:
            content=stream.read(2_000_001)
            if len(content)>2_000_000:raise Unavailable('Oversized API response.')
            return json.loads(content)
    except (HTTPError,URLError,TimeoutError,OSError):
        # Error bodies can reflect credential fragments. Do not inspect/log them.
        raise Unavailable('API request unavailable.') from None


@contextmanager
def locked(path):
    output_path(path);lock=Path(str(path)+'.lock');lock.parent.mkdir(parents=True,exist_ok=True)
    with lock.open('a+b') as stream:
        stream.seek(0,2)
        if stream.tell()==0:stream.write(b'\0');stream.flush()
        stream.seek(0)
        try:
            if sys.platform=='win32':
                import msvcrt
                msvcrt.locking(stream.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError:raise Unavailable('Another budgeted request is active.') from None
        try:yield
        finally:
            stream.seek(0)
            if sys.platform=='win32':msvcrt.locking(stream.fileno(),msvcrt.LK_UNLCK,1)
            else:fcntl.flock(stream.fileno(),fcntl.LOCK_UN)


def cost(model,input_tokens,output_tokens):
    if any(type(n) is not int or n<0 for n in (input_tokens,output_tokens)):
        raise ValueError('Invalid usage counts.')
    price_in,price_out=map(Decimal,PRICES[model])
    # Conservatively cover even the published 12-hour cache-write input rate.
    # This is an accounted upper bound, not a claim about the final API invoice.
    return (price_in*Decimal('2.5')*input_tokens+price_out*output_tokens)/Decimal(1_000_000)


def reserve(budget,profile_identity,input_tokens,request_sha):
    if (budget.get('protocol')!='alder-openai-spend-v1' or budget.get('approved') is not True
            or budget.get('publicDataOnly') is not True
            or digest(profile_identity) not in budget.get('allowedModelIdentities',[])):
        raise BudgetExceeded('No approved budget for this profile.')
    limit=Decimal(budget['limitUSD'])
    if not limit.is_finite() or limit<=0:raise BudgetExceeded('Use a finite positive approved cap.')
    profile=profile_identity['profile'];upper=cost(profile['model'],input_tokens+256,profile['maxOutputTokens'])
    used=sum((Decimal(event.get('settledUSD') or event['reservedUSD']) for event in budget['events']),Decimal(0))
    if used+upper>limit:raise BudgetExceeded('Approved spending cap reached.')
    event={'requestSHA256':request_sha,'model':profile['model'],'inputTokensCounted':input_tokens,
           'reservationInputSlackTokens':256,'reservedUSD':str(upper),'settledUSD':None,'status':'reserved',
           'accounting':'Conservative upper bound; all input at maximum published cache-write rate, no cache savings assumed.'}
    budget['events'].append(event);return event


def settle(event,response,profile):
    usage=response.get('usage')
    if not isinstance(usage,dict):return  # Unknown charges retain the entire reservation.
    actual=cost(profile['model'],usage.get('input_tokens'),usage.get('output_tokens'))
    if actual>Decimal(event['reservedUSD']):
        raise ValueError('Reported usage exceeded its counted-input/output reservation.')
    event.update(settledUSD=str(actual),status='usage-recorded',responseID=response.get('id'),
                 reportedModel=response.get('model'),responseStatus=response.get('status'),
                 inputTokens=usage['input_tokens'],outputTokens=usage['output_tokens'])


def public_judgment(response,payload,profile):
    if response.get('model')!=profile['model'] or response.get('status')!='completed':
        raise ValueError('Incomplete response or changed provider model.')
    parts=[]
    for item in response.get('output',[]):
        if item.get('type')!='message':continue  # Do not inspect private/other output items.
        if item.get('role')!='assistant' or item.get('status')!='completed':raise ValueError('Invalid final message.')
        for part in item.get('content',[]):
            if part.get('type')!='output_text':raise ValueError('No usable public judgment.')
            parts.append(part['text'])
    if len(parts)!=1:raise ValueError('Expected one public structured judgment.')
    value=json.loads(parts[0]);validate(value,payload['source'],payload['A'],payload['B'])
    return value


def evaluate(payload,profile,permit,budget_path,cache_directory,key_file,transport=post):
    code=implementation();profile_identity=identity(profile)
    canonical,swapped=authorize(payload,permit,profile_identity)
    key=digest([profile_identity,canonical]);cache=output_path(Path(cache_directory)/(key+'.json'))
    with locked(budget_path):
        budget=read(budget_path)
        # Even cache replay needs an approved scope; it cannot bypass the permit.
        if budget.get('approved') is not True:raise BudgetExceeded('Budget approval is required.')
        if cache.exists():
            saved=read(cache)
            if saved['modelIdentitySHA256']!=digest(profile_identity) or saved['payloadSHA256']!=digest(canonical):
                raise ValueError('Cached profile/input identity differs.')
            validate(saved['judgment'],canonical['source'],canonical['A'],canonical['B'])
            return restore_labels(saved['judgment'],swapped)
        body=request_body(canonical,profile);secret=load_key(key_file)
        count_body={k:v for k,v in body.items() if k in ('model','instructions','input','reasoning','text','tools','truncation')}
        counted=transport('responses/input_tokens',count_body,secret)
        if counted.get('object')!='response.input_tokens':raise ValueError('Input-count preflight failed.')
        if (type(counted.get('input_tokens')) is not int or counted['input_tokens']<0
                or counted['input_tokens']>profile.get('maxInputTokens',4096)):
            raise ValueError('Full input exceeds the frozen limit; no truncation or paid inference.')
        event=reserve(budget,profile_identity,counted.get('input_tokens'),key)
        write(budget_path,budget);require_unchanged(code)
        # Persist the full upper bound before the billable request. Unknown
        # failures keep it reserved and never trigger an automatic retry.
        response=transport('responses',body,secret)
        settle(event,response,profile);write(budget_path,budget)
        require_unchanged(code)
        if response.get('model')!=profile['model']:raise Unavailable('Provider model identity changed.')
        failure=None
        try:value=public_judgment(response,canonical,profile)
        except (ValueError,KeyError,TypeError):
            # A bounded model failure is an abstention, memoized in both orders.
            # It must not turn the swapped-order check into another paid retry.
            value={'winner':'abstain','defects':[]};failure='UnusablePublicJudgment'
        write(cache,{'modelIdentitySHA256':digest(profile_identity),'payloadSHA256':digest(canonical),
            'judgment':value,'publicFailure':failure,'responseID':response.get('id'),'usage':{
                'inputTokens':event.get('inputTokens'),'outputTokens':event.get('outputTokens')},
            'scope':'Public judgment and usage only; no private generated content or secrets.'})
        return restore_labels(value,swapped)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('profile','permit','budget','cache-directory','key-file'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--preflight',action='store_true');args=parser.parse_args()
    sys.stdin.reconfigure(encoding='utf8',errors='strict');sys.stdout.reconfigure(encoding='utf8',errors='strict')
    try:
        profile=read(args.profile)
        if args.preflight:
            load_key(args.key_file)
            print(json.dumps(identity(profile)));return 0
        content=sys.stdin.read(65537)
        if len(content)>65536:raise ValueError('Payload exceeds the fixed limit.')
        value=evaluate(json.loads(content),profile,read(args.permit),Path(args.budget),
                       Path(args.cache_directory),Path(args.key_file))
        print(json.dumps(value,ensure_ascii=False));return 0
    except Exception as error:
        print(json.dumps({'failure':type(error).__name__,'phase':'cloud-judge'}),file=sys.stderr)
        return 75 if isinstance(error,(Unavailable,OSError)) else 1


if __name__=='__main__':raise SystemExit(main())
