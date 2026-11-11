"""Prepare blind comparisons of delivered outputs, retaining failures and unchanged text."""
import argparse
import json
from pathlib import Path
from common import corpus,records,delivered,digest,output_path,write


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus',required=True)
    parser.add_argument('--baseline',required=True)
    parser.add_argument('--candidate',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    data=corpus(args.corpus)
    baseline=records(args.baseline);candidate=records(args.candidate)
    a,b={r['id']:r for r in baseline},{r['id']:r for r in candidate}
    if len(a)!=len(baseline) or len(b)!=len(candidate):raise ValueError('Repeated candidate result ids.')
    cases={c['id']:c for c in data['cases']}
    if not a or set(a)!=set(b) or not set(a)<=cases.keys():raise ValueError('Unmatched or empty candidate populations.')
    pairs=[]
    for key in sorted(a):
        case=cases[key]
        if a[key]['source']!=case['source'] or b[key]['source']!=case['source']:raise ValueError('Candidate source mismatch.')
        pairs.append({'id':key,'group':case['group'],'split':case['split'],'source':case['source'],
          'context':case.get('context',case['source']),'dialect':case['dialect'],'profile':case['profile'],
          'a':delivered(a[key]),'b':delivered(b[key]),'aStatus':a[key]['status'],'bStatus':b[key]['status']})
        if any('actualComparisonAvailable' in row for row in (a[key],b[key])):
            availability=[row.get('actualComparisonAvailable',True) for row in (a[key],b[key])]
            if any(type(value) is not bool for value in availability):raise ValueError('Comparator availability must be boolean.')
            pairs[-1].update(aAvailable=availability[0],bAvailable=availability[1])
    target=output_path(args.output)
    if target.exists() or Path(str(target)+'.manifest.json').exists():
        raise ValueError('Preserve frozen candidate pairs; use a new output path.')
    target.write_text(''.join(json.dumps(p,ensure_ascii=False)+'\n' for p in pairs),'utf-8')
    write(str(target)+'.manifest.json',{'corpusSHA256':digest(data),'baselineSHA256':digest(baseline),
      'candidateSHA256':digest(candidate),'pairsSHA256':digest(pairs),'cases':len(pairs),
      'scope':'Development comparison, not held-out promotion evidence'})


if __name__=='__main__':main()
