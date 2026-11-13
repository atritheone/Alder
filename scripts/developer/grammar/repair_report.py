"""Summarise a fixed same-model development trial without claiming promotion.

This report never substitutes reference overlap for editorial/semantic approval
and cannot open the old sealed test set or change the installed configuration.
"""
import argparse
from collections import Counter
import math
from common import read,records,write,digest


def summarize(cases,rows):
    expected={c['id']:c for c in cases};seen=set();tracks={};reasons=Counter();first_rejections=Counter()
    latencies=[];cold=[];calls=[];failures=0;changed=0
    from alder.proofreading.revisions import revision_rejection
    from alder.proofreading.invariants import source_identifiers
    for row in rows:
        if row['id'] not in expected or row['id'] in seen or row['source']!=expected[row['id']]['source']:
            raise ValueError('Unknown, repeated or source-mismatched result.')
        seen.add(row['id']);case=expected[row['id']]
        trace=row.get('modelTrace',[]);calls.append(len(trace))
        if len(trace)>2:raise ValueError('Shared two-call budget exceeded.')
        seconds=row['seconds']
        if not isinstance(seconds,(int,float)) or not math.isfinite(seconds) or seconds<0:raise ValueError('Invalid latency.')
        (cold if row.get('coldStart',{}).get('model') else latencies).append(seconds)
        output=row['proposal'] if row['status']=='completed' else row['source']
        failures+=row['status']!='completed';changed+=output!=row['source']
        item=tracks.setdefault(case['track'],Counter(cases=0,changed=0,exactReference=0,failedRequirements=0))
        item['cases']+=1;item['changed']+=output!=row['source']
        refs=case.get('references') or ([case['reference']] if case.get('reference') else [])
        item['exactReference']+=output in refs
        required=all(value in output for value in case.get('required',[]))
        forbidden=not any(value in output for value in case.get('forbidden',[]))
        protected=all(output.count(value)==case['source'].count(value) for value in case.get('protected',[]))
        item['failedRequirements']+=not (required and forbidden and protected)
        for audit in row.get('revisionAudit',[]):reasons[audit['reason']]+=1
        if trace and trace[0].get('proposal') is not None:
            accepted=sorted(set(case.get('acceptedWords',[]))|source_identifiers(case['source']))
            reason=revision_rejection(case['source'],trace[0]['proposal'],accepted)
            if reason:first_rejections[reason]+=1
    if seen!=expected.keys():raise ValueError('Incomplete population cannot close this trial.')
    latencies.sort()
    return {'cases':len(rows),'changed':changed,'serviceFailuresOrWithholds':failures,
      'tracks':{key:dict(value) for key,value in tracks.items()},'maximumModelCalls':max(calls,default=0),
      'twoCallCases':sum(value==2 for value in calls),'repairOutcomes':dict(reasons),
      'firstDraftRejectionReasons':dict(first_rejections),
      'warmP95Seconds':latencies[min(len(latencies)-1,math.ceil(.95*len(latencies))-1)] if latencies else None,
      'coldSeconds':cold,'warmCases':len(latencies),
      'limitation':'First-draft reason reconstruction uses source identifiers and explicit case vocabulary; final service decisions and raw traces remain authoritative. Exact-reference matches and required-string controls do not prove all grammar/meaning correct.'}


def main():
    from pathlib import Path
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,required=True);args=parser.parse_args();root=args.root
    plan=read(root/'study-manifest.json');data=read(root/'development.json')
    result={'status':'inconclusive','decision':'retain-incumbent','scope':__doc__,
      'planSHA256':digest(plan),'developmentSHA256':digest(data),
      'modelSHA256':plan['modelSHA256'],'newInferenceModels':0,'paidRequests':0,
      'baseline':summarize(data['cases'],records(root/'baseline-development/results.jsonl')),
      'candidate':summarize(data['cases'],records(root/'candidate-development/results.jsonl')),
      'referenceComparison':read(root/'reference-comparison.json'),
      'validationPermission':{'unusedGroups':plan['validationGroups'],'cases':plan['validationCases'],
        'eligible':plan['validationGroups']>=20,'reason':'All 597 original validation cases were already queried; no unused core validation groups remain. Old sealed tests remain closed.'},
      'promotion':'No default change; requires independent final evidence beyond this development comparison.'}
    ref=result['referenceComparison'];base=ref['baseline']['remainingReferenceErrors'];cand=ref['candidate']['remainingReferenceErrors']
    result['remainingReferenceErrorReduction']=(base-cand)/base if base else 0
    result['developmentBenefitTargetMet']=result['remainingReferenceErrorReduction']>=.1 and ref['delta']['precision']>=0
    if not result['developmentBenefitTargetMet']:result['status']='failed-development-benefit'
    write(root/'scoped-report.json',result)
    print(__import__('json').dumps({key:result[key] for key in ('status','decision','remainingReferenceErrorReduction','developmentBenefitTargetMet')}))


if __name__=='__main__':
    import sys
    from pathlib import Path
    sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'backend'))
    main()
