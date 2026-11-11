"""CPU-only SOME submetrics, with separate grammar/fluency/meaning evidence.

The published weighted average is reported only as a comparison baseline. It
must not override a semantic veto. No remote code or unsafe pickle globals load.
"""
import argparse
import hashlib
import math
from pathlib import Path
from common import records,read,write,digest,execution_stamp,require_unchanged


def main():
    implementation_stamp=execution_stamp(__file__)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-root',type=Path,required=True)
    parser.add_argument('--pairs',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    import torch
    import transformers
    from transformers import AutoModelForSequenceClassification, BertTokenizer
    torch.set_num_threads(4)
    pairs=records(args.pairs)
    texts=sorted({(pair['source'],text) for pair in pairs for text in (pair['a'],pair['b'])})
    scores={key:{} for key in texts};assets={}
    for dimension,directory in [('correctness','grammer'),('fluency','fluency'),('meaning','meaning')]:
        folder=args.model_root/directory
        digestor=hashlib.sha256()
        with (folder/'pytorch_model.bin').open('rb') as stream:
            for chunk in iter(lambda:stream.read(4*1024*1024),b''):digestor.update(chunk)
        assets[dimension]=digestor.hexdigest()
        tokenizer=BertTokenizer.from_pretrained(folder,local_files_only=True)
        model=AutoModelForSequenceClassification.from_pretrained(folder,local_files_only=True,trust_remote_code=False,weights_only=True).eval()
        with torch.inference_mode():
            for offset in range(0,len(texts),8):
                batch=texts[offset:offset+8]
                eligible=[]
                for source,text in batch:
                    tokens=tokenizer.encode(source,text) if dimension=='meaning' else tokenizer.encode(text)
                    if len(tokens)>128:scores[(source,text)][dimension]=None
                    else:eligible.append((source,text))
                if not eligible:continue
                if dimension=='meaning':
                    encoded=tokenizer([k[0] for k in eligible],[k[1] for k in eligible],padding='max_length',max_length=128,truncation=False,return_tensors='pt')
                else:
                    encoded=tokenizer([k[1] for k in eligible],padding='max_length',max_length=128,truncation=False,return_tensors='pt')
                values=model(**encoded).logits.view(-1).tolist()
                for key,value in zip(eligible,values):scores[key][dimension]=(value-1)/3 if math.isfinite(value) else None
        del model
        print(dimension+' scored',len(texts),flush=True)
    rows=[]
    def combined(value):
        if any(v is None for v in value.values()):return None
        return .55*value['correctness']+.43*value['fluency']+.02*value['meaning']
    for pair in pairs:
        left,right=scores[(pair['source'],pair['a'])],scores[(pair['source'],pair['b'])]
        a,b=combined(left),combined(right)
        winner='abstain' if a is None or b is None else 'A' if a>b else 'B' if b>a else 'tie'
        rows.append({'id':pair['id'],'group':pair['group'],'split':pair['split'],'pairSHA256':digest(pair),
          'winner':winner,'scores':[a,b],'dimensions':[left,right],
          'orderDecisions':[winner,{'A':'B','B':'A','tie':'tie','abstain':'abstain'}[winner]]})
    require_unchanged(implementation_stamp)
    write(args.output,{'judge':{'family':'bert-gfm','modelHashes':assets,'scope':__doc__,'trainingDatasetOrigins':['TMU-GFM']},
      'implementationSHA256':digest(implementation_stamp),'codeSnapshot':implementation_stamp,
      'dependencies':{'torch':torch.__version__,'transformers':transformers.__version__},'records':rows})


if __name__=='__main__':main()
