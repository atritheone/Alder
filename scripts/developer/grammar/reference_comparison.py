"""Matched, document-clustered reference-edit comparison; not editorial approval."""
import argparse
from collections import defaultdict
import random
from common import read,write,digest


def scores(counts):
    tp,fp,fn=counts
    precision=tp/(tp+fp) if tp+fp else 1.
    recall=tp/(tp+fn) if tp+fn else 1.
    f=.0 if not precision+recall else 1.25*precision*recall/(.25*precision+recall)
    return {'precision':precision,'recall':recall,'f0.5':f,'remainingReferenceErrors':fn}


def compare(baseline,candidate,iterations=4000):
    if baseline['corpusSHA256']!=candidate['corpusSHA256'] or baseline['split']!=candidate['split']:
        raise ValueError('Reference reports have different corpus identities or partitions.')
    if baseline.get('referenceAggregation','official-multi')!=candidate.get('referenceAggregation','official-multi'):
        raise ValueError('Reference aggregation policies differ.')
    def index(report):
        rows={row['id']:row for row in report['casesScored']}
        if len(rows)!=len(report['casesScored']):raise ValueError('Duplicate reference case.')
        return rows
    a,b=index(baseline),index(candidate)
    if a.keys()!=b.keys() or not a:raise ValueError('Compare the same nonempty reference population.')
    groups=defaultdict(lambda:[[0,0,0],[0,0,0]])
    for key,left in a.items():
        right=b[key]
        if any(left[field]!=right[field] for field in ('group','track','dialect')):
            raise ValueError('Reference case grouping or labels changed.')
        for position,row in enumerate((left,right)):
            for column,name in enumerate(('tp','fp','fn')):
                value=row['counts'][name]
                if type(value) is not int or value<0:raise ValueError('Reference counts must be nonnegative integers.')
                groups[left['group']][position][column]+=value
    def totals(selected):
        return [scores([sum(group[position][column] for group in selected) for column in range(3)]) for position in (0,1)]
    overall=totals(list(groups.values()));samples=defaultdict(list);rng=random.Random(917)
    if len(groups)>1:
        for _ in range(iterations):
            left,right=totals(rng.choices(list(groups.values()),k=len(groups)))
            for name in left:samples[name].append(right[name]-left[name])
    intervals={name:None for name in overall[0]}
    for name,values in samples.items():
        values.sort();intervals[name]=[values[int(iterations*.025)],values[min(iterations-1,int(iterations*.975))]]
    return {'status':'unverified','scope':__doc__,'cases':len(a),'independentGroups':len(groups),
      'baseline':overall[0],'candidate':overall[1],
      'delta':{name:overall[1][name]-overall[0][name] for name in overall[0]},
      'delta95DocumentBootstrap':intervals,'bootstrapIterations':iterations,'bootstrapSeed':917,
      'corpusSHA256':baseline['corpusSHA256'],'split':baseline['split'],
      'baselineReportSHA256':digest(baseline),'candidateReportSHA256':digest(candidate),
      'limitation':'Reference overlap can penalise valid paraphrases; these intervals do not establish editorial precision or Grammarly parity.'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline',required=True);parser.add_argument('--candidate',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();result=compare(read(args.baseline),read(args.candidate))
    write(args.output,result)
    print(__import__('json').dumps({key:result[key] for key in ('cases','independentGroups','delta','delta95DocumentBootstrap')}))


if __name__=='__main__':main()
