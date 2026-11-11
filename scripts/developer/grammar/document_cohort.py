"""Freeze a new judge cohort by whole source essay, including duplicate unions.

This replaces sentence-only splitting for subsequent independent judge trials.
Earlier cohorts and results remain intact; they do not become document-disjoint.
"""
import argparse
from collections import defaultdict
import json
from pathlib import Path
from common import digest,read,records,write,output_path
from conll_documents import source_clusters


def select(pairs,mapping,calibration=80,validation=150,excluded=(),minimum_votes=1,unanimous=False):
    if type(minimum_votes) is not int or minimum_votes<1:raise ValueError('Minimum human votes must be positive.')
    clusters=source_clusters(mapping)
    excluded=set(excluded)
    documents=sorted({clusters[digest(row['source'])] for row in pairs},
                     key=lambda group:digest(['document-cohort-v1',group]))
    if len(documents)<30:raise ValueError('Insufficient independent source essays.')
    calibration_documents=set(documents[:len(documents)//3])
    populations=defaultdict(lambda:defaultdict(lambda:defaultdict(list)))
    for pair in pairs:
        if pair['group'] in excluded or pair['a']==pair['b'] or pair['humanWinner']=='tie':continue
        votes=pair.get('humanVotes',{})
        if minimum_votes>1 or unanimous:
            if not isinstance(votes,dict) or any(choice not in ('A','B','tie') or type(count) is not int or count<0 for choice,count in votes.items()):
                raise ValueError('Invalid original human preference votes.')
        if (minimum_votes>1 or unanimous) and votes.get(pair['humanWinner'],0)<minimum_votes:continue
        if unanimous and any(count>0 and choice!=pair['humanWinner'] for choice,count in votes.items()):continue
        document=clusters[digest(pair['source'])]
        split='calibration' if document in calibration_documents else 'validation'
        populations[split][document][pair['group']].append({**pair,'split':split,'documentGroup':document})
    selected=[]
    for split,limit in (('calibration',calibration),('validation',validation)):
        # Visit every document before taking its next source. Visit every source
        # before taking another comparison of the same source sentence.
        queues={}
        for document,sources in populations[split].items():
            ordered=sorted(sources,key=lambda group:digest(['document-cohort-v1',group]))
            choices={group:sorted(sources[group],key=lambda pair:digest(['document-cohort-v1',pair['id']])) for group in ordered}
            queues[document]=[choices[group][round_number] for round_number in range(4)
                              for group in ordered if len(choices[group])>round_number]
        ordered=sorted(queues,key=lambda group:digest(['document-cohort-v1',group]))
        cohort=[];offset=0
        while len(cohort)<limit:
            next_rows=[queues[group][offset] for group in ordered if len(queues[group])>offset]
            if not next_rows:raise ValueError('Insufficient decisive human pairs for declared cohort.')
            cohort.extend(next_rows);offset+=1
        selected.extend(cohort[:limit])
    by_split={split:{row['documentGroup'] for row in selected if row['split']==split}
              for split in ('calibration','validation')}
    if by_split['calibration']&by_split['validation']:raise ValueError('Source essays leaked between judge partitions.')
    if len(by_split['validation'])<20:raise ValueError('Validation requires at least 20 source essays.')
    return selected,by_split


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pairs',required=True);parser.add_argument('--document-map',required=True)
    parser.add_argument('--output',required=True);parser.add_argument('--exclude-groups')
    parser.add_argument('--calibration',type=int,default=80);parser.add_argument('--validation',type=int,default=150)
    parser.add_argument('--minimum-votes',type=int,default=1)
    parser.add_argument('--unanimous',action='store_true',help='Exclude comparisons with any opposed human vote')
    args=parser.parse_args()
    if min(args.calibration,args.validation)<1:raise ValueError('Cohort sizes must be positive.')
    target=output_path(args.output)
    if target.exists() or Path(str(target)+'.manifest.json').exists():raise ValueError('Preserve the frozen cohort; use new output paths.')
    pairs=records(args.pairs);mapping=read(args.document_map)
    excluded=read(args.exclude_groups) if args.exclude_groups else []
    selected,partitions=select(pairs,mapping,args.calibration,args.validation,excluded,args.minimum_votes,args.unanimous)
    target.write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in selected),'utf-8')
    write(str(target)+'.manifest.json',{'protocol':'document-cohort-v1','inputSHA256':digest(pairs),
      'documentMapSHA256':digest(mapping),'cohortSHA256':digest(selected),'excludedSourceGroups':sorted(excluded),
      'minimumHumanVotes':args.minimum_votes,'unanimousHumanPreferences':args.unanimous,
      'counts':{split:{'pairs':sum(row['split']==split for row in selected),'documents':len(groups),
        'sources':len({row['group'] for row in selected if row['split']==split})} for split,groups in partitions.items()},
      'selection':'Whole-essay hash partition; document/source-balanced decisive pairs; at most four/source',
      'scope':'New frozen measurement cohort; does not change earlier exposure or erase earlier results'})
    print(json.dumps({'pairs':len(selected),'documents':{key:len(value) for key,value in partitions.items()}}))


if __name__=='__main__':main()
