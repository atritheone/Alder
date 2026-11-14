"""Score guard-only replay with human references and explicit safety contracts.

Needs the existing developer ERRANT environment, not an AI judge or API.
Authored challenge outcomes are functional checks, not editorial quality ratings.
"""
import argparse
import contextlib
import io
from pathlib import Path
import sys
from common import read,write,records,corpus,digest,checks,delivered,execution_stamp,require_unchanged
import reference
import generate
from alder.proofreading.revisions import revision_rejection


def challenge_report(cases,profiles):
    if len({case['id'] for case in cases})!=len(cases):raise ValueError('Duplicate challenge ids.')
    result={}
    for key,families in profiles.items():
        rows=[]
        for case in cases:
            admitted=revision_rejection(case['source'],case['target'],case['acceptedWords'],lexical_repairs=families) is None
            expected=case['expectedAdmission'] and case['family'] in families
            rows.append({'id':case['id'],'family':case['family'],'kind':case['kind'],
                         'admitted':admitted,'expectedAdmission':expected})
        result[key]={'faithfulAdmitted':sum(v['kind']=='faithful' and v['admitted'] for v in rows),
          'harmfulAdmitted':[v['id'] for v in rows if v['kind']=='harmful' and v['admitted']],
          'explicitVocabularyFailures':[v['id'] for v in rows if v['kind']=='explicit-vocabulary' and v['admitted']],
          'cases':rows}
    return result


def main():
    stamp=execution_stamp(__file__);implementation=generate.source_snapshot()
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--study',required=True);parser.add_argument('--challenges',required=True)
    parser.add_argument('--output-directory',required=True);args=parser.parse_args()
    study=read(args.study);challenges=read(args.challenges)
    if study['status']!='completed' or study['newModelCalls']!=0:raise ValueError('Complete guard-only study required.')
    output=Path(args.output_directory);cohorts=[]
    for cohort in study['cohorts']:
        data=corpus(cohort['corpus'])
        if digest(data)!=cohort['corpusSHA256']:raise ValueError('Corpus changed.')
        examples={c['id']:c for c in data['cases'] if c['split']==cohort['split']}
        seen={};summaries=[];baseline=records(cohort['results']['0']['path'])
        if len(baseline)!=len(examples):raise ValueError('Incomplete baseline.')
        base={row['id']:row for row in baseline}
        for key,item in cohort['results'].items():
            rows=records(item['path']);identity=digest(rows)
            if identity!=item['sha256'] or len(rows)!=len(examples) or {r['id'] for r in rows}!=set(examples):
                raise ValueError('Results changed or incomplete.')
            if identity not in seen:
                target=output/cohort['name']/('profile-'+key+'.json')
                previous=sys.argv
                try:
                    sys.argv=['reference','--corpus',cohort['corpus'],'--results',item['path'],
                      '--split',cohort['split'],'--reference-aggregation','all-independent','--output',str(target)]
                    with contextlib.redirect_stdout(io.StringIO()):reference.main()
                finally:sys.argv=previous
                seen[identity]=target
            report=read(seen[identity])
            if report['resultsSHA256']!=identity:raise ValueError('Reference results do not bind this profile.')
            changes=[row['id'] for row in rows if delivered(row)!=delivered(base[row['id']])]
            new_failures=[]
            for row in rows:
                case=examples[row['id']]
                failure=lambda text:{(v['kind'],v.get('text','')) for v in checks(case,text)}
                if failure(delivered(row))-failure(delivered(base[row['id']])):new_failures.append(row['id'])
            summaries.append({'profile':key,'families':study['profiles'][key],'overall':report['overall'],
              'referenceAssessments':report['referenceAssessments'],'changedDeliveries':changes,
              'newLiteralFailures':new_failures,'referenceReport':str(seen[identity]),'referenceReportSHA256':digest(report)})
        cohorts.append({'name':cohort['name'],'cases':len(examples),'uniqueOutputs':len(seen),'profiles':summaries})
        print(__import__('json').dumps({'cohort':cohort['name'],'uniqueOutputsScored':len(seen)}),flush=True)
    require_unchanged(stamp)
    if generate.source_snapshot()!=implementation:raise ValueError('Guard implementation changed during reporting.')
    write(output/'summary.json',{'scope':__doc__,'studySHA256':digest(study),'challengeSHA256':digest(challenges),
      'implementation':implementation,'reportIdentity':stamp,'cohorts':cohorts,
      'challenges':challenge_report(challenges['cases'],study['profiles']),
      'limitations':['Previously exposed natural samples; no new independent quality estimate.',
        'Human-reference overlap does not prove editorial quality; authored challenges do not estimate natural error rates.']})


if __name__=='__main__':main()
