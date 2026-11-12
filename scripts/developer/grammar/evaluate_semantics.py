"""Score controlled harmful edits separately from human preference calibration."""
import argparse
from collections import Counter
from pathlib import Path
from common import records,read,digest,write,execution_stamp,require_unchanged
from judge import validate,adjudicate


def evaluate(pairs,ratings):
    stamp={}
    for name in ('evaluate_semantics.py','judge.py','common.py'):
        stamp.update(execution_stamp(Path(__file__).with_name(name)))
    gold={p['id']:p for p in pairs}
    if len(gold)!=len(pairs):raise ValueError('Duplicate semantic control ids.')
    if any(pair.get('correctWinner') not in ('A','B') for pair in pairs):
        raise ValueError('Semantic controls require a known good candidate.')
    outcomes={key:'missing' for key in gold};seen=set();verified=0;ordered=0;unstable=0
    categories={name:Counter() for name in {p['category'] for p in pairs}}
    for row in ratings['records']:
        if row['id'] not in gold or row['id'] in seen:raise ValueError('Unknown or duplicate semantic rating.')
        seen.add(row['id']);pair=gold[row['id']]
        if row['pairSHA256']!=digest(pair):raise ValueError('Semantic control was modified after rating.')
        if row.get('winner') not in ('A','B','tie','abstain'):raise ValueError('Invalid semantic winner.')
        responses=row.get('responses')
        if responses is not None:
            if len(responses)!=2:raise ValueError('Semantic judgments require both saved responses.')
            decisions=[]
            for swapped,response in enumerate(responses):
                a,b=(pair['b'],pair['a']) if swapped else (pair['a'],pair['b'])
                decisions.append(validate(response,pair['source'],a,b) if response is not None else 'abstain')
            if row.get('orderDecisions')!=decisions or row['winner']!=adjudicate(*decisions):
                raise ValueError('Semantic winner disagrees with its saved public evidence.')
            ordered+=1;unstable+=decisions[0]!={'A':'B','B':'A','tie':'tie','abstain':'abstain'}[decisions[1]]
            verified+=1
        outcomes[row['id']]='correct' if row['winner']==pair['correctWinner'] else row['winner']
    for key,outcome in outcomes.items():categories[gold[key]['category']][outcome]+=1
    correct=sum(value=='correct' for value in outcomes.values())
    harmful=sum(value in ('A','B') for value in outcomes.values())
    rate=correct/len(pairs) if pairs else 0
    families=len({p['group'] for p in pairs})
    numerical_passed=len(pairs)>=150 and rate>=.95 and harmful==0 and families>=6 and len(categories)>=6
    evidence_verified=bool(seen and verified==len(seen))
    require_unchanged(stamp)
    return {'status':'passed' if numerical_passed and evidence_verified else 'unverified' if numerical_passed else 'failed',
      'scope':'Controlled evaluator mutation detection, not complete product semantic qualification',
      'cases':len(pairs),'correct':correct,'detectionRate':rate,'harmfulPreferences':harmful,
      'missing':len(gold.keys()-seen),'constructionFamilies':families,
      'constructions':sorted({p.get('construction','unspecified') for p in pairs}),
      'categories':{k:dict(v) for k,v in categories.items()},
      'publicEvidenceVerified':evidence_verified,
      'inferenceStatus':ratings.get('status','unverified'),
      'orderCoverage':ordered/len(pairs) if pairs else 0,
      'orderInstability':unstable/ordered if ordered else None,
      'judge':ratings['judge'],'pairsSHA256':digest(pairs),'ratingsSHA256':digest(ratings),
      'evaluationImplementationSHA256':digest(stamp)}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pairs',required=True)
    parser.add_argument('--ratings',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    write(args.output,evaluate(records(args.pairs),read(args.ratings)))


if __name__=='__main__':main()
