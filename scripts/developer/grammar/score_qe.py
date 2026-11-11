"""Local IMPARA-GED grammar-QE calibration; not a semantic-fidelity judge.

Mean-pool final states and apply the classifier, matching gec-metrics' published
mean-pooling adapter. Similarity filtering is disabled as in the official model
card. Inputs outside the trained 128-token window abstain rather than truncate.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
from common import digest, records, read, write, execution_stamp, require_unchanged


def main():
    implementation_stamp=execution_stamp(__file__)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model',type=Path,required=True)
    parser.add_argument('--pairs',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    manifest=read(args.model/'artifact-manifest.json')
    for name,expected in manifest['files'].items():
        path=(args.model/name).resolve()
        if not path.is_relative_to(args.model.resolve()):raise ValueError('Invalid model manifest path.')
        digestor=hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda:stream.read(4*1024*1024),b''):digestor.update(chunk)
        if digestor.hexdigest()!=expected['sha256']:raise ValueError('Evaluator artifact failed verification.')
    import torch
    import transformers
    from transformers import AutoTokenizer, AutoModelForSequenceClassification
    torch.set_num_threads(4)
    tokenizer=AutoTokenizer.from_pretrained(args.model,local_files_only=True,trust_remote_code=False)
    model=AutoModelForSequenceClassification.from_pretrained(args.model,local_files_only=True,
        trust_remote_code=False,attn_implementation='eager').eval()
    pairs=records(args.pairs)
    texts=sorted({text for pair in pairs for text in (pair['a'],pair['b'])})
    scores={}
    with torch.inference_mode():
        for index in range(0,len(texts),8):
            batch=texts[index:index+8]
            eligible=[text for text in batch if len(tokenizer.encode(text))<=128]
            for text in batch:
                if text not in eligible:scores[text]=None
            if not eligible:continue
            encoded=tokenizer(eligible,padding='max_length',max_length=128,truncation=False,return_tensors='pt')
            output=model(**encoded,output_hidden_states=True)
            states=output.hidden_states[-1]
            mask=encoded['attention_mask'].unsqueeze(-1).expand(states.size()).float()
            pooled=(states*mask).sum(1)/mask.sum(1).clamp(min=1e-9)
            values=torch.sigmoid(model.classifier(pooled)).view(-1).tolist()
            for text,value in zip(eligible,values):scores[text]=value if math.isfinite(value) else None
            print(json.dumps({'scored':min(index+8,len(texts)),'total':len(texts)}),flush=True)
    ratings=[]
    for pair in pairs:
        a,b=scores[pair['a']],scores[pair['b']]
        winner='abstain' if a is None or b is None else 'A' if a>b else 'B' if b>a else 'tie'
        ratings.append({'id':pair['id'],'group':pair['group'],'split':pair['split'],
          'pairSHA256':digest(pair),'winner':winner,'scores':[a,b],
          'orderDecisions':[winner,{'A':'B','B':'A','tie':'tie','abstain':'abstain'}[winner]]})
    require_unchanged(implementation_stamp)
    write(args.output,{'judge':{'family':'modernbert-grammar-qe','revision':manifest['revision'],
      'modelSHA256':manifest['files']['model.safetensors']['sha256'],'scope':__doc__,
      'trainingDatasetOrigins':['CoNLL-2013']},
      'implementationSHA256':digest(implementation_stamp),'codeSnapshot':implementation_stamp,
      'dependencies':{'torch':torch.__version__,'transformers':transformers.__version__},'records':ratings})


if __name__=='__main__':main()
