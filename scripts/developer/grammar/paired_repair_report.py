"""Reconstruct a matched repair comparison; never certify editorial/Grammarly parity."""
import argparse
from pathlib import Path
from common import corpus,read,records,write,digest,checks,delivered,execution_stamp,require_unchanged
from audit_inference import summarize as audit
from reference_comparison import compare


QUALITY_WITHHOLD_WARNINGS={
    'A sentence proposal was withheld because its spelling could not be verified. Word-level corrections remain available.',
    'A sentence proposal was withheld because grammar or spelling could not be verified. Word-level corrections remain available.'}


def quality_withhold(row):
    """A reported audit veto is not a crashed/timed-out check; both deliver source."""
    return (row.get('serviceStatus')=='partial' and not row.get('displayed')
            and bool(row.get('warnings')) and set(row['warnings'])<=QUALITY_WITHHOLD_WARNINGS
            and not any(call.get('error') for call in row.get('modelTrace',[])))


def matched(data,baseline,candidate,baseline_manifest,candidate_manifest,baseline_reference,candidate_reference):
    reports=[]
    for rows,manifest,reference in ((baseline,baseline_manifest,baseline_reference),
                                    (candidate,candidate_manifest,candidate_reference)):
        result=audit(data,rows,manifest)
        if not result['inferenceComplete']:raise ValueError('Complete source-bound inference is required.')
        if result['maximumModelRequestsPerCase']>2:raise ValueError('Two-call repair budget exceeded.')
        if (reference['resultsSHA256']!=digest(rows) or reference['corpusSHA256']!=digest(data)
            or reference['split']!=manifest['settings']['split'] or reference['missingResults']):
            raise ValueError('Reference report does not bind the complete inference population.')
        reports.append(result)
    left,right=baseline_manifest['settings'],candidate_manifest['settings']
    if left['split']!=right['split'] or left.get('caseSelection')!=right.get('caseSelection'):
        raise ValueError('Compare the same split and case selection.')
    if left['model']!=right['model'] or left['runtime']!=right['runtime']:
        raise ValueError('Same-model repair comparison requires unchanged weights and runtime.')
    examples={case['id']:case for case in data['cases'] if case['split']==left['split']}
    selected=left.get('caseSelection')
    if selected is not None:examples={key:case for key,case in examples.items() if key in selected}
    referenced={key for key,case in examples.items() if case.get('references') or case.get('reference')}
    for reference in (baseline_reference,candidate_reference):
        ids=[row['id'] for row in reference['casesScored']]
        if len(ids)!=len(set(ids)) or set(ids)!=referenced:
            raise ValueError('Reference scoring omits or duplicates eligible cases.')
    failures=[];clean_changes=[];outcomes=[];withholds=[]
    for rows in (baseline,candidate):
        failures.append({row['id']:{(x['kind'],x.get('text','')) for x in checks(examples[row['id']],delivered(row))}
                         for row in rows})
        clean_changes.append({row['id'] for row in rows if examples[row['id']]['track']=='clean'
                              and delivered(row)!=row['source']})
        withholds.append({row['id'] for row in rows if quality_withhold(row)})
        outcomes.append({row['id'] for row in rows if row['status']!='completed' and not quality_withhold(row)})
    new_failures=[{'id':key,'checks':[{'kind':kind,'text':text} for kind,text in sorted(values-failures[0][key])]}
                  for key,values in failures[1].items() if values-failures[0][key]]
    reference=compare(baseline_reference,candidate_reference)
    remaining=reference['baseline']['remainingReferenceErrors']
    populations=[sum(row['counts']['tp']+row['counts']['fn'] for row in report['casesScored'])
                 for report in (baseline_reference,candidate_reference)]
    stable=populations[0]==populations[1]
    reduction=((remaining-reference['candidate']['remainingReferenceErrors'])/remaining if remaining else 0) if stable else None
    return {'scope':__doc__,'status':'measured-not-editorially-qualified',
        'baseline':reports[0],'candidate':reports[1],'referenceComparison':reference,
        'remainingReferenceEditReduction':reduction,
        'referenceEditPopulations':{'baseline':populations[0],'candidate':populations[1],'stable':stable},
        'newLiteralCheckFailures':new_failures,
        'newCleanChanges':sorted(clean_changes[1]-clean_changes[0]),
        'newServiceFailures':sorted(outcomes[1]-outcomes[0]),
        'newQualityWithholds':sorted(withholds[1]-withholds[0]),
        'qualityWithholds':{'baseline':len(withholds[0]),'candidate':len(withholds[1]),
            'policy':'Audit vetoes remain uncorrected source text in reference metrics; never count them as successful corrections.'},
        'diagnosticTargetMet':stable and reduction>=.1 and reference['delta']['precision']>=0
            and reference['delta']['f0.5']>=0 and not new_failures
            and not clean_changes[1]-clean_changes[0] and not outcomes[1]-outcomes[0],
        'limitations':['Human references allow valid alternative rewrites; overlap is not editorial precision.',
            'Output-dependent multi-reference choices can change TP+FN; no remaining-edit reduction is inferred across different reference populations.',
            'Literal controls detect specified violations, not all meaning changes.',
            'Group intervals inherit dataset group quality; missing author IDs cannot establish document independence.',
            'This report cannot promote a model, change an installation or claim Grammarly parity.'],
        'corpusRights':data['rights']}


def main():
    stamp=execution_stamp(__file__)
    import hashlib
    for name in ('audit_inference.py','reference_comparison.py'):
        path=Path(__file__).with_name(name).resolve()
        stamp[str(path)]=hashlib.sha256(path.read_bytes()).hexdigest()
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('corpus','baseline','candidate','baseline-reference','candidate-reference','output'):
        parser.add_argument('--'+name,required=True)
    args=parser.parse_args()
    baseline,candidate=Path(args.baseline),Path(args.candidate)
    result=matched(corpus(args.corpus),records(baseline),records(candidate),
        read(baseline.with_suffix('.manifest.json')),read(candidate.with_suffix('.manifest.json')),
        read(args.baseline_reference),read(args.candidate_reference))
    require_unchanged(stamp);result['reportImplementationSHA256']=digest(stamp)
    write(args.output,result)
    print(__import__('json').dumps({key:result[key] for key in
        ('status','remainingReferenceEditReduction','diagnosticTargetMet','newLiteralCheckFailures','newCleanChanges','newServiceFailures','newQualityWithholds')}))


if __name__=='__main__':main()
