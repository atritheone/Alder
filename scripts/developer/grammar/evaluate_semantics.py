"""Score controlled harmful edits separately from human preference calibration."""
import argparse
from collections import Counter
from common import records,read,digest,write


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pairs',required=True)
    parser.add_argument('--ratings',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    pairs=records(args.pairs);ratings=read(args.ratings)
    gold={p['id']:p for p in pairs}
    if len(gold)!=len(pairs):raise ValueError('Duplicate semantic control ids.')
    outcomes={key:'missing' for key in gold}
    seen=set();categories={name:Counter() for name in {p['category'] for p in pairs}}
    for row in ratings['records']:
        if row['id'] not in gold or row['id'] in seen:raise ValueError('Unknown or duplicate semantic rating.')
        seen.add(row['id']);pair=gold[row['id']]
        if row['pairSHA256']!=digest(pair):raise ValueError('Semantic control was modified after rating.')
        outcomes[row['id']]='correct' if row['winner']==pair['correctWinner'] else row['winner']
    for key,outcome in outcomes.items():categories[gold[key]['category']][outcome]+=1
    correct=sum(value=='correct' for value in outcomes.values())
    rate=correct/len(pairs) if pairs else 0
    write(args.output,{'status':'passed' if len(pairs)>=150 and rate>=.95 else 'failed',
      'scope':'Controlled evaluator mutation detection, not complete product semantic qualification',
      'cases':len(pairs),'correct':correct,'detectionRate':rate,'categories':{k:dict(v) for k,v in categories.items()},
      'judge':ratings['judge'],'pairsSHA256':digest(pairs)})


if __name__=='__main__':main()
