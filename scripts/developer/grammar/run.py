"""Run a frozen, bounded grammar experiment plan without installation or promotion.

Development and explicitly diagnostic validation can proceed when editorial
qualification is incomplete. Sealed tests require a passed, source-bound permit.
Every trial keeps its failures and can resume only its own recorded fingerprints.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from common import ROOT,read,write,corpus,digest,output_path
from qualify import artifact_status


def trials(plan,registry,stage):
    ids=plan['trials'];known={row['id']:row for row in registry['candidates']}
    if not isinstance(ids,list) or not ids or len(set(ids))!=len(ids) or any(key not in known for key in ids):
        raise ValueError('Select distinct registered trials.')
    if len(ids)>registry['trialBudget']['pipelineTrials']:raise ValueError('Pipeline trial budget exceeded.')
    chosen=[known[key] for key in ids]
    if len({row.get('generatorFamily','qwen3.5') for row in chosen})>registry['trialBudget']['modelFamilies']:
        raise ValueError('Generator family budget exceeded.')
    if stage=='validation' and len(ids)>2:raise ValueError('Validate at most two frozen candidates.')
    if stage=='test' and len(ids)!=1:raise ValueError('Qualify one selected candidate against the sealed test.')
    qualified=bool(plan.get('evaluatorEvidence') and artifact_status('evaluator',read(plan['evaluatorEvidence']))=='passed')
    if stage=='validation' and not qualified and plan.get('diagnosticValidation') is not True:
        raise ValueError('Evaluator is unqualified; validation must explicitly remain diagnostic.')
    if stage=='test' and not qualified:raise ValueError('An unqualified evaluator cannot open sealed tests.')
    return chosen,qualified


def verify_archive(root):
    data=read(root/'source-snapshot.json')
    files=data.get('files')
    if not isinstance(files,dict) or not files or data.get('sourceSHA256')!=digest(files):
        raise ValueError('Frozen source manifest identity changed.')
    inventory={str(path.relative_to(root)) for path in [*(root/'backend/alder').rglob('*.py'),
      *(root/'backend/alder').rglob('*.json'),*(root/'scripts/developer/grammar').glob('*.py'),
      *(root/'scripts/developer/grammar').glob('*.json')]}
    listed={str(Path(name)) for name in files}
    if len(listed)!=len(files) or listed!=inventory:
        raise ValueError('Frozen source inventory changed.')
    for name,expected in data['files'].items():
        path=(root/name).resolve()
        if not path.is_relative_to(root.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest()!=expected:
            raise ValueError('Frozen experiment source changed.')
    return data['sourceSHA256']


def sealed_access(data,permit,evaluator,candidate,source_hash):
    if artifact_status('evaluator',evaluator)!='passed':
        raise ValueError('An unqualified evaluator cannot open sealed tests.')
    expected={'protocol':'alder-sealed-test-permit-v1','status':'passed','corpusSHA256':digest(data),
      'candidate':candidate,'sourceSHA256':source_hash,'evaluatorArtifactSHA256':digest(evaluator)}
    if not candidate or any(permit.get(key)!=value for key,value in expected.items()):
        raise ValueError('Sealed-test permit does not bind the corpus, candidate, verified source and evaluator.')
    return {'permitSHA256':digest(permit),'evaluatorArtifactSHA256':digest(evaluator),
            'candidate':candidate,'sourceSHA256':source_hash}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan',required=True);parser.add_argument('--output-directory',required=True)
    parser.add_argument('--stage',choices=['development','validation','test'],default='development')
    parser.add_argument('--registry',type=Path,default=Path(__file__).with_name('experiments.json'))
    args=parser.parse_args();plan=read(args.plan);registry=read(args.registry)
    chosen,qualified=trials(plan,registry,args.stage)
    data=corpus(plan['corpus']);root=output_path(Path(args.output_directory)/'run.json').parent
    if args.stage=='test':
        permit=read(plan['sealedTestPermit'])
        if permit.get('status')!='passed' or permit.get('corpusSHA256')!=digest(data) or permit.get('candidate')!=chosen[0]['id']:
            raise ValueError('Sealed-test permit does not bind this corpus and selected candidate.')
    identities={'corpus':digest(data),'registry':digest(registry),'plan':digest(plan),'stage':args.stage,
      'runner':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    for key,value in plan.get('models',{}).items():identities['model:'+key]=digest(read(value))
    fingerprint=digest(identities);ledger=root/'run.json'
    if ledger.exists() and read(ledger)['fingerprint']!=fingerprint:
        raise ValueError('Experiment plan changed. Preserve this run and use a new protocol directory.')
    report={'fingerprint':fingerprint,'stage':args.stage,'evaluatorQualified':qualified,
      'scope':__doc__,'promotion':'none; qualification is a separate gated decision','trials':[],'status':'running'}
    write(ledger,report)
    prepared={}
    for candidate in chosen:
        folder=root/'trials'/candidate['id'];folder.mkdir(parents=True,exist_ok=True)
        archived=plan.get('sourceArchives',{}).get(candidate['id'])
        source=Path(archived).resolve() if archived else folder/'source';backend=plan.get('backendArchives',{}).get(candidate['id'])
        if not (source/'source-snapshot.json').exists():
            if archived:raise ValueError('Explicit source archive is missing its manifest.')
            argv=[sys.executable,'-B',str(Path(__file__).with_name('freeze.py')),'--directory',str(source)]
            if backend:argv+=['--backend-archive',str(Path(backend).resolve())]
            subprocess.run(argv,check=True,cwd=ROOT)
        source_hash=verify_archive(source)
        if args.stage=='test':sealed_access(data,permit,read(plan['evaluatorEvidence']),candidate['id'],source_hash)
        prepared[candidate['id']]=(folder,source,source_hash)
    if args.stage=='test':
        lock=root/'sealed-test.json'
        if lock.exists() and read(lock)['fingerprint']!=fingerprint:raise ValueError('The sealed test has already been opened for another experiment.')
        write(lock,{'fingerprint':fingerprint,'corpusSHA256':digest(data),'candidate':chosen[0]['id']})
    report['preparedSources']={key:value[2] for key,value in prepared.items()}
    write(ledger,report)
    # Check capacity once before attempts: a large concurrent research judge
    # must not turn an entire validation population into admission failures.
    sys.path.insert(0,str(ROOT/'backend'))
    from alder.proofreading.memory import require_model_memory
    for candidate in chosen:
        require_model_memory()
        folder,source,source_hash=prepared[candidate['id']]
        output=folder/'results.jsonl';stop=folder/'stop'
        if stop.exists():report['status']='interrupted';write(ledger,report);return 2
        pipeline=candidate['pipeline'];extra=[]
        script='generate.py'
        if pipeline in ('minimal','correctness-then-structure','few-shot','semantic-veto','rule-hints','source-diagnosis'):
            script='experiment.py';extra=['--variant',pipeline]
        elif pipeline=='source-hints':extra=['--pipeline',pipeline]
        elif pipeline=='native-template':
            script='native_generate.py'
            if not plan.get('models',{}).get(candidate['id']):raise ValueError('Native-template candidates require a pinned model manifest.')
        elif pipeline!='baseline':raise ValueError('Unsupported registered pipeline.')
        python=plan.get('metricPython',sys.executable) if pipeline=='semantic-veto' else sys.executable
        if pipeline=='semantic-veto':extra+=['--semantic-model',str(Path(plan['semanticModel']).resolve())]
        model=plan.get('models',{}).get(candidate['id'])
        if model:extra+=['--model-manifest',str(Path(model).resolve())]
        if args.stage=='test':extra+=['--sealed-test-permit',str(Path(plan['sealedTestPermit']).resolve()),
          '--evaluator-evidence',str(Path(plan['evaluatorEvidence']).resolve()),'--candidate-id',candidate['id']]
        argv=[str(python),'-B',str(source/'scripts/developer/grammar'/script),*extra,
          '--corpus',str(Path(plan['corpus']).resolve()),'--split',args.stage,
          '--resources',str(Path(plan['resources']).resolve()),'--output',str(output),'--stop-file',str(stop)]
        if plan.get('limit'):argv+=['--limit',str(plan['limit'])]
        environment={**os.environ,'ALDER_PROOFREADING_RESOURCES':str(Path(plan['proofreadingResources']).resolve())}
        started={'id':candidate['id'],'sourceSHA256':source_hash,'pipeline':pipeline,'status':'running','output':str(output)}
        report['trials'].append(started);write(ledger,report)
        with (folder/'inference.log').open('ab') as log:
            process=subprocess.Popen(argv,cwd=source,env=environment,stdout=log,stderr=subprocess.STDOUT)
            try:code=process.wait()
            except KeyboardInterrupt:
                stop.touch();process.wait(timeout=300);report['status']='interrupted';write(ledger,report);return 2
        if digest(corpus(plan['corpus']))!=identities['corpus']:raise ValueError('Experiment corpus changed during inference.')
        manifest=output.with_suffix('.manifest.json')
        started.update(status=read(manifest)['status'] if manifest.exists() else 'failed',exitCode=code,
          manifestSHA256=digest(read(manifest)) if manifest.exists() else None)
        write(ledger,report);print(json.dumps({'trial':candidate['id'],'status':started['status']}),flush=True)
    report['status']='completed' if all(row['status'] in ('completed','limited') and row['exitCode']==0 for row in report['trials']) else 'failed'
    write(ledger,report)
    return 0 if report['status']=='completed' else 2


if __name__=='__main__':raise SystemExit(main())
