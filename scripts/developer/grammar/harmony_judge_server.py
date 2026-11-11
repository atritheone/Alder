"""Local gpt-oss judge with native Harmony reasoning and constrained final JSON.

Reasoning stays inside this process. Only the final structured judgment is
returned or logged; truncated reasoning never becomes a successful rating.
"""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler,HTTPServer
import json
import re
from pathlib import Path
import time
import threading
from common import digest,execution_stamp,require_unchanged
from judge_protocol import INSTRUCTION,SCHEMA,document_json,evidence_schema


def prompt(payload,effort):
    system=('You are ChatGPT, a large language model trained by OpenAI.\n'
      'Knowledge cutoff: 2024-06\nReasoning: '+effort+'\n'
      '# Valid channels: analysis, commentary, final. Channel must be included for every message.')
    developer='# Instructions\n'+INSTRUCTION+'\n\n# Response Formats\n## grammar_judgment\n'+json.dumps(SCHEMA)
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
    parser.add_argument('--gpu-layers',type=int,default=0,help='Explicit developer-only offload; zero retains the CPU protocol')
    parser.add_argument('--batch-threads',type=int,default=4)
    parser.add_argument('--cpu-kv',action='store_true',help='Keep attention/KV on CPU when evaluating a large judge on a small GPU')
    args=parser.parse_args();stamp={**execution_stamp(__file__),**execution_stamp(Path(__file__).with_name('judge_protocol.py'))}
    if not -1<=args.gpu_layers<=128 or not 1<=args.batch_threads<=32:raise ValueError('Invalid developer runtime profile.')
    hasher=hashlib.sha256()
    with args.model.open('rb') as stream:
        for chunk in iter(lambda:stream.read(4*1024*1024),b''):hasher.update(chunk)
    if hasher.hexdigest()!=args.sha256:raise ValueError('Judge weight checksum mismatch.')
    from llama_cpp import Llama,LlamaGrammar,__version__,llama_supports_gpu_offload,llama_print_system_info
    if args.gpu_layers and not llama_supports_gpu_offload():raise ValueError('The selected developer runtime has no GPU offload support.')
    model=Llama(model_path=str(args.model),n_ctx=4096,n_threads=4,n_threads_batch=args.batch_threads,
                n_gpu_layers=args.gpu_layers,offload_kqv=not args.cpu_kv,seed=917,verbose=False)
    for identifier,value in ((200006,'<|start|>'),(200005,'<|channel|>'),(200008,'<|message|>'),(200002,'<|return|>'),(200003,'<|constrain|>')):
        if model.detokenize([identifier],special=True).decode()!=value:
            raise ValueError('Unverified Harmony token mapping.')
    identity={'modelSHA256':args.sha256,'template':'harmony-native-v1','reasoning':args.reasoning,
      'reasoningTokens':args.reasoning_tokens,'runtime':__version__,'implementationSHA256':digest(stamp)}
    identity.update(gpuLayers=args.gpu_layers,batchThreads=args.batch_threads,cpuKV=args.cpu_kv,
                    runtimeSystemInfo=llama_print_system_info().decode('utf-8',errors='replace'))
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
                self.reply({'status':'stopping'})
                threading.Thread(target=server.shutdown,daemon=True).start()
                return
            try:
                require_unchanged(stamp)
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=65536:raise ValueError('Invalid request size.')
                payload=json.loads(self.rfile.read(length));prefix=prompt(payload,args.reasoning)
                tokens=model.tokenize(prefix.encode('utf-8'),add_bos=False,special=True)
                final_budget=480;reasoning_budget=min(args.reasoning_tokens,4096-len(tokens)-final_budget-16)
                if reasoning_budget<128:raise ValueError('Judge input exceeds context budget.')
                generated=[];reasoning_text=None;started=time.monotonic();channel_start=None
                iterator=model.generate(tokens,temp=0,top_k=0,top_p=1,repeat_penalty=1,reset=True)
                try:
                    for token in iterator:
                        if token==model.token_eos():break
                        generated.append(token)
                        if token==200005:channel_start=len(generated)
                        if token==200008 and channel_start is not None:
                            header=generated[channel_start:-1]
                            if 200003 in header:header=header[:header.index(200003)]
                            channel=model.detokenize(header,special=True).decode('utf-8').strip()
                            if channel=='final':
                                reasoning_text=model.detokenize(generated,special=True).decode('utf-8')
                                break
                        if len(generated)>=reasoning_budget:break
                finally:iterator.close()
                if reasoning_text is None:
                    decoded=model.detokenize(generated,special=True).decode('utf-8',errors='replace')
                    print(json.dumps({'status':'protocol-incomplete','generatedTokens':len(generated),
                      'stoppedAtEOS':token==model.token_eos(),
                      'channels':re.findall(r'<\|channel\|>([a-z]+)',decoded),
                      'controlTokens':re.findall(r'<\|[^|>]+\|>',decoded)[-12:]}),flush=True)
                    raise ValueError('Judge did not reach a complete final channel within its budget.')
                grammar=LlamaGrammar.from_json_schema(json.dumps(evidence_schema(payload)),verbose=False)
                final=model(prefix+reasoning_text,grammar=grammar,max_tokens=final_budget,
                            temperature=0,stop=['<|return|>'],echo=False)
                if final['choices'][0]['finish_reason']=='length':raise ValueError('Incomplete final judgment.')
                result=json.loads(final['choices'][0]['text'])
                require_unchanged(stamp)
                self.reply(result)
                print(json.dumps({'status':'judged','seconds':round(time.monotonic()-started,2),
                  'reasoningTokens':len(generated),'finalTokens':final['usage']['completion_tokens']}),flush=True)
            except Exception as error:
                self.reply({'error':type(error).__name__},422)
                print(json.dumps({'status':'failed','errorType':type(error).__name__,'reason':str(error)[:180]}),flush=True)
    server=HTTPServer(('127.0.0.1',args.port),Handler)
    print(json.dumps({'port':server.server_port,**identity}),flush=True)
    try:server.serve_forever()
    finally:server.server_close();model.close()


if __name__=='__main__':main()
