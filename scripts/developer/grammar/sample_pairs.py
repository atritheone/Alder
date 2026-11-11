"""Freeze a small, source-balanced calibration cohort before judge experimentation."""
import argparse
from collections import defaultdict
import json
from common import records, output_path, digest, write, read


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pairs',required=True)
    parser.add_argument('--output',required=True)
    parser.add_argument('--validation',type=int,default=100)
    parser.add_argument('--calibration',type=int,default=80)
    parser.add_argument('--minimum-votes',type=int,default=2)
    parser.add_argument('--exclude-groups')
    args=parser.parse_args()
    rows=records(args.pairs)
    excluded=set(read(args.exclude_groups)) if args.exclude_groups else set()
    selected=[]
    for split,limit in [('validation',args.validation),('calibration',args.calibration)]:
        groups=defaultdict(list)
        for row in rows:
            if row['split']==split and row['group'] not in excluded and row['humanWinner']!='tie' and max(row['humanVotes'].values())>=args.minimum_votes and row['a']!=row['b']:
                groups[row['group']].append(row)
        ordered=sorted(groups,key=lambda g:digest(['cohort-v1',g]))
        # Round-robin across source groups before selecting a second pair from one source.
        cohort=[]
        for round_number in range(4):
            for group in ordered:
                choices=sorted(groups[group],key=lambda row:digest(['cohort-v1',row['id']]))
                if len(choices)>round_number:cohort.append(choices[round_number])
        if len(cohort)<limit:raise ValueError('Insufficient independently grouped decisive human preferences.')
        selected.extend(cohort[:limit])
    target=output_path(args.output)
    target.write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in selected),'utf-8')
    write(target.with_suffix('.manifest.json'),{'inputSHA256':digest(rows),'cohortSHA256':digest(selected),
        'selection':'cohort-v1: decisive human votes; at most 4 pairs/source; source-hash order',
        'minimumVotes':args.minimum_votes,'excludedGroups':sorted(excluded),
        'counts':{'validation':args.validation,'calibration':args.calibration}})


if __name__=='__main__':main()
