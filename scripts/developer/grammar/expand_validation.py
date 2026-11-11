"""Freeze one full held-out expansion after an inconclusive pilot interval.

No score-based sampling: use every eligible validation pair, excluding all
protocol-exposed source groups. Both scorers use the same expanded population.
Use 97.5% intervals for this second look, retaining the original thresholds.
"""
import argparse
import json
from common import records,read,digest,write,output_path


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pairs',required=True)
    parser.add_argument('--exclude-groups',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    rows=records(args.pairs);excluded=set(read(args.exclude_groups))
    selected=[p for p in rows if p['split']=='validation' and p['group'] not in excluded]
    target=output_path(args.output)
    if target.exists():raise ValueError('Do not overwrite a frozen expansion.')
    target.write_text(''.join(json.dumps(p,ensure_ascii=False)+'\n' for p in selected),'utf-8')
    write(str(target)+'.manifest.json',{'inputSHA256':digest(rows),'expansionSHA256':digest(selected),
        'excludedGroups':sorted(excluded),'pairs':len(selected),'groups':len({p['group'] for p in selected}),
        'confidence':.975,'scope':__doc__})
    print(json.dumps({'pairs':len(selected),'groups':len({p['group'] for p in selected})}))


if __name__=='__main__':main()
