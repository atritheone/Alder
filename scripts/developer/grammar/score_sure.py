"""Run a pinned local SURE research checkout with separate faithfulness evidence.

No checkpoint code is copied into Alder. Both the local base and adapter assets
are checked before importing the separately pinned research implementation.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
from common import records,read,write,digest,output_path,execution_stamp,require_unchanged


def verify(root):
    manifest=read(root/'artifact-manifest.json')
    for name,expected in manifest['files'].items():
        target=(root/name).resolve()
        if not target.is_relative_to(root.resolve()):raise ValueError('Checkpoint escaped its manifest.')
        hasher=hashlib.sha256()
        with target.open('rb') as stream:
            for chunk in iter(lambda:stream.read(4*1024*1024),b''):hasher.update(chunk)
        if hasher.hexdigest()!=expected['sha256']:raise ValueError('Research checkpoint integrity failure.')
    return manifest


def main():
    implementation_stamp=execution_stamp(__file__)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--implementation-root',type=Path,required=True)
    parser.add_argument('--checkpoint',type=Path,required=True)
    parser.add_argument('--base-model',type=Path,required=True)
    parser.add_argument('--pairs',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    base=verify(args.base_model);adapter=verify(args.checkpoint)
    implementation=subprocess.check_output(['git','-C',str(args.implementation_root),'rev-parse','HEAD'],text=True).strip()
    if subprocess.check_output(['git','-C',str(args.implementation_root),'status','--porcelain'],text=True).strip():
        raise ValueError('Research implementation has unrecorded changes.')
    target=output_path(args.output)
    # A derived local metadata copy replaces a remote base id with the verified path.
    local=target.parent/('sure-local-'+digest([base,adapter])[:12])
    local.mkdir(exist_ok=True)
    for name in adapter['files']:
        if name=='metadata.json':continue
        destination=local/name;destination.parent.mkdir(parents=True,exist_ok=True)
        if not destination.exists():shutil.copyfile(args.checkpoint/name,destination)
        if hashlib.sha256(destination.read_bytes()).hexdigest()!=adapter['files'][name]['sha256']:
            raise ValueError('Derived checkpoint changed.')
    metadata=read(args.checkpoint/'metadata.json')
    metadata['base_model']=str(args.base_model.resolve())
    (local/'metadata.json').write_text(json.dumps(metadata,indent=2),'utf-8')
    os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
    os.environ['TORCH_FORCE_WEIGHTS_ONLY_LOAD']='1'
    os.environ.pop('TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD',None)
    sys.path.insert(0,str(args.implementation_root.resolve()))
    import torch,transformers,peft
    torch.set_num_threads(4)
    # The release has plain tensor state dictionaries, never load arbitrary pickle globals.
    heads=torch.load(local/'heads.pt',map_location='cpu',weights_only=True)
    if set(heads)!={'span_classifier','axis_heads','overall_head'}:raise ValueError('Unexpected reward heads.')
    from sure.scorer import RewardScorer,detokenize
    scorer=RewardScorer(local,device='cpu')
    scorer.model.float()  # Match the published FP32 scoring protocol across Transformers defaults.
    pairs=records(args.pairs)
    examples=sorted({(p['source'],text) for p in pairs for text in (p['a'],p['b'])})
    scores={}
    with torch.inference_mode():
        for offset in range(0,len(examples),8):
            batch=examples[offset:offset+8];eligible=[]
            for source,candidate in batch:
                normalized=(detokenize(source),detokenize(candidate))
                if len(scorer.tokenizer.encode(*normalized))>metadata['max_length']:scores[(source,candidate)]=None
                else:eligible.append(((source,candidate),normalized))
            if not eligible:continue
            encoded=scorer.tokenizer([value[0] for _,value in eligible],[value[1] for _,value in eligible],
                padding=True,truncation=False,return_tensors='pt')
            result=scorer.model(input_ids=encoded['input_ids'],attention_mask=encoded['attention_mask'],
                                span_open_id=scorer.span_open_id,compute_span=False)
            for i,(key,_) in enumerate(eligible):
                value={'overall':result['overall_reward'][i].item(),
                  **{axis:result['axis_scores'][axis][i].item() for axis in metadata['axes']}}
                scores[key]=value if all(math.isfinite(x) for x in value.values()) else None
            print(json.dumps({'scored':min(offset+8,len(examples)),'total':len(examples)}),flush=True)
    rows=[]
    for pair in pairs:
        a,b=scores[(pair['source'],pair['a'])],scores[(pair['source'],pair['b'])]
        winner='abstain' if a is None or b is None else 'A' if a['overall']>b['overall'] else 'B' if b['overall']>a['overall'] else 'tie'
        rows.append({'id':pair['id'],'group':pair['group'],'split':pair['split'],'pairSHA256':digest(pair),
          'winner':winner,'dimensions':[a,b],'orderDecisions':[winner,{'A':'B','B':'A','tie':'tie','abstain':'abstain'}[winner]]})
    require_unchanged(implementation_stamp)
    write(args.output,{'judge':{'family':'deberta-v3-reward','modelSHA256':digest([base,adapter]),
      'checkpointRevision':adapter['revision'],'baseRevision':base['revision'],'researchImplementation':implementation,
      'trainingDatasetOrigins':['BEA-2019-development','JFLEG'],'scope':'SURE research evaluator; no production redistribution qualification'},
      'implementationSHA256':digest(implementation_stamp),'precision':'float32','codeSnapshot':implementation_stamp,
      'dependencies':{'torch':torch.__version__,'transformers':transformers.__version__,'peft':peft.__version__},'records':rows})


if __name__=='__main__':main()
