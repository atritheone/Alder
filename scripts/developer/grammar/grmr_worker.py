"""Research-only GRMR task format; verified local weights, no thinking channel."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

REVISION='3e8a0b2beb1ab373baee873ba9498ebbbef5aa02'
WEIGHTS_SHA256='ac5a134fa44ca8fe176d5059b4a427bedb44beff9eb30a3d649a693037a5bf2f'
TEXT_START='<|text_start|>';TEXT_END='<|text_end|>'
CORRECTED_START='<|corrected_start|>';CORRECTED_END='<|corrected_end|>'
RESERVED=(TEXT_START,TEXT_END,CORRECTED_START,CORRECTED_END,'<|endoftext|>')


def verify_assets(weights):
    weights=Path(weights).resolve();directory=weights.parent
    manifest=json.loads((directory/'artifact-manifest.json').read_text('utf8'))
    if (weights.name!='GRMR-V3-Q4B-Q4_K_M.gguf' or manifest.get('repo')!='qingy2024/GRMR-V3-Q4B-GGUF'
            or manifest.get('revision')!=REVISION
            or manifest.get('files',{}).get(weights.name,{}).get('sha256')!=WEIGHTS_SHA256
            or set(manifest.get('files',{}))!={'README.md',weights.name}):
        raise ValueError('Use the pinned research checkpoint and asset inventory.')
    for name,identity in manifest['files'].items():
        path=(directory/name).resolve()
        if not path.is_relative_to(directory) or not path.is_file():raise ValueError('Missing local asset.')
        hasher=hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda:stream.read(4*1024*1024),b''):hasher.update(chunk)
        if hasher.hexdigest()!=identity['sha256'] or path.stat().st_size!=identity['size']:
            raise ValueError('Research checkpoint integrity differs.')


def correct(request,model):
    text=request.get('text')
    if not isinstance(text,str) or not text.strip() or len(text)>2400:raise ValueError('Invalid text.')
    if any(tag in text for tag in RESERVED):raise ValueError('Reserved task delimiter in source.')
    if request.get('revisionMode','improve')!='improve':raise ValueError('Explicit rephrasing is unsupported.')
    prompt=TEXT_START+'\n'+text+TEXT_END+'\n'+CORRECTED_START+'\n'
    tokens=model.tokenize(prompt.encode('utf8'),add_bos=False,special=True)
    if len(tokens)+1100+16>4096:raise ValueError('Input exceeds the fixed context; never truncate.')
    model.reset();model.set_seed(917)
    result=model(tokens,max_tokens=1100,temperature=.7,top_p=.95,top_k=40,min_p=.01,
                 repeat_penalty=1,frequency_penalty=0,presence_penalty=0,seed=917,
                 stop=[CORRECTED_END],echo=False)
    if result['choices'][0]['finish_reason']!='stop':raise ValueError('Incomplete output.')
    value=result['choices'][0]['text']
    if not isinstance(value,str) or len(value)>2400 or any(tag in value for tag in RESERVED):
        raise ValueError('Invalid task output.')
    return value.strip()


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--model',type=Path,required=True)
    args=parser.parse_args()
    sys.stdin.reconfigure(encoding='utf8',errors='strict');sys.stdout.reconfigure(encoding='utf8',errors='strict')
    protocol=sys.stdout;sys.stdout=sys.stderr
    verify_assets(args.model)
    from llama_cpp import Llama,__version__
    if __version__!='0.3.35':raise ValueError('Use the pinned developer native runtime.')
    model=Llama(model_path=str(args.model),n_ctx=4096,n_threads=4,n_threads_batch=4,
                n_gpu_layers=0,n_batch=512,n_ubatch=512,seed=917,verbose=False)
    try:
        while line:=sys.stdin.readline(65537):
            request={}
            try:
                if len(line)>65536:break
                request=json.loads(line)
                response={'id':request.get('id'),'corrected':correct(request,model)}
            except Exception:
                response={'id':request.get('id') if isinstance(request,dict) else None,'error':'Inference failed'}
            protocol.write(json.dumps(response,ensure_ascii=False)+'\n');protocol.flush()
    finally:model.close()


if __name__=='__main__':main()
