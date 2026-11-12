"""Research-only CoEdIT worker; local verified assets and no checkpoint code.

The noncommercial checkpoint is excluded from Alder's shipping-pack search.
This task-specific baseline has no context, locale or creative-profile control.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

REVISION='5637bcdf9d8d4419f97c8cfea36f7d35c79232b6'
WEIGHTS_SHA256='c692f68bca5c6899801bc9fad626fefd3359ccd95e26dccae4dd72186fd98852'
PREFIX='Fix grammatical errors in this sentence: '


def verify_assets(weights):
    weights=Path(weights).resolve();directory=weights.parent
    manifest=json.loads((directory/'artifact-manifest.json').read_text('utf8'))
    if (weights.name!='model.safetensors' or manifest.get('repo')!='grammarly/coedit-large'
            or manifest.get('revision')!=REVISION or manifest.get('licence')!='cc-by-nc-4.0'
            or manifest.get('files',{}).get(weights.name,{}).get('sha256')!=WEIGHTS_SHA256):
        raise ValueError('Use the pinned research-only checkpoint.')
    required={'config.json','generation_config.json','model.safetensors','special_tokens_map.json',
              'spiece.model','tokenizer.json','tokenizer_config.json','README.md'}
    if set(manifest['files'])!=required:raise ValueError('Checkpoint asset inventory differs.')
    for name,identity in manifest['files'].items():
        path=(directory/name).resolve()
        if not path.is_relative_to(directory) or not path.is_file():raise ValueError('Missing local asset.')
        hasher=hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda:stream.read(4*1024*1024),b''):hasher.update(chunk)
        if hasher.hexdigest()!=identity['sha256'] or path.stat().st_size!=identity['size']:
            raise ValueError('Research checkpoint integrity differs.')
    return directory


def correct(request,tokenizer,model,torch):
    text=request.get('text')
    if not isinstance(text,str) or not text.strip() or len(text)>2400:raise ValueError('Invalid text.')
    if request.get('revisionMode','improve')!='improve':
        raise ValueError('This research baseline does not implement explicit rephrasing.')
    tokens=tokenizer(PREFIX+text,return_tensors='pt',truncation=False)
    if tokens['input_ids'].shape[-1]>512:raise ValueError('Input exceeds the fixed limit; never truncate.')
    with torch.inference_mode():
        output=model.generate(**tokens,do_sample=False,num_beams=1,max_new_tokens=256,
                              use_cache=True,return_dict_in_generate=False)
    ids=output[0].tolist();eos=model.config.eos_token_id
    ends=eos if isinstance(eos,list) else [eos]
    if not ids or ids[-1] not in ends:raise ValueError('Incomplete output.')
    value=tokenizer.decode(ids,skip_special_tokens=True,clean_up_tokenization_spaces=False)
    if not isinstance(value,str) or len(value)>2400:raise ValueError('Invalid output.')
    return value


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--model',type=Path,required=True)
    args=parser.parse_args()
    sys.stdin.reconfigure(encoding='utf8',errors='strict');sys.stdout.reconfigure(encoding='utf8',errors='strict')
    protocol=sys.stdout;sys.stdout=sys.stderr
    directory=verify_assets(args.model)
    import torch
    from transformers import AutoTokenizer,T5ForConditionalGeneration
    torch.set_num_threads(4);torch.set_num_interop_threads(1);torch.manual_seed(917)
    torch.use_deterministic_algorithms(True)
    tokenizer=AutoTokenizer.from_pretrained(directory,local_files_only=True,trust_remote_code=False,use_fast=True)
    model=T5ForConditionalGeneration.from_pretrained(directory,local_files_only=True,
                                                   use_safetensors=True,dtype=torch.float32)
    model.eval()
    while line:=sys.stdin.readline(65537):
        request={}
        try:
            if len(line)>65536:break
            request=json.loads(line)
            response={'id':request.get('id'),'corrected':correct(request,tokenizer,model,torch)}
        except Exception:
            response={'id':request.get('id') if isinstance(request,dict) else None,'error':'Inference failed'}
        protocol.write(json.dumps(response,ensure_ascii=False)+'\n');protocol.flush()


if __name__=='__main__':main()
