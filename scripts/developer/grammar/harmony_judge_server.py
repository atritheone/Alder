"""Local gpt-oss judge with native Harmony reasoning and constrained final JSON.

Private generated content remains token IDs and is never decoded or logged.
Only a naturally reached final header permits constrained public JSON output.
"""
import argparse
import hashlib
from judge_http import create_server
import json
from pathlib import Path
import time
from common import digest,execution_stamp,require_unchanged
from harmony_native import final_prefix
from native_reasoning import ReasoningFailure
from judge import validate
from judge_server import canonical_payload,restore_labels
from judge_protocol import INSTRUCTION,GRAMMAR_AWARE_INSTRUCTION,SCHEMA,document_json,evidence_schema


def prompt(payload,effort,instruction=INSTRUCTION):
    system=('You are ChatGPT, a large language model trained by OpenAI.\n'
      'Knowledge cutoff: 2024-06\nReasoning: '+effort+'\n'
      '# Valid channels: analysis, commentary, final. Channel must be included for every message.')
    developer='# Instructions\n'+instruction+'\n\n# Response Formats\n## grammar_judgment\n'+json.dumps(SCHEMA)
    # Prevent literal document delimiters from becoming actual role boundaries.
    data=document_json(payload)
    return ('<|start|>system<|message|>'+system+'<|end|>'
      '<|start|>developer<|message|>'+developer+'<|end|>'
      '<|start|>user<|message|>'+data+'<|end|><|start|>assistant')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model',type=Path,required=True);parser.add_argument('--sha256',required=True)
    parser.add_argument('--port',type=int,default=0);parser.add_argument('--reasoning',choices=['low','medium','high'],default='low')
    parser.add_argument('--reasoning-tokens',type=int,default=1200)
    parser.add_argument('--context-tokens',type=int,choices=[4096,8192,12288,16384],default=4096)
    parser.add_argument('--gpu-layers',type=int,default=0);parser.add_argument('--batch-threads',type=int,default=4)
    parser.add_argument('--cpu-kv',action='store_true');parser.add_argument('--canonical-order',action='store_true')
    parser.add_argument('--request-timeout',type=float,default=450)
    parser.add_argument('--grammar-aware',action='store_true',help='Separate grammatical-repair-aware research rubric')
    args=parser.parse_args()
    instruction=GRAMMAR_AWARE_INSTRUCTION if args.grammar_aware else INSTRUCTION
    if (not -1<=args.gpu_layers<=128 or not 1<=args.batch_threads<=32
        or not 128<=args.reasoning_tokens<=8192 or not 30<=args.request_timeout<=1770):
        raise ValueError('Invalid developer native profile.')
    stamp={}
    for name in ('harmony_judge_server.py','harmony_native.py','judge_server.py','judge_http.py','judge_protocol.py','judge.py','native_reasoning.py'):
        stamp.update(execution_stamp(Path(__file__).with_name(name)))
    hasher=hashlib.sha256()
    with args.model.open('rb') as stream:
        for chunk in iter(lambda:stream.read(4*1024*1024),b''):hasher.update(chunk)
    if hasher.hexdigest()!=args.sha256:raise ValueError('Judge weight checksum mismatch.')
    from llama_cpp import Llama,LlamaGrammar,StoppingCriteriaList,__version__,llama_supports_gpu_offload,llama_print_system_info
    if args.gpu_layers and not llama_supports_gpu_offload():raise ValueError('Developer runtime has no GPU offload support.')
    model=Llama(model_path=str(args.model),n_ctx=args.context_tokens,n_threads=4,n_threads_batch=args.batch_threads,
        n_gpu_layers=args.gpu_layers,offload_kqv=not args.cpu_kv,n_batch=128,n_ubatch=128,seed=917,verbose=False)
    # Decode only publisher-defined static control IDs, never generated content.
    for identifier,value in ((200006,'<|start|>'),(200007,'<|end|>'),(200005,'<|channel|>'),
        (200008,'<|message|>'),(200002,'<|return|>'),(200003,'<|constrain|>'),(200012,'<|call|>')):
        if model.detokenize([identifier],special=True).decode()!=value:raise ValueError('Unverified Harmony control token mapping.')
    identity={'modelSHA256':args.sha256,'template':'harmony-native-v2','reasoning':args.reasoning,
        'reasoningTokens':args.reasoning_tokens,'contextTokens':args.context_tokens,'runtime':__version__,
        'implementationSHA256':digest(stamp),'gpuLayers':args.gpu_layers,'batchThreads':args.batch_threads,
        'cpuKV':args.cpu_kv,'threads':4,'seed':917,'batchTokens':128,'microBatchTokens':128,
        'requestTimeoutSeconds':args.request_timeout,'privateHandling':'token-ids-only-v1',
        'seedPolicy':'fixed-per-request-v1','contextCachePolicy':'reset-before-uncached-request',
        'candidateOrdering':'canonical-pair-v1' if args.canonical_order else 'caller-order',
        'runtimeSystemInfo':llama_print_system_info().decode('utf-8',errors='replace')}
    if args.canonical_order:identity['orderStability']='Structural content-canonical symmetry; not intrinsic editorial accuracy.'
    if args.grammar_aware:identity.update(editorialRubric='grammar-aware-v1',instructionSHA256=digest(instruction))
    cache,failure_cache={},{}
    def evaluate(payload):
        started=time.monotonic();deadline=started+args.request_timeout
        phase='request';key=None;cached_failure=False
        try:
            require_unchanged(stamp);swapped=False
            if args.canonical_order:
                payload,swapped=canonical_payload(payload);key=digest(payload)
                if key in cache:
                    print(json.dumps({'status':'cached','canonical':True}),flush=True)
                    return restore_labels(cache[key],swapped)
                if key in failure_cache:
                    cached_failure=True;item=failure_cache[key]
                    raise ReasoningFailure('Cached bounded native failure.',item['reasoningFailure'],item['generatedTokens'],item['reasoningBudget'])
            model.reset();model.set_seed(917)
            tokens=model.tokenize(prompt(payload,args.reasoning,instruction).encode('utf8'),add_bos=False,special=True)
            phase='reasoning'
            tokens,stats=final_prefix(model,tokens,args.reasoning_tokens,args.context_tokens,deadline=deadline)
            phase='final';grammar=LlamaGrammar.from_json_schema(json.dumps(evidence_schema(payload)),verbose=False)
            stopping=StoppingCriteriaList([lambda input_ids,logits:time.monotonic()>=deadline])
            final=model(tokens,grammar=grammar,max_tokens=480,temperature=0,stop=['<|return|>'],echo=False,seed=917,stopping_criteria=stopping)
            if time.monotonic()>=deadline:raise TimeoutError('Local judge request deadline exceeded.')
            if final['choices'][0]['finish_reason']=='length':raise ValueError('Incomplete final verdict.')
            result=json.loads(final['choices'][0]['text'])
            validate(result,payload['source'],payload['A'],payload['B']);require_unchanged(stamp)
            if args.canonical_order:cache[key]=result
            print(json.dumps({'status':'judged','seconds':round(time.monotonic()-started,2),**stats,'finalTokens':final['usage']['completion_tokens']}),flush=True)
            return restore_labels(result,swapped)
        except Exception as error:
            if args.canonical_order and key is not None and isinstance(error,ReasoningFailure) and error.diagnostic['reasoningFailure']!='deadline':
                failure_cache[key]=error.diagnostic.copy()
            print(json.dumps({'status':'failed','errorType':type(error).__name__,'phase':phase,'cachedFailure':cached_failure,
                **(error.diagnostic if isinstance(error,ReasoningFailure) else {})}),flush=True)
            raise
    server=create_server(('127.0.0.1',args.port),identity,evaluate)
    print(json.dumps({'port':server.server_port,**identity}),flush=True)
    try:server.serve_forever()
    finally:server.server_close();model.close()


if __name__=='__main__':main()
