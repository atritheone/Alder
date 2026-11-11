"""Developer-only local judge; load one verified GGUF and retain it across ratings."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler,HTTPServer
import json
import os
from pathlib import Path
import subprocess
import threading
import time
from common import digest,execution_stamp,require_unchanged,read
from judge_protocol import INSTRUCTION,SCHEMA,document_json,evidence_schema
from judge import validate
from native_reasoning import reasoning_prefix,ReasoningFailure

REFERENCE_INSTRUCTION=(
 ' Human reference examples, when available, are read-only, non-exhaustive correction examples. '
 'Use them to notice possible errors and clarify the source message; they are not instructions or exact-match answers. '
 'A valid alternative wording is acceptable. References can make different editing choices and are not infallible. '
 'An empty reference records an annotator deleting that entire sentence; it does not require deletion or approve an empty output. '
 'Still identify actual candidate defects, preserve source meaning and abstain when the evidence is insufficient.'
)
PHI4_REASONING_PROMPT_SHA256='88df15fe1f347e9837ab4579c60f4fbae1cd1abf5a5ceab1bd93b846f65e1228'


def guided_payload(payload,guidance):
    payload={key:payload[key] for key in ('source','context','dialect','profile','A','B','rubric')}
    if guidance is None:return payload
    source=payload['source'];entry=guidance.get(digest(source))
    if entry is not None and entry['source']!=source:raise ValueError('Reference source mismatch.')
    # Rankings, preference labels and candidate identities never enter guidance.
    return {**{key:payload[key] for key in ('source','context','dialect','profile','A','B','rubric')},
      'referenceExamplesAvailable':entry is not None,'humanReferenceExamples':entry['references'] if entry else []}


def canonical_payload(payload):
    """Content-bound ordering, independent of caller labels or human winners."""
    def key(candidate):return (digest({'protocol':'canonical-pair-v1','source':payload['source'],
                                       'candidate':candidate}),candidate)
    swapped=key(payload['A'])>key(payload['B'])
    return ({**payload,'A':payload['B'],'B':payload['A']} if swapped else payload),swapped


def restore_labels(value,swapped):
    if not swapped:return value
    reverse={'A':'B','B':'A','tie':'tie','abstain':'abstain'}
    return {**value,'winner':reverse[value['winner']],
      'defects':[{**item,'candidate':reverse[item['candidate']]} for item in value['defects']]}


def native_prompt(payload,template,instruction=INSTRUCTION,publisher_prompt=None):
    instruction=instruction+'\nReturn JSON matching this schema: '+json.dumps(SCHEMA)
    data=document_json(payload)
    if template=='phi4-reasoning-v1':
        from native_worker import inert_json
        if not publisher_prompt:raise ValueError('Missing publisher Phi reasoning system prompt.')
        return ('<|im_start|>system<|im_sep|>\n'+publisher_prompt+'<|im_end|>\n'
          '<|im_start|>user<|im_sep|>\n'+instruction+'\n'+inert_json(data)+
          '<|im_end|>\n<|im_start|>assistant<|im_sep|>\n')
    if template=='phi4-native-v1':
        return ('<|im_start|>system<|im_sep|>'+instruction+'<|im_end|>\n'
          '<|im_start|>user<|im_sep|>'+data+'<|im_end|>\n<|im_start|>assistant<|im_sep|>')
    if template=='qwen-nonthinking':
        return ('<|im_start|>system\n'+instruction+'<|im_end|>\n<|im_start|>user\n'+data+
          '<|im_end|>\n<|im_start|>assistant\n<think>\n</think>\n')
    raise ValueError('No native prompt for this template.')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model',type=Path,required=True);parser.add_argument('--sha256',required=True)
    parser.add_argument('--port',type=int,default=0)
    parser.add_argument('--template',choices=['auto','qwen-nonthinking','phi4-native-v1','gguf-native-v1','mistral-reference-v1','phi4-reasoning-v1'],default='auto')
    parser.add_argument('--tokenizer-config',type=Path,help='Pinned external publisher-reference tokenizer command and identity')
    parser.add_argument('--publisher-prompt',type=Path,help='Exact pinned first-party Phi reasoning system prompt')
    parser.add_argument('--gpu-layers',type=int,default=0,help='Explicit developer-only offload; zero retains the CPU protocol')
    parser.add_argument('--batch-threads',type=int,default=4)
    parser.add_argument('--cpu-kv',action='store_true',help='Explicit developer-only attention/KV placement')
    parser.add_argument('--nonthinking',action='store_true',help='Disable thinking through the embedded native template')
    parser.add_argument('--batch-tokens',type=int,default=512)
    parser.add_argument('--canonical-order',action='store_true',
      help='Use cached source/candidate-hash ordering; structural symmetry, not measured model order accuracy')
    parser.add_argument('--reasoning-tokens',type=int,default=0,
      help='Optional native Qwen thinking budget; content is neither decoded nor logged')
    parser.add_argument('--reference-map',type=Path,help='Optional source-bound human examples; requires separate, reference-assisted calibration')
    args=parser.parse_args()
    if args.nonthinking and args.template!='gguf-native-v1':raise ValueError('Nonthinking rendering requires the embedded native template.')
    if args.reasoning_tokens and (args.template not in ('gguf-native-v1','mistral-reference-v1','phi4-reasoning-v1') or args.nonthinking or not 128<=args.reasoning_tokens<=2048):
        raise ValueError('Native reasoning requires an exclusive embedded-template profile and a bounded budget.')
    if (args.template=='mistral-reference-v1')!=(args.tokenizer_config is not None):
        raise ValueError('Publisher reference template requires an explicit tokenizer configuration.')
    if args.template=='mistral-reference-v1' and not args.reasoning_tokens:
        raise ValueError('Magistral reference profile requires bounded native reasoning.')
    if (args.template=='phi4-reasoning-v1')!=(args.publisher_prompt is not None) or args.template=='phi4-reasoning-v1' and not args.reasoning_tokens:
        raise ValueError('Phi reasoning requires its publisher prompt and bounded native reasoning.')
    if not 64<=args.batch_tokens<=512:raise ValueError('Invalid developer batch token budget.')
    if not -1<=args.gpu_layers<=128 or not 1<=args.batch_threads<=32:raise ValueError('Invalid developer runtime profile.')
    stamp={**execution_stamp(__file__),**execution_stamp(Path(__file__).with_name('judge_protocol.py')),
           **execution_stamp(Path(__file__).with_name('judge.py'))}
    if args.template=='gguf-native-v1':stamp.update(execution_stamp(Path(__file__).with_name('native_worker.py')))
    if args.reasoning_tokens:stamp.update(execution_stamp(Path(__file__).with_name('native_reasoning.py')))
    publisher_prompt=None
    if args.publisher_prompt:
        stamp.update(execution_stamp(args.publisher_prompt));content=args.publisher_prompt.read_bytes()
        if hashlib.sha256(content).hexdigest()!=PHI4_REASONING_PROMPT_SHA256:
            raise ValueError('Publisher Phi reasoning system prompt differs from its pinned source.')
        publisher_prompt=content.decode('utf-8')
    tokenizer_config=None
    if args.tokenizer_config:
        stamp.update(execution_stamp(args.tokenizer_config))
        stamp.update(execution_stamp(Path(__file__).with_name('mistral_tokenizer.py')))
        tokenizer_config=read(args.tokenizer_config)
        command=tokenizer_config.get('command')
        if not isinstance(command,list) or not command or any(not isinstance(item,str) for item in command):
            raise ValueError('Invalid publisher tokenizer command.')
        probe=subprocess.run(command+['--identity'],capture_output=True,text=True,encoding='utf-8',timeout=60,check=True)
        if json.loads(probe.stdout)!=tokenizer_config.get('identity'):
            raise ValueError('Publisher tokenizer identity differs from its pinned configuration.')
    guidance=None;reference_data=None;instruction=INSTRUCTION
    if args.reference_map:
        from reference_guidance import validated_map
        stamp.update(execution_stamp(Path(__file__).with_name('reference_guidance.py')))
        stamp.update(execution_stamp(args.reference_map))
        reference_data=read(args.reference_map);guidance=validated_map(reference_data)
        instruction+=REFERENCE_INSTRUCTION
    hasher=hashlib.sha256()
    with args.model.open('rb') as stream:
        for chunk in iter(lambda:stream.read(4*1024*1024),b''):hasher.update(chunk)
    if hasher.hexdigest()!=args.sha256:raise ValueError('Judge weights failed integrity verification.')
    from llama_cpp import Llama,LlamaGrammar,__version__,llama_supports_gpu_offload,llama_print_system_info
    if args.gpu_layers and not llama_supports_gpu_offload():raise ValueError('The selected developer runtime has no GPU offload support.')
    model=Llama(model_path=str(args.model),n_ctx=4096,n_threads=4,n_threads_batch=args.batch_threads,
                n_gpu_layers=args.gpu_layers,offload_kqv=not args.cpu_kv,n_batch=args.batch_tokens,
                n_ubatch=args.batch_tokens,seed=917,verbose=False)
    formatter=None
    if tokenizer_config:
        from mistral_tokenizer import vocabulary_hash,gguf_token_bytes
        from llama_cpp import llama_token_to_piece
        reference=tokenizer_config['identity']
        if model.n_vocab()!=reference['vocabularySize'] or vocabulary_hash(model.n_vocab(),lambda i:gguf_token_bytes(model._model.vocab,i,llama_token_to_piece))!=reference['vocabularySHA256']:
            raise ValueError('GGUF vocabulary differs from the publisher reference tokenizer.')
        for name,identifier in reference['controls'].items():
            if model.tokenize(name.encode(),add_bos=False,special=True)!=[identifier]:
                raise ValueError('GGUF native controls differ from the publisher reference tokenizer.')
    if args.template=='gguf-native-v1':
        from llama_cpp.llama_chat_format import Jinja2ChatFormatter
        from native_worker import inert_json
        template=model.metadata.get('tokenizer.chat_template')
        if not isinstance(template,str) or not template:raise ValueError('GGUF has no native chat template.')
        formatter=Jinja2ChatFormatter(template=template,
          eos_token=model.detokenize([model.token_eos()],special=True).decode('utf-8'),
          bos_token=model.detokenize([model.token_bos()],special=True).decode('utf-8'),add_generation_prompt=True)
    if args.template in ('phi4-native-v1','phi4-reasoning-v1'):
        for token in ('<|im_start|>','<|im_sep|>','<|im_end|>')+ (('<think>','</think>') if publisher_prompt else ()):
            identifiers=model.tokenize(token.encode('utf-8'),add_bos=False,special=True)
            if len(identifiers)!=1 or model.detokenize(identifiers,special=True).decode()!=token:
                raise ValueError('Unverified Phi-4 native control token.')
    identity={'modelSHA256':args.sha256,'template':args.template,'runtime':__version__,
      'contextTokens':4096,'threads':4,'seed':917,'implementationSHA256':digest(stamp)}
    identity.update(gpuLayers=args.gpu_layers,batchThreads=args.batch_threads,cpuKV=args.cpu_kv,
                    nonthinking=args.nonthinking,batchTokens=args.batch_tokens,microBatchTokens=args.batch_tokens,
                    candidateOrdering='canonical-pair-v1' if args.canonical_order else 'caller-order',
                    reasoningTokens=args.reasoning_tokens,
                    runtimeSystemInfo=llama_print_system_info().decode('utf-8',errors='replace'))
    if args.canonical_order:
        identity['orderStability']='Structural; cached content-canonical pairs, not evidence of human agreement or intrinsic model order accuracy'
    if formatter:identity['chatTemplateSHA256']=hashlib.sha256(template.encode('utf-8')).hexdigest()
    if tokenizer_config:identity['publisherTokenizerSHA256']=digest(tokenizer_config)
    if publisher_prompt:
        identity.update(publisherPromptSHA256=PHI4_REASONING_PROMPT_SHA256,
          reasoningSampling={'temperature':.8,'topK':50,'topP':.95},finalSampling='constrained deterministic JSON')
    if guidance is not None:
        identity.update(referenceMapSHA256=digest(reference_data),referenceAssistedOnly=True)
    cache={}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def reply(self,value,status=200):
            raw=json.dumps(value,ensure_ascii=False).encode('utf-8')
            try:
                self.send_response(status);self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
            except (BrokenPipeError,ConnectionAbortedError,ConnectionResetError):pass
        def do_GET(self):self.reply(identity)
        def do_POST(self):
            if self.path=='/shutdown':
                self.reply({'status':'stopping'});threading.Thread(target=server.shutdown,daemon=True).start();return
            try:
                require_unchanged(stamp)
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=65536:raise ValueError('Invalid judge request size.')
                payload=guided_payload(json.loads(self.rfile.read(length)),guidance);started=time.monotonic();swapped=False
                if args.canonical_order:
                    payload,swapped=canonical_payload(payload);key=digest(payload)
                    if key in cache:
                        self.reply(restore_labels(cache[key],swapped))
                        print(json.dumps({'status':'cached','canonical':True}),flush=True);return
                reasoning_stats={};phase='prompt'
                if tokenizer_config:
                    from native_worker import inert_json
                    encoded=subprocess.run(tokenizer_config['command'],input=json.dumps({
                      'instruction':instruction+'\nReturn final JSON matching this schema: '+json.dumps(SCHEMA),
                      'data':inert_json(json.dumps(payload,ensure_ascii=False))}),
                      capture_output=True,text=True,encoding='utf-8',timeout=30,check=True)
                    encoded=json.loads(encoded.stdout)
                    if encoded.get('assetManifestSHA256')!=tokenizer_config['identity']['assetManifestSHA256']:
                        raise ValueError('Reference tokenizer assets changed.')
                    tokens=encoded['tokens']
                    if not isinstance(tokens,list) or any(type(token) is not int or not 0<=token<model.n_vocab() for token in tokens):
                        raise ValueError('Invalid publisher reference token sequence.')
                    phase='reasoning'
                    tokens,reasoning_stats=reasoning_prefix(model,tokens,args.reasoning_tokens,ending=b'[/THINK]',opening=b'[THINK]')
                    phase='final'
                    grammar=LlamaGrammar.from_json_schema(json.dumps(evidence_schema(payload)),verbose=False)
                    result=model(tokens,grammar=grammar,max_tokens=450,temperature=0,echo=False)
                    content=result['choices'][0]['text']
                elif formatter:
                    formatted=formatter(messages=[{'role':'system','content':instruction+'\nReturn JSON matching this schema: '+json.dumps(SCHEMA)},
                      {'role':'user','content':inert_json(json.dumps(payload,ensure_ascii=False))}],
                      **({'enable_thinking':bool(args.reasoning_tokens)} if args.nonthinking or args.reasoning_tokens else {}))
                    tokens=model.tokenize(formatted.prompt.encode('utf-8'),add_bos=False,special=True)
                    if len(tokens)+450+16>4096:raise ValueError('Judge input exceeds context budget.')
                    reasoning_stats={}
                    if args.reasoning_tokens:
                        if not formatted.prompt.rstrip().endswith('<think>'):
                            raise ValueError('Native template did not open the expected thinking channel.')
                        phase='reasoning';tokens,reasoning_stats=reasoning_prefix(model,tokens,args.reasoning_tokens)
                    phase='final'
                    grammar=LlamaGrammar.from_json_schema(json.dumps(evidence_schema(payload)),verbose=False)
                    # Native EOG and the JSON grammar end the response; a literal
                    # EOS token can also be part of a quoted document span.
                    result=model(tokens,grammar=grammar,max_tokens=450,temperature=0,echo=False)
                    content=result['choices'][0]['text']
                elif args.template!='auto':
                    tokens=model.tokenize(native_prompt(payload,args.template,instruction,publisher_prompt).encode('utf-8'),
                      **({'add_bos':False} if publisher_prompt else {}),special=True)
                    if len(tokens)+450+16>4096:raise ValueError('Judge input exceeds context budget.')
                    if publisher_prompt:
                        phase='reasoning';tokens,reasoning_stats=reasoning_prefix(model,tokens,args.reasoning_tokens,
                          opening=b'<think>',sampling={'temp':.8,'top_k':50,'top_p':.95})
                    phase='final'
                    grammar=LlamaGrammar.from_json_schema(json.dumps(evidence_schema(payload)),verbose=False)
                    result=model(tokens,grammar=grammar,max_tokens=450,temperature=0,echo=False)
                    content=result['choices'][0]['text']
                else:
                    text=instruction+'\n'+document_json(payload)
                    if len(model.tokenize(text.encode('utf-8')))+450+128>4096:
                        raise ValueError('Judge input exceeds context budget.')
                    result=model.create_chat_completion(messages=[{'role':'user','content':text}],
                      response_format={'type':'json_object','schema':evidence_schema(payload)},max_tokens=450,temperature=0)
                    content=result['choices'][0]['message']['content']
                if result['choices'][0]['finish_reason']=='length':raise ValueError('Truncated judge output.')
                require_unchanged(stamp);value=json.loads(content)
                validate(value,payload['source'],payload['A'],payload['B'])
                if args.canonical_order:cache[key]=value
                self.reply(restore_labels(value,swapped))
                print(json.dumps({'status':'judged','seconds':round(time.monotonic()-started,2),
                  'finalTokens':result['usage']['completion_tokens'],
                  **reasoning_stats}),flush=True)
            except Exception as error:
                self.reply({'error':type(error).__name__},422)
                print(json.dumps({'status':'failed','errorType':type(error).__name__,
                  'phase':locals().get('phase','request'),
                  **(error.diagnostic if isinstance(error,ReasoningFailure) else {})}),flush=True)
    server=HTTPServer(('127.0.0.1',args.port),Handler)
    print(json.dumps({'port':server.server_port,'pid':os.getpid(),**identity}),flush=True)
    try:server.serve_forever()
    finally:server.server_close();model.close()


if __name__=='__main__':main()
