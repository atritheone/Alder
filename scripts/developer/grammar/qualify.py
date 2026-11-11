"""Combine evidence without treating missing qualification work as success."""
import argparse
import html
from common import read, write, output_path, digest

REQUIRED = ('corpus', 'evaluator', 'correctness', 'meaning', 'clean', 'dialect', 'runtime', 'comparator', 'desktop')


def artifact_status(gate, artifact):
    """A free-form 'passed' string is not evidence that a quality gate passed."""
    if artifact.get('status')=='failed':return 'failed'
    if artifact.get('status')!='passed':return 'unverified'
    protocol=artifact.get('protocol')
    if protocol not in ('alder-grammar-gate-v1','alder-grammar-gate-v2') or artifact.get('gate')!=gate:
        return 'unverified'
    if not artifact.get('corpusSHA256') or not artifact.get('implementationSHA256'):
        return 'unverified'
    if gate=='evaluator':
        judge=artifact.get('judge',{});identity=judge.get('serverIdentity',{}) if isinstance(judge,dict) else None
        if not isinstance(judge,dict) or not isinstance(identity,dict):return 'unverified'
        if artifact.get('referenceAssistedOnly') or judge.get('referenceAssistedOnly') or identity.get('referenceAssistedOnly'):
            return 'unverified'
    metrics=artifact.get('metrics',{})
    try:
        tests={
          'corpus':lambda:metrics['cases']>=1300 and metrics['sealedTestCases']>=600 and metrics['leakedGroups']==0 and metrics['independentSourceGroups']>=130 and metrics['naturalCases']>=300,
          'evaluator':lambda:metrics['qualifiedIndependentFamilies']>=2 and metrics['nonQwenFamilies']>=1 and metrics['pairAgreementLower95']>.75 and metrics['pairAgreement']>=.8 and metrics['rankingSpearman']>=.85 and metrics['harmfulDetection']>=.95 and metrics['orderInstability']<=.05 and metrics['abstentions']<=.1,
          'correctness':lambda:metrics['judgedPrecision']>=.95 and metrics['remainingErrorReduction']>=.1 and metrics['precisionRegressions']==0,
          'meaning':lambda:metrics['testedCases']>=150 and metrics['independentConstructions']>=6 and metrics['criticalFailures']==0 and metrics['significantRegression'] is False,
          'clean':lambda:metrics['cases']>=300 and metrics['unnecessaryRate']<=.02 and metrics['unnecessaryUpper95']<=.05,
          'dialect':lambda:metrics['locales']==['en-AU','en-GB','en-US'] and metrics['regressions']==0 and metrics['creativeRegressions']==0,
          'runtime':lambda:metrics['referenceMemoryGiB']==16 and metrics['warmP95Seconds']<=10 and metrics['peakAdditionalGiB']<=(7 if protocol=='alder-grammar-gate-v2' else 6) and metrics['typingBlocked'] is False,
          'comparator':lambda:metrics['validCases']>=500 and metrics['winTieHalfLower95']>=.48 and metrics['missingOrAbstainedRate']<=.1 and metrics['actualProductCorrections'] is True,
          'desktop':lambda:metrics['failedRequiredChecks']==0 and metrics['offlinePassed'] is True and metrics['sourceSafetyPassed'] is True}
        return 'passed' if tests[gate]() else 'failed'
    except (KeyError,TypeError):return 'unverified'


def qualify(evidence):
    gates = {}
    for gate in REQUIRED:
        item=evidence.get(gate)
        if not item:
            gates[gate]={'status':'unverified','reason':'No evidence supplied.'}
        elif item.get('status') not in ('passed','failed','unverified') or not item.get('artifactSHA256'):
            raise ValueError('Evidence requires a status and artifact hash.')
        else:gates[gate]=item
    states={g['status'] for g in gates.values()}
    status='failed' if 'failed' in states else 'unverified' if 'unverified' in states else 'passed'
    return {'status':status,'promotion':'candidate eligible' if status=='passed' else 'retain incumbent',
            'gates':gates,'evidenceSHA256':digest(evidence),
            'scope':'Qualification decision; no installation, publication or Git mutation'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    # Each evidence entry refers to a local, fingerprinted metric artifact; bind its status to that artifact.
    manifest=read(args.evidence)
    evidence={}
    for gate,path in manifest.items():
        if gate not in REQUIRED:raise ValueError('Unknown qualification gate.')
        artifact=read(path)
        evidence[gate]={'status':artifact_status(gate,artifact),'artifactSHA256':digest(artifact),'path':path}
    contexts={(read(path).get('corpusSHA256'),read(path).get('implementationSHA256')) for path in manifest.values()}
    if len(contexts)>1:raise ValueError('Qualification artifacts refer to different corpora or implementations.')
    report=qualify(evidence)
    write(args.output,report)
    output_path(args.output+'.html').write_text('<!doctype html><meta charset="utf-8"><title>Grammar qualification</title>'
      '<h1>Grammar qualification: '+report['status']+'</h1><p>'+report['promotion']+'</p><pre>'+html.escape(__import__('json').dumps(report,indent=2))+'</pre>','utf-8')
    print(report['status']+': '+report['promotion'])
    return 0 if report['status']=='passed' else 2


if __name__=='__main__':raise SystemExit(main())
