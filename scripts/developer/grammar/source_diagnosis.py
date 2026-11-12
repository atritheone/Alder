"""One-pass source-defect diagnosis ablation; never an independent quality judge."""
import ast
import copy
import json
from pathlib import Path
from judge_protocol import representable_quote_spans

DIAGNOSIS_INSTRUCTION=(
 ' Before constructing a revision, identify one specific defect in the original target. '
 'A different correct wording or stylistic preference alone is not a defect. '
 'If the target is already grammatical, natural and clear, choose issueType none, evidence empty '
 'and corrected empty; this means leave the target exactly unchanged. '
 'Otherwise choose spelling, grammar, punctuation or structure, quote an exact source span '
 'exhibiting the defect, then provide the complete corrected target. Evidence locates the defect; '
 'it never narrows the target. Include every surrounding clause, speech tag and already-correct '
 'detail from the original target; never return only the edited evidence fragment. Structural reconstruction '
 'remains allowed when it fixes an actual awkward construction. All previous preservation '
 'and read-only context constraints still apply. Return fields in order: issueType, evidence, corrected.'
)


def diagnosis_schema(text):
    spans=representable_quote_spans(text)
    return {'oneOf':[
      {'type':'object','properties':{'issueType':{'type':'string','enum':['none']},
        'evidence':{'type':'string','enum':['']},'corrected':{'type':'string','enum':['']}},
       'required':['issueType','evidence','corrected'],'additionalProperties':False},
      {'type':'object','properties':{'issueType':{'type':'string','enum':['spelling','grammar','punctuation','structure']},
        'evidence':{'type':'string','enum':spans},'corrected':{'type':'string'}},
       'required':['issueType','evidence','corrected'],'additionalProperties':False}]}


def decode_diagnosis(value,text):
    if not isinstance(value,dict) or set(value)!={'issueType','evidence','corrected'}:
        raise ValueError('Invalid source-diagnosis fields.')
    if value['issueType']=='none':
        if value['evidence']!='' or value['corrected']!='':raise ValueError('An unchanged diagnosis cannot carry an edit.')
        return text
    if value['issueType'] not in ('spelling','grammar','punctuation','structure') or value['evidence'] not in representable_quote_spans(text):
        raise ValueError('Source diagnosis needs exact representable source evidence.')
    if not isinstance(value['corrected'],str) or not value['corrected'].strip() or len(value['corrected'])>2400:
        raise ValueError('Invalid diagnosed revision.')
    return value['corrected']


def render_worker(source,trace_path,*,rule_guided=False):
    """Render a standalone isolated worker; never edit the production source."""
    from common import output_path
    trace=output_path(trace_path)
    tree=ast.parse(source);counts={'base':0,'prompt':0,'decode':0}
    helpers=ast.parse(Path(__file__).read_text('utf-8'))
    protocol=ast.parse(Path(__file__).with_name('judge_protocol.py').read_text('utf-8'))
    inline=[ast.Import(names=[ast.alias(name='hashlib')])]
    inline.extend(copy.deepcopy(node) for node in protocol.body if isinstance(node,ast.FunctionDef) and node.name in ('quote_spans','representable_quote_spans'))
    inline.extend(copy.deepcopy(node) for node in helpers.body if
      isinstance(node,ast.FunctionDef) and node.name in ('diagnosis_schema','decode_diagnosis') or
      isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='DIAGNOSIS_INSTRUCTION' for target in node.targets))
    class Worker(ast.NodeTransformer):
        def visit_Assign(self,node):
            if len(node.targets)!=1 or not isinstance(node.targets[0],ast.Name):return node
            name=node.targets[0].id
            if name=='grammar':
                if not isinstance(node.value,ast.Call) or ast.unparse(node.value.func)!='LlamaGrammar.from_json_schema':
                    raise ValueError('Unexpected worker grammar construction.')
                counts['base']+=1;node.targets[0].id='base_grammar';return node
            if name=='prompt':
                counts['prompt']+=1
                condition="request.get('task')=='revise' and request.get('revisionMode')!='rephrase' and not request.get('spellingRepair')"
                if rule_guided:condition+=" and not request.get('spellingIssues')"
                prelude=ast.parse('diagnosing='+condition+'\n'+
                  "if diagnosing:\n    system+=DIAGNOSIS_INSTRUCTION\n    grammar=LlamaGrammar.from_json_schema(json.dumps(diagnosis_schema(text)),verbose=False)\n"
                  "else:\n    grammar=base_grammar\n").body
                return [*prelude,node]
            if name=='corrected':
                counts['decode']+=1
                if ast.unparse(node.value)!='json.loads(output[\'choices\'][0][\'text\'])[\'corrected\']':
                    raise ValueError('Unexpected production worker decoding contract.')
                return ast.parse("assessment=json.loads(output['choices'][0]['text'])\n"
                  "corrected=decode_diagnosis(assessment,text) if diagnosing else assessment['corrected']\n"
                  "if diagnosing:\n"
                  f"    with open({str(trace)!r},'a',encoding='utf-8') as stream:\n"
                  "        stream.write(json.dumps({'requestID':request.get('id'),'sourceSHA256':hashlib.sha256(text.encode('utf-8')).hexdigest(),"
                  "'source':text,'assessment':assessment,'proposal':corrected},ensure_ascii=False)+'\\n')\n").body
            return node
    Worker().visit(tree)
    if counts!={'base':1,'prompt':1,'decode':1}:raise ValueError('Shipping worker changed; inspect the diagnosis ablation.')
    tree.body[1:1]=inline
    return ast.unparse(ast.fix_missing_locations(tree))+'\n'
