"""Resume source-bound diagnostic assessment without rerunning valid inference.

This runs existing reference/grammar metrics, not an editorial qualification.
Metric preference counts cannot promote a model or open a sealed test.
"""
import argparse
from collections import Counter
import hashlib
import html
import json
from pathlib import Path
import subprocess
import sys
from common import ROOT,corpus,digest,output_path,read,records,write


def asset_identity(directory):
    directory=Path(directory).resolve();manifest=read(directory/'artifact-manifest.json')
    for name,item in manifest['files'].items():
        path=(directory/name).resolve()
        if not path.is_relative_to(directory):raise ValueError('Metric asset escaped its directory.')
        hasher=hashlib.sha256()
        with path.open('rb') as stream:
            for chunk in iter(lambda:stream.read(4*1024*1024),b''):hasher.update(chunk)
        if hasher.hexdigest()!=item['sha256']:raise ValueError('Metric asset changed.')
    return digest(manifest)


def population(path,data,split):
    path=Path(path).resolve();manifest=read(path.with_suffix('.manifest.json'))
    rows=records(path);expected={case['id']:case for case in data['cases'] if case['split']==split}
    if manifest.get('status')!='completed':raise ValueError('Inference must finish before assessment.')
    if manifest['settings']['corpus']!=digest(data) or manifest['settings']['split']!=split:
        raise ValueError('Inference refers to a different corpus or split.')
    actual={row['id']:row for row in rows}
    if len(actual)!=len(rows) or actual.keys()!=expected.keys():raise ValueError('Incomplete or repeated assessment population.')
    for key,row in actual.items():
        if row['source']!=expected[key]['source'] or row['fingerprint']!=manifest['fingerprint']:
            raise ValueError('Changed source or inference identity.')
    return {'resultsSHA256':digest(rows),'manifestSHA256':digest(manifest)},manifest


def step(ledger,key,command,target):
    """A recorded successful step is reused only while its output stays identical."""
    target=Path(target)
    previous=ledger['steps'].get(key)
    if previous:
        if not target.exists() or previous['command']!=command or previous['outputSHA256']!=digest(read(target)):
            raise ValueError('Recorded assessment output changed; preserve this run and use a new directory.')
        return
    if target.exists():raise ValueError('Unrecorded assessment output exists; refuse to overwrite it.')
    subprocess.run(command,check=True,cwd=ROOT)
    ledger['steps'][key]={'command':command,'outputSHA256':digest(read(target))}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan',required=True);parser.add_argument('--output-directory',required=True)
    args=parser.parse_args();plan=read(args.plan);data=corpus(plan['corpus'])
    split=plan.get('split','development')
    if split not in ('development','validation'):raise ValueError('Diagnostic assessment cannot open sealed tests.')
    candidates=plan['candidates'];baseline=plan['baseline']
    if not isinstance(candidates,dict) or baseline not in candidates:raise ValueError('A named baseline is required.')
    if any(not isinstance(name,str) or not name or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-_' for c in name) for name in candidates):
        raise ValueError('Candidate ids must be safe directory names.')
    root=output_path(Path(args.output_directory)/'assessment.json').parent
    inputs={name:population(path,data,split)[0] for name,path in candidates.items()}
    assets={'impara':asset_identity(plan['imparaModel'])}
    if plan.get('sure'):
        assets.update({name:asset_identity(plan['sure'][name]) for name in ('checkpoint','baseModel')})
        implementation=plan['sure']['implementationRoot']
        if subprocess.check_output(['git','-C',implementation,'status','--porcelain'],text=True).strip():
            raise ValueError('Research scorer checkout has unrecorded changes.')
        assets['sureImplementation']=subprocess.check_output(['git','-C',implementation,'rev-parse','HEAD'],text=True).strip()
    environment=json.loads(subprocess.check_output([plan['metricPython'],'-c',
      'import importlib.metadata as m,json,sys; print(json.dumps({"python":sys.version,"packages":sorted((d.metadata["Name"],d.version) for d in m.distributions())}))'],text=True,encoding='utf-8'))
    directory=Path(__file__).parent
    sources={path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in directory.glob('*.py')}
    fingerprint=digest({'plan':plan,'inputs':inputs,'source':sources,'assets':assets,'environment':environment})
    ledger_path=root/'assessment.json'
    ledger=read(ledger_path) if ledger_path.exists() else {'fingerprint':fingerprint,'steps':{}}
    if ledger['fingerprint']!=fingerprint:raise ValueError('Assessment configuration changed; use a new directory.')
    ledger.update(status='running',scope=__doc__,inputs=inputs,source=sources,assets=assets,environment=environment,promotion='retain incumbent',candidates={})
    write(ledger_path,ledger)
    def execute(key,script,arguments,target,python=sys.executable):
        command=[str(python),'-B',str(directory/script),*map(str,arguments),'--output',str(target)]
        step(ledger,key,command,target);write(ledger_path,ledger)
    for name,path in candidates.items():
        folder=root/name;folder.mkdir(parents=True,exist_ok=True)
        audit=folder/'audit.json';literal=folder/'literal.json'
        execute(name+':audit','audit_inference.py',['--corpus',plan['corpus'],'--results',path],audit)
        execute(name+':literal','compare.py',['--corpus',plan['corpus'],'--results',path,'--split',split],literal)
        result={'audit':read(audit),'literal':read(literal)}
        if plan.get('referenceMetrics') is True:
            reference=folder/'reference.json'
            execute(name+':reference','reference.py',['--corpus',plan['corpus'],'--results',path,'--split',split],reference,plan['metricPython'])
            result['reference']=read(reference)
        if name!=baseline:
            pairs=folder/'pairs.jsonl';pairs_manifest=Path(str(pairs)+'.manifest.json')
            # The pair writer's JSON manifest is the step artifact; include the
            # actual JSONL hash before any metric is allowed to use it.
            command=[sys.executable,'-B',str(directory/'candidate_pairs.py'),'--corpus',plan['corpus'],
                     '--baseline',candidates[baseline],'--candidate',path,'--output',str(pairs)]
            if pairs.exists() and not pairs_manifest.exists():raise ValueError('Unrecorded pair output exists.')
            step(ledger,name+':pairs',command,pairs_manifest)
            if read(pairs_manifest)['pairsSHA256']!=digest(records(pairs)):raise ValueError('Assessment pairs changed.')
            write(ledger_path,ledger)
            ratings=folder/'impara.json'
            execute(name+':impara','score_qe.py',['--model',plan['imparaModel'],'--pairs',pairs],ratings,plan['metricPython'])
            result['imparaPreferences']=dict(Counter(row['winner'] for row in read(ratings)['records']))
            if plan.get('sure'):
                sure=plan['sure'];ratings=folder/'sure.json'
                execute(name+':sure','score_sure.py',['--implementation-root',sure['implementationRoot'],
                  '--checkpoint',sure['checkpoint'],'--base-model',sure['baseModel'],'--pairs',pairs],ratings,plan['metricPython'])
                result['surePreferences']=dict(Counter(row['winner'] for row in read(ratings)['records']))
        ledger['candidates'][name]=result;write(ledger_path,ledger)
    if plan.get('referenceMetrics') is True:
        # Wait for every reference report, regardless of candidate-map order.
        # Reuse the same matched population; never rerun neural inference here.
        for name in candidates:
            if name==baseline:continue
            target=root/name/'reference-comparison.json'
            execute(name+':reference-comparison','reference_comparison.py',
              ['--baseline',root/baseline/'reference.json','--candidate',root/name/'reference.json'],target)
            ledger['candidates'][name]['pairedReferenceComparison']=read(target)
            write(ledger_path,ledger)
    current={path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in directory.glob('*.py')}
    if current!=sources:raise ValueError('Assessment source changed during the run.')
    if any(population(path,data,split)[0]!=inputs[name] for name,path in candidates.items()):raise ValueError('Inference inputs changed during assessment.')
    ledger.update(status='completed',editorialQualification='unverified',corpusSHA256=digest(data),split=split,
      limitations=['Grammar preferences do not establish meaning preservation or valid absolute approvals.',
                   'Service failures and suppressed outputs remain unchanged source in all scores.',
                   'No installation, promotion, publication or sealed-test access.'])
    write(ledger_path,ledger)
    (root/'assessment.html').write_text('<!doctype html><meta charset="utf-8"><title>Grammar diagnostics</title>'
      '<h1>Grammar diagnostics</h1><p>Retain incumbent. Editorial qualification: unverified.</p><pre>'
      +html.escape(json.dumps(ledger,indent=2,ensure_ascii=False))+'</pre>','utf-8')
    print(json.dumps({'status':'completed','promotion':'retain incumbent','candidates':len(candidates)}))


if __name__=='__main__':main()
