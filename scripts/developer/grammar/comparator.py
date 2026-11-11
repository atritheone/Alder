"""Source-aligned comparator capture bundles; never invent product corrections.

This adapter validates declared provenance and file integrity, not whether a
third-party product actually issued an edit. Collector validation and independent
editorial qualification remain separate. Missing captures stay missing.
"""
import argparse
from collections import Counter
from datetime import datetime
import hashlib
import json
from pathlib import Path
from common import ROOT,corpus,digest,read,write,output_path


def bundle(data,split,configuration,sealed=None):
    if split not in ('development','validation','test'):raise ValueError('Unknown comparator partition.')
    if split=='test' and not sealed:raise ValueError('Sealed comparator export requires a bound permit.')
    if configuration.get('product')!='Grammarly for Word':raise ValueError('Declare the intended comparator product.')
    if not isinstance(configuration.get('settings'),dict):raise ValueError('Record the actual comparator settings.')
    cases=[{key:case[key] for key in ('id','group','split','source','dialect','profile','track')}
           | {'context':case.get('context',case['source']),'sourceSHA256':digest(case['source'])}
           for case in data['cases'] if case['split']==split]
    if not cases:raise ValueError('Comparator partition is empty.')
    if any(case['context'].count(case['source'])!=1 for case in cases):
        raise ValueError('Comparator target must occur exactly once in context.')
    return {'schemaVersion':1,'corpusSHA256':digest(data),'split':split,'configuration':configuration,
      'configurationSHA256':digest(configuration),'cases':cases,'sealedAccess':sealed,
      'scope':'Prepared source text only; no Word/Grammarly action, correction or quality result.'}


def import_capture(prepared,capture,directory):
    if capture.get('bundleSHA256')!=digest(prepared):raise ValueError('Comparator capture refers to a different source bundle.')
    expected={case['id']:case for case in prepared['cases']}
    if len(expected)!=len(prepared['cases']):raise ValueError('Duplicate comparator input ids.')
    if any(case['sourceSHA256']!=digest(case['source']) for case in expected.values()):
        raise ValueError('Comparator bundle source binding changed.')
    supplied={};evidence_hashes={};counts=Counter();result=[]
    for row in capture['records']:
        key=row['id']
        if key not in expected or key in supplied:raise ValueError('Unknown or duplicate comparator capture.')
        case=expected[key]
        if row.get('sourceSHA256')!=case['sourceSHA256'] or row.get('dialect')!=case['dialect']:
            raise ValueError('Comparator source or locale changed.')
        status=row.get('status')
        if status not in ('corrected','unchanged','missing','abstained'):raise ValueError('Unknown comparator capture status.')
        if status in ('corrected','unchanged'):
            proposal=row.get('proposal')
            if not isinstance(proposal,str) or not proposal.strip() or len(proposal)>65536:
                raise ValueError('Comparator resulting text must be explicit and nonempty.')
            if (proposal==case['source'])!=(status=='unchanged'):
                raise ValueError('Comparator unchanged/corrected label disagrees with its exact text.')
            timestamp=datetime.fromisoformat(row['capturedAt'])
            if timestamp.utcoffset() is None:raise ValueError('Comparator capture date requires a timezone.')
            for field in ('productVersion','wordVersion','method','suggestionCategory'):
                if not isinstance(row.get(field),str) or not row[field].strip():
                    raise ValueError('Comparator capture lacks version, method or category provenance.')
            if not isinstance(row.get('evidence'),list) or not row['evidence']:
                raise ValueError('Comparator observations require retained capture evidence.')
            for item in row['evidence']:
                path=(directory/item['path']).resolve()
                if not path.is_relative_to(directory.resolve()) or not path.is_file():
                    raise ValueError('Comparator evidence escaped its retained capture directory.')
                hasher=hashlib.sha256()
                with path.open('rb') as stream:
                    for chunk in iter(lambda:stream.read(4*1024*1024),b''):hasher.update(chunk)
                if hasher.hexdigest()!=item['sha256']:raise ValueError('Comparator evidence changed.')
                evidence_hashes[item['path']]=hasher.hexdigest()
        supplied[key]=row
    for key,case in expected.items():
        row=supplied.get(key,{'status':'missing'});status=row['status'];available=status in ('corrected','unchanged')
        counts[status]+=1
        proposal=row['proposal'] if available else case['source']
        result.append({'id':key,'group':case['group'],'source':case['source'],'proposal':proposal,
          'status':'completed' if available else 'failed','displayed':available and proposal!=case['source'],
          'comparatorStatus':status,'actualComparisonAvailable':available,
          'provenance':{k:v for k,v in row.items() if k not in ('id','proposal','sourceSHA256')},
          'fingerprint':digest([digest(prepared),digest(capture)])})
    return result,{'status':'unverified','scope':__doc__,'casesExpected':len(expected),
      'captureStatuses':dict(counts),'available':sum(counts[key] for key in ('corrected','unchanged')),
      'bundleSHA256':digest(prepared),'captureSHA256':digest(capture),'resultsSHA256':digest(result),
      'retainedEvidenceSHA256':evidence_hashes,'actualProductCorrections':None,
      'limitation':'Aligned declarations and evidence hashes do not authenticate Grammarly edits or qualify the collector. Fallback source for missing/abstained captures is not an observed unchanged decision.'}


def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='action',required=True)
    prepare=sub.add_parser('prepare');prepare.add_argument('--corpus',required=True)
    prepare.add_argument('--configuration',required=True);prepare.add_argument('--split',choices=['development','validation','test'],default='validation')
    prepare.add_argument('--sealed-test-permit');prepare.add_argument('--evaluator-evidence');prepare.add_argument('--candidate-id')
    ingest=sub.add_parser('import');ingest.add_argument('--bundle',required=True);ingest.add_argument('--capture',required=True)
    for command in (prepare,ingest):command.add_argument('--output',required=True)
    args=parser.parse_args();target=output_path(args.output)
    if target.exists() or Path(str(target)+'.manifest.json').exists():raise ValueError('Preserve previous comparator artifacts.')
    if args.action=='prepare':
        data=corpus(args.corpus);sealed=None
        if args.split=='test':
            if not args.sealed_test_permit or not args.evaluator_evidence or not args.candidate_id:
                raise ValueError('Sealed comparator export requires a bound permit.')
            from run import verify_archive,sealed_access
            sealed=sealed_access(data,read(args.sealed_test_permit),read(args.evaluator_evidence),args.candidate_id,verify_archive(ROOT))
        result=bundle(data,args.split,read(args.configuration),sealed);write(target,result)
        print(json.dumps({'preparedCases':len(result['cases']),'split':args.split}))
    else:
        capture=Path(args.capture).resolve();rows,report=import_capture(read(args.bundle),read(capture),capture.parent)
        target.write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in rows),'utf-8')
        write(str(target)+'.manifest.json',report)
        print(json.dumps({key:report[key] for key in ('status','casesExpected','captureStatuses','available')}))


if __name__=='__main__':main()
