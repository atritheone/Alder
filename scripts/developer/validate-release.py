"""Developer-only release qualification. Never installs or activates an application."""
import argparse
import json
from pathlib import Path
import sys
import subprocess
import time

SOURCE=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(SOURCE/'scripts/setup'))
from cli import own_state, environment, node_runtime, source_fingerprint, build, state_default
from common import SetupError, operation_lock, run, read_json, write_json
from doctor import native_target, inspect_host
from resources import Resources
from install import resource_dir
from release_checks import desktop, capabilities


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir',type=Path,default=state_default())
    parser.add_argument('--offline',action='store_true')
    parser.add_argument('--allow-experimental',action='store_true')
    parser.add_argument('--grammar-evidence',type=Path,help='Optional external grammar qualification evidence manifest')
    args=parser.parse_args()
    state=args.state_dir.resolve();target=native_target()
    inspect_host(SOURCE,state,state.parent/(state.name+'-qualification-placeholder'),target,
                 allow_experimental=args.allow_experimental)
    own_state(state)
    with operation_lock(state):
        (state/'release-validation.json').unlink(missing_ok=True)
        fingerprint=source_fingerprint(SOURCE);env=environment(state)
        env['ALDER_DATA_DIR']=str(state/'scratch'/f'release-data-{time.time_ns()}')
        node,npm=node_runtime(SOURCE,state,target,args.offline)
        import os
        env['PATH']=str(node.parent)+os.pathsep+env.get('PATH','')
        resources=Resources(SOURCE,state,target,env,args.offline).prepare()
        workspace,app=build(SOURCE,state,target,env,node,npm,resources,fingerprint,args.offline)
        logs=state/'logs/release-validation'
        layout=read_json(SOURCE/'backend/alder/runtime-layout.json')[target.rsplit('-',1)[0]]
        run([node,npm,'test'],workspace,env,logs,'frontend-tests',timeout=600)
        run([resources/layout['python'],'-m','pytest','backend/tests','-q','-p','no:cacheprovider'],workspace,
            {**env,'PYTHONPATH':str(workspace/'backend'),'ALDER_RESOURCES_DIR':str(resources)},logs,'backend-tests',timeout=3600)
        checks=desktop(workspace,app,target,node,env,logs)
        features=capabilities(workspace,resource_dir(app,target),target,env,logs)
        grammar=None
        if args.grammar_evidence:
            grammar_path=logs/'grammar-qualification.json'
            grammar_process=subprocess.run([str(resources/layout['python']),'-B',str(workspace/'scripts/developer/grammar/qualify.py'),
                '--evidence',str(args.grammar_evidence.resolve()),'--output',str(grammar_path)],cwd=workspace,env=env,
                capture_output=True,text=True,encoding='utf-8',timeout=120)
            (logs/'grammar-qualification.log').write_text(grammar_process.stdout+grammar_process.stderr,'utf-8')
            if grammar_process.returncode not in (0,2):raise SetupError('ALDER_GRAMMAR','Grammar qualification failed to run. See the developer validation log.')
            grammar=read_json(grammar_path)
        if source_fingerprint(SOURCE)!=fingerprint:raise SetupError('ALDER_SOURCE','Source changed during release qualification.')
        report={'status':checks['status'],'scope':'developer release validation; no installation',
                'version':read_json(SOURCE/'package.json')['version'],'target':target,
                'sourceFingerprint':fingerprint,'application':str(app),'checks':checks,'features':features}
        if grammar is not None:
            report['grammar']=grammar
            if grammar['status']=='failed' or report['status']=='passed':
                report['status']=grammar['status']
        write_json(state/'release-validation.json',report)
        print(json.dumps(report,indent=2))
        return 0 if report['status']=='passed' else 2


if __name__=='__main__':sys.exit(main())
