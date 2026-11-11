"""Report each specialist axis; post-hoc diagnostics never qualify an evaluator."""
import argparse
from collections import defaultdict
from common import records,read,digest,write
from compare import interval


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pairs',required=True);parser.add_argument('--ratings',required=True)
    parser.add_argument('--output',required=True);args=parser.parse_args()
    pairs=records(args.pairs);ratings=read(args.ratings)
    gold={p['id']:p for p in pairs}
    if len(gold)!=len(pairs):raise ValueError('Repeated diagnostic input.')
    axes={key for row in ratings['records'] for value in row.get('dimensions',[]) if value for key in value}
    outcomes={axis:{key:0 for key in gold} for axis in axes};seen=set();counts=defaultdict(lambda:defaultdict(int))
    for row in ratings['records']:
        if row['id'] not in gold or row['id'] in seen:raise ValueError('Repeated or unknown diagnostic rating.')
        seen.add(row['id']);pair=gold[row['id']]
        if row['pairSHA256']!=digest(pair):raise ValueError('Diagnostic input changed.')
        a,b=row.get('dimensions',[None,None]);expected=pair.get('humanWinner',pair.get('correctWinner'))
        for axis in axes:
            winner='abstain' if a is None or b is None else 'A' if a[axis]>b[axis] else 'B' if b[axis]>a[axis] else 'tie'
            correct=winner==expected;outcomes[axis][pair['id']]=int(correct)
            counts[axis][pair.get('category','humanPreference')+':'+('correct' if correct else winner)]+=1
    report={}
    for axis,values in outcomes.items():
        grouped=defaultdict(list)
        for key,value in values.items():grouped[gold[key]['group']].append(value)
        report[axis]={'agreement':sum(values.values())/len(gold) if gold else 0,
          'interval':interval(grouped),'counts':dict(counts[axis])}
    write(args.output,{'status':'unverified','scope':__doc__,'axes':report,'cases':len(gold),
      'missing':len(gold)-len(seen),'judge':ratings['judge'],'pairsSHA256':digest(pairs),
      'ratingsSHA256':digest(ratings),'protocol':'post-hoc diagnostic; no selection or promotion gate'})


if __name__=='__main__':main()
