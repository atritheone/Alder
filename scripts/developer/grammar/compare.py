"""Document-cluster bootstrap and source-bound candidate comparison."""
import argparse
from collections import defaultdict
import random
from common import corpus, records, checks, delivered, write


def interval(values, iterations=2000, seed=917, alpha=.05):
    """Values are grouped by source document/family, not assumed independent."""
    if len(values) < 2:
        return None
    rng = random.Random(seed)
    groups = list(values.values())
    samples = []
    for _ in range(iterations):
        sample = [x for group in rng.choices(groups, k=len(groups)) for x in group]
        samples.append(sum(sample)/len(sample))
    samples.sort()
    return [samples[int(iterations*alpha/2)], samples[min(iterations-1,int(iterations*(1-alpha/2)))]]


def summarize(data, results):
    expected = {c['id']: c for c in data['cases']}
    seen, groups, failures, tracks = set(), defaultdict(list), [], defaultdict(lambda: {'cases': 0, 'failedChecks': 0})
    ungraded=[]
    for row in results:
        if row['id'] not in expected or row['id'] in seen or row['source'] != expected[row['id']]['source']:
            raise ValueError('Duplicate, unknown or source-mismatched result.')
        seen.add(row['id']); case = expected[row['id']]
        defects = checks(case, delivered(row))
        tracks[case['track']]['cases'] += 1
        tracks[case['track']]['failedChecks'] += len(defects)
        if case['track']=='clean' or any(case.get(key) for key in ('required','forbidden','protected')):
            groups[case['group']].append(int(not defects and row['status'] == 'completed'))
        else:ungraded.append(case['id'])
        if defects or row['status'] != 'completed':
            failures.append({'id': row['id'], 'status': row['status'], 'checks': defects})
    return {'cases': len(results), 'missing': sorted(set(expected)-seen), 'failures': failures,
            'tracks': dict(tracks), 'checkPassInterval': interval(groups),'ungraded':ungraded,
            'checkedCases':len(results)-len(ungraded),
            'scope': 'Deterministic checks, not independent editorial qualification'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus', required=True)
    parser.add_argument('--results', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--split', choices=['development','validation','test'])
    args = parser.parse_args()
    data=corpus(args.corpus);results=records(args.results)
    if args.split:
        all_cases={case['id']:case for case in data['cases']}
        if any(row['id'] not in all_cases for row in results):raise ValueError('Unknown result id.')
        data={**data,'cases':[case for case in data['cases'] if case['split']==args.split]}
        results=[row for row in results if all_cases[row['id']]['split']==args.split]
    write(args.output, summarize(data,results))


if __name__ == '__main__':
    main()
