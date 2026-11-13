"""Resumable evaluation of the delivered local proofreading service, never user data."""
import argparse
import hashlib
import json
import os
import platform
import sys
import time
from pathlib import Path
from common import ROOT, corpus, digest, output_path, read, write, records
from memory import Monitor,physical_memory

sys.path.insert(0, str(ROOT / 'backend'))
from alder.proofreading.service import ProofreadingService
from alder.proofreading.revisions import spelling_issues


def source_snapshot():
    paths=list((ROOT/'backend/alder').rglob('*.py'))+list((ROOT/'backend/alder').rglob('*.json'))
    paths += [Path(__file__).parent/name for name in ('generate.py','common.py','memory.py','repair_study.py')]
    return {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}


def runtime_snapshot(service):
    resource=service.resources
    paths=[resource.java,resource.rules,resource.python]
    packages=[resource.python.parent/'Lib/site-packages',resource.python.parent.parent/'Lib/site-packages']
    packages+=list((resource.python.parent.parent/'lib').glob('python*/site-packages'))
    for directory in packages:
        for package in ('llama_cpp','numpy'):
            paths.extend(p for p in (directory/package).rglob('*') if p.is_file() and p.suffix in ('.py','.dll','.pyd','.so'))
    result={}
    for path in sorted(set(paths)):
        if not path.is_file():continue
        hasher=hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda:stream.read(4*1024*1024),b''):hasher.update(chunk)
        result[str(path.resolve())]=hasher.hexdigest()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus', required=True)
    parser.add_argument('--resources', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--split', choices=['development', 'validation', 'test'], default='development')
    parser.add_argument('--limit', type=int)
    parser.add_argument('--case-ids',nargs='+',help='Explicit targeted regressions; selection is fingerprinted')
    parser.add_argument('--timeout', type=float, default=300)
    parser.add_argument('--pipeline',choices=['baseline','source-hints','grammar-audit'],default='baseline')
    parser.add_argument('--model-manifest',type=Path,help='Explicit separately verified developer candidate; never an installed pin change')
    parser.add_argument('--stop-file',type=Path,help='External cancellation signal; completed records remain resumable')
    parser.add_argument('--sealed-test-permit',type=Path)
    parser.add_argument('--evaluator-evidence',type=Path)
    parser.add_argument('--candidate-id',help='Selected registered candidate bound by the sealed-test permit')
    args = parser.parse_args()
    data = corpus(args.corpus)
    sealed=None
    if args.split=='test':
        if not args.sealed_test_permit or not args.evaluator_evidence or not args.candidate_id:
            raise ValueError('Direct generation cannot open sealed tests without a source/evaluator-bound permit.')
        from run import verify_archive,sealed_access
        sealed=sealed_access(data,read(args.sealed_test_permit),read(args.evaluator_evidence),
                             args.candidate_id,verify_archive(ROOT))
    target = output_path(args.output)
    if args.stop_file and args.stop_file.resolve().is_relative_to(ROOT):
        raise ValueError('Cancellation state must be outside the checkout.')
    service_type=ProofreadingService
    if args.pipeline=='grammar-audit':
        from repair_study import GrammarRepairService
        service_type=GrammarRepairService
    service = service_type(Path(args.resources), target.parent / 'service-data')
    monitor=Monitor(service);monitor.start()
    if args.model_manifest:
        candidate=read(args.model_manifest)['model']
        model=(args.model_manifest.resolve().parent/candidate['file']).resolve()
        if not model.is_relative_to(args.model_manifest.resolve().parent) or not model.is_file():
            raise ValueError('Candidate model is missing or escaped its manifest directory.')
        service.resources.model=model
        service.resources.model_hash=candidate['sha256']
        service.resources.revision=candidate['revision']
        service.resources.manifest={**service.resources.manifest,'model':candidate}
    original_check=service.model.check
    active_trace=[[]]
    def traced_check(text,config,cancelled):
        trace=active_trace[0]
        started=time.monotonic()
        if args.pipeline=='source-hints':
            if config.get('task')=='revise' and not config.get('spellingRepair'):
                findings=spelling_issues(text,service.rules.check(text,config),config['acceptedWords'])
                config={**config,'spellingIssues':[{'word':item['originalText'][:64],
                  'suggestions':[a['edits'][0]['replacement'][:64] for a in item.get('alternatives',[])[:3]
                   if len(a['edits'])==1]} for item in findings[:12]]}
        try:
            value=original_check(text,config,cancelled)
            trace.append({'source':text,'proposal':value,'phase':'grammar-repair' if config.get('grammarRepair') else 'spelling-repair' if config.get('spellingRepair') else 'generation',
                          'repairReason':config.get('repairReason'),'configurationSHA256':digest(config),
                          'seconds':time.monotonic()-started})
            return value
        except BaseException as error:
            trace.append({'source':text,'error':type(error).__name__,'seconds':time.monotonic()-started})
            raise
    service.model.check=traced_check
    implementation = source_snapshot()
    runtime=runtime_snapshot(service)
    selection=set(args.case_ids) if args.case_ids else None
    available={case['id'] for case in data['cases'] if case['split']==args.split}
    if selection is not None and (len(selection)!=len(args.case_ids) or not selection<=available):
        raise ValueError('Case selection contains repeated, unknown or out-of-split ids.')
    settings = {'corpus': digest(data), 'split': args.split, 'caseSelection':sorted(selection) if selection else None,'implementation': implementation,
                'model': service.resources.model_hash, 'resources': service.resources.manifest,'runtime':runtime,
                'timeout': args.timeout, 'platform': platform.platform(),'pipeline':args.pipeline,
                'scope':'Selected target with read-only paragraph context',
                'hardware':{'processor':os.environ.get('PROCESSOR_IDENTIFIER',platform.processor()),'logicalCores':os.cpu_count(),
                            'physicalRAMBytes':physical_memory()}}
    if sealed is not None:settings['sealedAccess']=sealed
    fingerprint = digest(settings)
    manifest = target.with_suffix('.manifest.json')
    previous = records(target) if target.exists() else []
    if previous and (not manifest.exists() or read(manifest)['fingerprint'] != fingerprint):
        raise ValueError('Cannot resume results with a different corpus/runtime/source fingerprint.')
    done = {r['id'] for r in previous}
    if len(done) != len(previous) or any(r.get('fingerprint') != fingerprint for r in previous):
        raise ValueError('Duplicate or mismatched resumed result.')
    expected={case['id']:case for case in data['cases'] if case['split']==args.split and (selection is None or case['id'] in selection)}
    if any(row['id'] not in expected or row['source']!=expected[row['id']]['source'] for row in previous):
        raise ValueError('Resumed results have a different source or population.')
    write(manifest, {'fingerprint': fingerprint, 'settings': settings,'status':'running'})
    cases = [c for c in expected.values() if c['id'] not in done]
    if args.limit is not None:
        if args.limit < 1: raise ValueError('Limit must be positive.')
        cases = cases[:args.limit]
    stopped=False
    try:
        for case in cases:
            if args.stop_file and args.stop_file.exists():stopped=True;break
            if source_snapshot()!=implementation:raise ValueError('Generation source changed during the run.')
            begin = time.monotonic()
            cold={'model':service.model.process is None,'rules':service.rules.process is None}
            active_trace[0]=[]
            if hasattr(service.model,'evaluation_trace'):service.model.evaluation_trace=[]
            if hasattr(service,'revision_trace'):service.revision_trace=[]
            case_trace=active_trace[0]
            context = case.get('context', case['source'])
            if context.count(case['source']) != 1:
                raise ValueError('Target must occur exactly once in its evaluation context.')
            offset = len(context[:context.index(case['source'])].encode('utf-16-le'))//2
            job = service.start({'text': context, 'targetId': 'evaluation', 'revision': True,
                                 'range': {'start':offset,'end':offset+len(case['source'].encode('utf-16-le'))//2},
                                 'languageRanges':[{**r,'start':r['start']+offset,'end':r['end']+offset} for r in case.get('languageRanges',[])],
                                 'configuration': {'dialect': case['dialect'],
                                 'revisionProfile': case['profile'], 'acceptedWords': case.get('acceptedWords', [])}})
            while job['status'] not in ('completed', 'partial', 'failed', 'cancelled'):
                if args.stop_file and args.stop_file.exists():
                    service.cancel(job['id']);stopped=True;break
                if time.monotonic() - begin > args.timeout:
                    service.cancel(job['id'])
                    job = {**job, 'status': 'failed', 'warnings': ['Evaluation deadline exceeded.'], 'annotations': []}
                    break
                time.sleep(.05)
                job = service.get(job['id'])
            if stopped:break  # An operational interruption is retried on resume, never graded as a correction.
            if source_snapshot()!=implementation:raise ValueError('Generation source changed during inference; the current case is not recorded.')
            proposal = case['source']
            for item in sorted(job['annotations'], key=lambda a: a['start'], reverse=True):
                encoded = proposal.encode('utf-16-le')
                start,end=item['start']-offset,item['end']-offset
                if not 0 <= start <= end <= len(encoded)//2: raise ValueError('Service result escaped the requested target.')
                proposal = (encoded[:start*2] + item['replacementText'].encode('utf-16-le') + encoded[end*2:]).decode('utf-16-le')
            record = {'id': case['id'], 'group': case['group'], 'fingerprint': fingerprint,
                      'source': case['source'], 'proposal': proposal, 'displayed': bool(job['annotations']),
                      'status': 'completed' if job['status'] == 'completed' else 'failed',
                      'serviceStatus': job['status'], 'warnings': job['warnings'],
                      'seconds': time.monotonic()-begin,'modelTrace':case_trace,
                      'pipelineTrace':getattr(service.model,'evaluation_trace',[]),
                      'revisionAudit':getattr(service,'revision_trace',[]),
                      'coldStart':cold,
                      'memory':monitor.result(),
                      'outcome':'displayed' if job['annotations'] else 'suppressed' if any(r.get('proposal')!=r['source'] for r in [*case_trace,*getattr(service.model,'evaluation_trace',[])] if 'proposal' in r) else 'unchanged'}
            with target.open('a', encoding='utf-8') as stream:
                stream.write(json.dumps(record, ensure_ascii=False)+'\n')
                stream.flush(); os.fsync(stream.fileno())
            print(json.dumps({'id': case['id'], 'status': record['status'], 'seconds': round(record['seconds'], 2)}), flush=True)
        if source_snapshot()!=implementation:raise ValueError('Generation source changed during the run.')
        if runtime_snapshot(service)!=runtime:raise ValueError('Evaluation runtime changed during the run.')
        recorded=len(records(target)) if target.exists() else 0
        write(manifest,{'fingerprint':fingerprint,'settings':settings,'status':'interrupted' if stopped else 'completed' if recorded==len(expected) else 'limited',
                        'casesRecorded':recorded,'casesExpected':len(expected),'memory':monitor.result()})
    except BaseException as error:
        write(manifest,{'fingerprint':fingerprint,'settings':settings,
          'status':'interrupted' if isinstance(error,KeyboardInterrupt) else 'invalidated' if isinstance(error,ValueError) else 'failed',
          'errorType':type(error).__name__,'casesRecorded':len(records(target)) if target.exists() else 0,
          'casesExpected':len(expected),'memory':monitor.result()})
        raise
    finally:
        monitor.close()
        service.shutdown()


if __name__ == '__main__':
    main()
