"""Audit inference coverage and resources without mistaking completion for quality.

Can read earlier frozen runs. Row-level memory peaks survive a no-work resume;
an empty finalization process must not erase the model's earlier measurements.
"""
import argparse
from collections import Counter
import math
from pathlib import Path
from common import corpus,records,read,write,digest,execution_stamp,require_unchanged


def percentile(values,fraction):
    if not values:return None
    return sorted(values)[max(0,math.ceil(len(values)*fraction)-1)]


def summarize(data,rows,manifest):
    settings=manifest['settings'];split=settings['split']
    if settings['corpus']!=digest(data):raise ValueError('Inference manifest has a different corpus.')
    selection=settings.get('caseSelection')
    expected={case['id']:case for case in data['cases'] if case['split']==split and (selection is None or case['id'] in selection)}
    seen=set();statuses=Counter();outcomes=Counter();warnings=Counter();errors=Counter();coverage=Counter()
    seconds=[];warm=[];cold=[];peaks={name:None for name in ('backend','model','rules')}
    successful_responses=0;without_response=0;max_requests=0
    memory_samples=[manifest.get('memory',{})]
    for row in rows:
        key=row['id']
        if key in seen or key not in expected or row['source']!=expected[key]['source'] or row['fingerprint']!=manifest['fingerprint']:
            raise ValueError('Inference audit contains duplicate, unknown or mismatched results.')
        seen.add(key);statuses[row['status']]+=1;outcomes[row.get('outcome','not recorded')]+=1
        warnings.update(row.get('warnings',[]));case=expected[key]
        for dimension in ('track','dialect','profile'):coverage[dimension+':'+case[dimension]]+=1
        elapsed=row['seconds']
        if type(elapsed) not in (int,float) or not math.isfinite(elapsed) or elapsed<0:
            raise ValueError('Invalid inference timing.')
        seconds.append(elapsed)
        if row.get('coldStart'):
            (cold if any(row['coldStart'].values()) else warm).append(elapsed)
        trace=row.get('modelTrace',[]);max_requests=max(max_requests,len(trace))
        success=sum(isinstance(call.get('proposal'),str) for call in trace)
        successful_responses+=success;without_response+=int(success==0)
        errors.update(call['error'] for call in trace if 'error' in call)
        memory_samples.append(row.get('memory',{}))
    for sample in memory_samples:
        for name,value in sample.get('componentPeakRSSBytes',{}).items():
            if name not in peaks:continue
            if value is None:continue
            if type(value) is not int or value<0:raise ValueError('Invalid memory measurement.')
            peaks[name]=max(peaks[name] or 0,value)
    complete=manifest.get('status')=='completed' and len(seen)==len(expected)
    return {'status':'unverified','scope':__doc__,'inferenceComplete':complete,
      'manifestStatus':manifest.get('status'),'casesExpected':len(expected),'casesRecorded':len(rows),
      'missingCases':sorted(expected.keys()-seen),'serviceStatuses':dict(statuses),'outcomes':dict(outcomes),
      'modelCallsWithResponses':successful_responses,'casesWithoutModelResponse':without_response,
      'modelCallErrors':dict(errors),'maximumModelRequestsPerCase':max_requests,'warnings':dict(warnings),
      'coverage':dict(coverage),'sourceGroups':len({expected[key]['group'] for key in seen}),
      'timing':{'allCases':{'p50Seconds':percentile(seconds,.5),'p95Seconds':percentile(seconds,.95)},
        'warmCases':len(warm),'warmP50Seconds':percentile(warm,.5),'warmP95Seconds':percentile(warm,.95),
        'coldCases':len(cold),'unclassifiedCases':len(seconds)-len(warm)-len(cold),
        'scope':'Development host, including service audits/repair; concurrent workloads are not controlled'},
      'memory':{'componentPeakRSSBytes':peaks,
        'sumComponentPeakRSSBytes':sum(peaks.values()) if all(value is not None for value in peaks.values()) else None,
        'physicalRAMBytes':settings.get('hardware',{}).get('physicalRAMBytes'),
        'scope':'Conservative sum of owned lifetime peaks; not simultaneous RSS or reference-hardware qualification'},
      'corpusSHA256':digest(data),'resultsSHA256':digest(rows),'manifestSHA256':digest(manifest),
      'implementationSHA256':digest(settings['implementation']),'modelSHA256':settings['model'],
      'limitation':'Recorded inference completion, literal checks and resource samples do not establish editorial quality.'}


def main():
    stamp=execution_stamp(__file__)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus',required=True);parser.add_argument('--results',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();data=corpus(args.corpus);rows=records(args.results)
    result=summarize(data,rows,read(Path(args.results).with_suffix('.manifest.json')))
    require_unchanged(stamp);result['auditorSHA256']=digest(stamp);write(args.output,result)
    print(__import__('json').dumps({key:result[key] for key in ('inferenceComplete','casesExpected','casesRecorded','serviceStatuses','casesWithoutModelResponse')}))


if __name__=='__main__':main()
