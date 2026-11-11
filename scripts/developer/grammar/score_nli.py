"""Measure bidirectional entailment with a pinned local NLI checkpoint.

This is a meaning diagnostic, never a grammar preference judge or proof of
equivalence. Freeze the thresholds before each new corpus run. Uncertain inputs
abstain rather than gaining an arbitrary winner from a tiny score difference.
"""
import argparse
import json
import math
import os
from pathlib import Path
from common import records,write,digest,execution_stamp,require_unchanged
from score_sure import verify

POLICY={'minimumBidirectionalEntailment':.9,'maximumContradiction':.05,'pairwiseMargin':.05}


class EntailmentVerifier:
    """Pair-at-a-time developer prototype; no automatic download or installed pin."""
    def __init__(self,directory):
        self.manifest=verify(Path(directory))
        os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
        import torch,transformers
        from transformers import AutoTokenizer,AutoModelForSequenceClassification
        torch.set_num_threads(4);self.torch=torch
        self.tokenizer=AutoTokenizer.from_pretrained(directory,local_files_only=True,trust_remote_code=False)
        self.model=AutoModelForSequenceClassification.from_pretrained(directory,local_files_only=True,trust_remote_code=False,use_safetensors=True).float().eval()
        self.labels={int(key):str(value).casefold() for key,value in self.model.config.id2label.items()}
        if self.labels!={0:'contradiction',1:'entailment',2:'neutral'}:raise ValueError('Unverified NLI label mapping.')
        self.limit=min(512,self.model.config.max_position_embeddings)
        self.identity={'modelSHA256':digest(self.manifest),'policy':POLICY,'tokenBudget':self.limit,
          'dependencies':{'torch':torch.__version__,'transformers':transformers.__version__},
          'protocol':'developer bidirectional pair batch 2, float32'}

    def score(self,source,candidate):
        if not isinstance(candidate,str) or not candidate.strip() or len(candidate)>2400:return None
        pairs=[(source,candidate),(candidate,source)]
        if any(len(self.tokenizer.encode(a,b))>self.limit for a,b in pairs):return None
        encoded=self.tokenizer([a for a,_ in pairs],[b for _,b in pairs],padding=True,truncation=False,return_tensors='pt')
        with self.torch.inference_mode():probabilities=self.torch.softmax(self.model(**encoded).logits,dim=-1).tolist()
        if not all(math.isfinite(value) for row in probabilities for value in row):return None
        forward,reverse=[{self.labels[i]:value for i,value in enumerate(row)} for row in probabilities]
        entailment=min(forward['entailment'],reverse['entailment'])
        contradiction=max(forward['contradiction'],reverse['contradiction'])
        return {'forward':forward,'reverse':reverse,'minimumEntailment':entailment,'maximumContradiction':contradiction,
          'accepted':entailment>=POLICY['minimumBidirectionalEntailment'] and contradiction<=POLICY['maximumContradiction']}


def main():
    stamp=execution_stamp(__file__)
    stamp.update(execution_stamp(Path(__file__).with_name('score_sure.py')))
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model',type=Path,required=True);parser.add_argument('--pairs',required=True)
    parser.add_argument('--output',required=True);args=parser.parse_args()
    manifest=verify(args.model)
    os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
    import torch,transformers
    from transformers import AutoTokenizer,AutoModelForSequenceClassification
    torch.set_num_threads(4)
    tokenizer=AutoTokenizer.from_pretrained(args.model,local_files_only=True,trust_remote_code=False)
    model=AutoModelForSequenceClassification.from_pretrained(args.model,local_files_only=True,trust_remote_code=False,use_safetensors=True).float().eval()
    labels={int(key):str(value).casefold() for key,value in model.config.id2label.items()}
    if labels!={0:'contradiction',1:'entailment',2:'neutral'}:raise ValueError('Unverified NLI label mapping.')
    limit=min(512,model.config.max_position_embeddings)
    pairs=records(args.pairs)
    examples=sorted({(p['source'],text) for p in pairs for text in (p['a'],p['b'])})
    directions=sorted({direction for source,text in examples for direction in ((source,text),(text,source))})
    scores={}
    with torch.inference_mode():
        for offset in range(0,len(directions),8):
            eligible=[]
            for source,candidate in directions[offset:offset+8]:
                if len(tokenizer.encode(source,candidate))>limit:scores[(source,candidate)]=None
                else:eligible.append((source,candidate))
            if eligible:
                encoded=tokenizer([s for s,_ in eligible],[c for _,c in eligible],padding=True,truncation=False,return_tensors='pt')
                probabilities=torch.softmax(model(**encoded).logits,dim=-1)
                for key,values in zip(eligible,probabilities.tolist()):
                    scores[key]={labels[i]:value for i,value in enumerate(values)} if all(math.isfinite(v) for v in values) else None
            print(json.dumps({'scored':min(offset+8,len(directions)),'total':len(directions)}),flush=True)
    def meaning(source,candidate):
        forward,reverse=scores[(source,candidate)],scores[(candidate,source)]
        if forward is None or reverse is None:return None
        entailment=min(forward['entailment'],reverse['entailment'])
        contradiction=max(forward['contradiction'],reverse['contradiction'])
        return {'forward':forward,'reverse':reverse,'minimumEntailment':entailment,
          'maximumContradiction':contradiction,'accepted':entailment>=POLICY['minimumBidirectionalEntailment'] and contradiction<=POLICY['maximumContradiction']}
    rows=[]
    for pair in pairs:
        a,b=meaning(pair['source'],pair['a']),meaning(pair['source'],pair['b'])
        difference=a['minimumEntailment']-b['minimumEntailment'] if a is not None and b is not None else None
        winner='abstain' if difference is None or abs(difference)<POLICY['pairwiseMargin'] else 'A' if difference>0 else 'B'
        rows.append({'id':pair['id'],'group':pair['group'],'split':pair['split'],'pairSHA256':digest(pair),
          'winner':winner,'meaning':[a,b]})
    require_unchanged(stamp)
    write(args.output,{'status':'unverified','scope':__doc__,'policy':POLICY,'records':rows,
      'judge':{'family':'deberta-v3-nli','modelSHA256':digest(manifest),'revision':manifest['revision'],
        'trainingDatasetOrigins':['SNLI','MultiNLI'],'role':'Bidirectional semantic evidence only'},
      'dependencies':{'torch':torch.__version__,'transformers':transformers.__version__},
      'implementationSHA256':digest(stamp),'tokenBudget':limit})


if __name__=='__main__':main()
