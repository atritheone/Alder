"""Replay the incumbent finaliser once, then ablate guards without model inference.

All 32 family combinations see exactly the same spelling/plural-audited draft.
Prior exposed corpora are diagnostics, never newly independent validation.
"""
import argparse
import itertools
import json
from pathlib import Path
import sys
import time
from common import ROOT,corpus,read,records,write,digest,output_path,execution_stamp,require_unchanged
import generate
from replay import recorded_engine,recorded_request,request_payload
from alder.proofreading.service import ProofreadingService
from alder.proofreading.revisions import revision
from alder.proofreading.lexical_repairs import REPAIR_FAMILIES
from alder.proofreading.contracts import u16


def profiles():
    names=sorted(REPAIR_FAMILIES)
    return {str(mask):[name for i,name in enumerate(names) if mask & (1<<i)]
            for mask in range(1<<len(names))}


def annotations(source,draft,config,arms):
    enabled=config.get('revisionProfile')!='creative' and config.get('revisionMode')!='rephrase'
    return {key:revision(source,draft,config['acceptedWords'],lexical_repairs=families if enabled else False)
            for key,families in arms.items()}


def capture(config_path,output):
    stamp=execution_stamp(__file__);implementation=generate.source_snapshot()
    config=read(config_path);arms=profiles();identity=digest([config,implementation,stamp,arms])
    target=output_path(Path(output)/'study.json')
    if target.exists():raise ValueError('Do not overwrite a completed study.')
    directory=target.parent;cohorts=[]
    for cohort in config['cohorts']:
        data=corpus(cohort['corpus']);native=records(cohort['recorded'])
        origin=read(Path(cohort['recorded']).with_suffix('.manifest.json'))
        if origin['status']!='completed' or origin['settings']['corpus']!=digest(data):
            raise ValueError('Complete source-bound native inference is required.')
        examples={c['id']:c for c in data['cases'] if c['split']==cohort['split']}
        if len(native)!=len(examples) or {r['id'] for r in native}!=set(examples):
            raise ValueError('Native corpus coverage is incomplete or duplicated.')
        if any(row['source']!=examples[row['id']]['source'] for row in native):
            raise ValueError('Recorded source text changed.')
        old_engine,archive_hash=recorded_engine(Path(cohort['archive']),origin,implementation)
        service=ProofreadingService(Path(config['resources']),directory/cohort['name']/'service-data')
        service._source_repair_enabled=False
        runtime=generate.runtime_snapshot(service)
        if origin['settings']['model']!=service.resources.model_hash or origin['settings']['runtime']!=runtime:
            service.shutdown();raise ValueError('Model/runtime identity changed.')
        outputs={key:[] for key in arms};audits=[]
        try:
            for position,row in enumerate(native):
                case=examples[row['id']];used=[];captured=[];trace=row['modelTrace']
                if not trace or any('error' in call for call in trace):raise ValueError('Cannot replay failed inference.')
                def recorded(text,configuration,cancelled):
                    if cancelled():raise InterruptedError()
                    value=recorded_request(trace,used,text,configuration)
                    if request_payload(old_engine,text,configuration)!=request_payload(type(service.model),text,configuration):
                        raise ValueError('Serialized request changed; fresh inference required.')
                    return value
                def validate(source,draft,configuration):
                    captured.append((source,draft,configuration))
                    return revision(source,draft,configuration['acceptedWords'])
                service.model.check=recorded;service._revision_annotation=validate
                context=case.get('context',case['source'])
                if context.count(case['source'])!=1:raise ValueError('Ambiguous target context.')
                offset=u16(context[:context.index(case['source'])])
                job=service.start({'text':context,'targetId':'guard-ablation','revision':True,
                  'range':{'start':offset,'end':offset+u16(case['source'])},
                  'languageRanges':[{**span,'start':span['start']+offset,'end':span['end']+offset} for span in case.get('languageRanges',[])],
                  'configuration':{'dialect':case['dialect'],'revisionProfile':case['profile'],'acceptedWords':case.get('acceptedWords',[])}})
                deadline=time.monotonic()+60
                while job['status'] not in ('completed','partial','failed','cancelled'):
                    if time.monotonic()>deadline:raise RuntimeError('Replay timed out.')
                    time.sleep(.005);job=service.get(job['id'])
                if len(captured)!=1 or captured[0][0]!=case['source']:
                    raise ValueError('Missing/ambiguous audited draft; do not fabricate model output.')
                source,draft,configuration=captured[0]
                available=service.resources.capabilities()['rules']['available']
                current_arms=arms if available else {key:[] for key in arms}
                findings=annotations(source,draft,configuration,current_arms)
                for key,item in findings.items():
                    outputs[key].append({'id':row['id'],'group':case['group'],'source':source,
                      'proposal':item['replacementText'] if item else source,'displayed':bool(item),
                      'status':'completed' if job['status']=='completed' else 'failed',
                      'serviceStatus':job['status'],'warnings':job['warnings'],'fingerprint':identity,
                      'evidenceKind':'guard-only-recorded-integration','modelTrace':[trace[i] for i in used]})
                audits.append({'id':row['id'],'source':source,'draft':draft,'acceptedWords':configuration['acceptedWords'],
                  'recordedCallsUsed':used,'recordedCallsAvailable':len(trace),'requestPayloadsBound':True})
                if position%100==0:print(json.dumps({'cohort':cohort['name'],'completed':position+1}),flush=True)
            if generate.source_snapshot()!=implementation:raise ValueError('Implementation changed during replay.')
            for key,values in outputs.items():
                path=directory/cohort['name']/('profile-'+key+'.jsonl')
                path.parent.mkdir(parents=True,exist_ok=True)
                path.write_text(''.join(json.dumps(v,ensure_ascii=False)+'\n' for v in values),encoding='utf8')
            write(directory/cohort['name']/'audited-drafts.json',audits)
            cohorts.append({**cohort,'cases':len(native),'corpusSHA256':digest(data),
              'nativeSHA256':digest(native),'nativeManifestSHA256':digest(origin),'archiveSHA256':archive_hash,
              'results':{key:{'path':str(directory/cohort['name']/('profile-'+key+'.jsonl')),'sha256':digest(values)} for key,values in outputs.items()},
              'auditedDraftsSHA256':digest(audits),'modelCallsReplayed':sum(len(a['recordedCallsUsed']) for a in audits)})
        finally:service.shutdown()
    require_unchanged(stamp)
    result={'status':'completed','scope':__doc__,'fingerprint':identity,'implementation':implementation,
      'scriptIdentity':stamp,'profiles':arms,'cohorts':cohorts,'newModelCalls':0,'paidAPICalls':0,
      'limitation':'All natural corpora were exposed in the prior study. This is a paired ablation, not fresh quality validation.'}
    write(target,result);print(json.dumps({'cohorts':len(cohorts),'profiles':len(arms),'newModelCalls':0}))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();capture(args.config,args.output)
