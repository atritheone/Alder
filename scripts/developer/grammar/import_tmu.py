"""Derive explicitly labelled Pareto comparisons from published human dimension ratings.

These are not direct human pairwise votes. No weighted overall preference is
invented: one output must be no worse on every dimension and 0.6 better on at
least one. SOME was trained on this dataset and cannot qualify against it.
"""
import argparse
from collections import defaultdict
import csv
import itertools
import json
import math
from pathlib import Path
import re
import subprocess
from common import digest,output_path,write


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset',type=Path,required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    path=args.dataset/'tmu-gfm-dataset.csv'
    with path.open(encoding='utf-8',newline='') as stream:rows=list(csv.DictReader(stream))
    groups=defaultdict(list)
    for row in rows:
        values=[]
        for annotations,average in [('grammer','ave_g'),('fluency','ave_f'),('meaning','ave_m')]:
            votes=[int(x) for x in row[annotations].split(',')]
            minimum=1 if annotations=='fluency' else 0
            if len(votes)!=5 or any(not minimum<=x<=4 for x in votes):raise ValueError('Invalid human dimension ratings.')
            valid=[vote for vote in votes if vote!=0]  # Published protocol: 0 means Other, excluded from the mean.
            if len(valid)<3:raise ValueError('Insufficient non-Other human ratings.')
            mean=float(row[average])
            if not math.isfinite(mean) or abs(mean-sum(valid)/len(valid))>1e-6:raise ValueError('Human rating mean mismatch.')
            values.append(mean)
        groups[digest(re.sub(r'\W+','',row['source'].casefold()))].append((row,values))
    pairs=[]
    for group,examples in sorted(groups.items()):
        for (a,va),(b,vb) in itertools.combinations(examples,2):
            if a['source']!=b['source']:continue
            if a['output']==b['output']:continue
            if a['output']>b['output']:a,b,va,vb=b,a,vb,va
            delta=[x-y for x,y in zip(va,vb)]
            winner='A' if min(delta)>=-1e-6 and max(delta)>=.6-1e-6 else 'B' if max(delta)<=1e-6 and min(delta)<=-.6+1e-6 else None
            if winner is None:continue
            pairs.append({'id':digest([a['source'],a['output'],b['output']])[:24],'group':group,
              'split':'calibration' if int(group[:8],16)%5<3 else 'validation',
              'source':a['source'],'a':a['output'],'b':b['output'],'humanWinner':winner,
              'humanDimensions':[va,vb],'preferenceConstruction':'Pareto dominance of human mean ratings; margin 0.6',
              'datasetOrigin':'TMU-GFM','sourceDatasetOrigins':['CoNLL-2013'],'dialect':'en-US','profile':'standard'})
    unique={};conflicts=set();repeats=0
    for pair in pairs:
        if pair['id'] in unique:
            repeats+=1
            if unique[pair['id']]['humanWinner']!=pair['humanWinner']:conflicts.add(pair['id'])
        else:unique[pair['id']]=pair
    pairs=[pair for key,pair in unique.items() if key not in conflicts]
    target=output_path(args.output)
    target.write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in pairs),'utf-8')
    revision=subprocess.check_output(['git','-C',str(args.dataset),'rev-parse','HEAD'],text=True).strip()
    write(str(target)+'.manifest.json',{'source':'https://github.com/tmu-nlp/TMU-GFM-Dataset','revision':revision,
        'rawRows':len(rows),'groups':len(groups),'pairs':len(pairs),'pairsSHA256':digest(pairs),
        'deduplicatedPairs':repeats,'excludedConflictingPairs':len(conflicts),
        'scope':__doc__,'csvSHA256':__import__('hashlib').sha256(path.read_bytes()).hexdigest()})
    print(json.dumps({'pairs':len(pairs),'groups':len(groups),'revision':revision}))


if __name__=='__main__':main()
