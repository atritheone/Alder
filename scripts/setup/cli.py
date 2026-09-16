"""Alder's native, read-only-repository installation entry point."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import time
sys.dont_write_bytecode = True
from common import SetupError, check_space, digest, inventory, operation_lock, installation_lock, read_json, remove_owned, run, verify_inventory, write_json
from doctor import native_target, validate_metadata, inspect_host
from downloads import fetch, extract
from resources import Resources
from install import activate, default_install, integrations, resource_dir, require_closed, rollback, uninstall, prune_versions
from verify import capabilities, desktop

SOURCE = Path(__file__).resolve().parents[2]
SOURCE_DIRS = ('frontend','electron','backend','scripts','build','resources')
ROOT_FILES = ('package.json','package-lock.json','tsconfig.json','vite.config.ts','vitest.config.ts',
              'LICENCE.md','README.md','SETUP.md','AGENTS.md','setup.sh','setup.ps1',
              'requirements.txt','requirements-core.lock.txt','requirements-speech.txt','requirements-qa.txt')


def source_files(source):
    source=Path(source)
    for directory in SOURCE_DIRS + ('chatterbox/src',):
        for p in sorted((source/directory).rglob('*')):
            if any(part in ('node_modules','__pycache__','.git','.pytest_cache','test-results') for part in p.parts):continue
            if p.is_file() and p.suffix not in ('.pyc','.pyo'):
                if not p.resolve().is_relative_to(source.resolve()):raise SetupError('ALDER_SOURCE','Source links outside the repository are not accepted.')
                yield p
    for name in ROOT_FILES+('chatterbox/LICENSE','chatterbox/pyproject.toml'):
        p=source/name
        if p.is_file():yield p


def source_fingerprint(source):
    h=hashlib.sha256()
    for p in source_files(source):
        h.update(p.relative_to(source).as_posix().encode());h.update(digest(p).encode())
    return h.hexdigest()


def state_default():
    if os.environ.get('ALDER_SETUP_HOME'):return Path(os.environ['ALDER_SETUP_HOME'])
    if sys.platform=='win32':return Path(os.environ['LOCALAPPDATA'])/'AlderSetup'
    if sys.platform=='darwin':return Path.home()/'Library/Application Support/AlderSetup'
    return Path(os.environ.get('XDG_STATE_HOME',Path.home()/'.local/state'))/'alder-setup'


def environment(state):
    env=dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','PYTHONUSERBASE','VIRTUAL_ENV','CONDA_PREFIX','ELECTRON_RUN_AS_NODE','ALDER_RESOURCES_DIR','ALDER_DATA_DIR'):
        env.pop(key,None)
    scratch=state/'scratch';scratch.mkdir(parents=True,exist_ok=True)
    env.update(PYTHONNOUSERSITE='1',PYTHONDONTWRITEBYTECODE='1',PYTHONUTF8='1',
               TMPDIR=str(scratch),TMP=str(scratch),TEMP=str(scratch),APP_BUILDER_TMP_DIR=str(scratch),
               ALDER_PACKAGE_TMP_DIR=str(scratch),PIP_CACHE_DIR=str(state/'cache/pip'),
               ELECTRON_CACHE=str(state/'cache/electron'),ELECTRON_BUILDER_CACHE=str(state/'cache/electron-builder'))
    return env


def own_state(state):
    state.mkdir(parents=True,exist_ok=True)
    marker=state/'.alder-owned.json'
    if not marker.exists():
        unexpected=[p for p in state.iterdir() if p.name!='bootstrap']
        if unexpected:raise SetupError('ALDER_PATH','State directory contains unowned files. Choose a dedicated --state-dir.')
        write_json(marker,{'owner':'Alder setup','schemaVersion':1})


def node_runtime(source,state,target,offline):
    item=read_json(source/'scripts/node-sources.json')[target]
    output=state/'toolchains'/('node-'+target+'-'+item['sha256'][:12])
    executable=output/('node.exe' if target.startswith('win32') else 'bin/node')
    marker=output/'.complete'
    valid=False
    if marker.exists():
        try:valid=verify_inventory(output,read_json(marker)['files'])
        except (ValueError,KeyError):pass
    if not valid:
        archive=fetch(item,state/'cache/artifacts',offline)
        if output.exists():remove_owned(output,state)
        extract(archive,output,strip=1)
        write_json(marker,{'sha256':item['sha256'],'files':inventory(output)})
    npm=output/('node_modules/npm/bin/npm-cli.js' if target.startswith('win32') else 'lib/node_modules/npm/bin/npm-cli.js')
    return executable,npm


def workspace_copy(source,state,fingerprint):
    workspace=state/'workspace'/fingerprint
    marker=workspace/'.source-complete'
    if not marker.exists():
        if workspace.exists():remove_owned(workspace,state)
        workspace.mkdir(parents=True)
        for file in source_files(source):
            output=workspace/file.relative_to(source);output.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,output)
        marker.write_text(fingerprint)
    # A generated workspace is allowed; changes to its original source are not.
    if source_fingerprint(workspace)!=fingerprint:
        raise SetupError('ALDER_WORKSPACE','Source files in the generated workspace changed. Run repair; do not patch either checkout or workspace.')
    return workspace


def build(source,state,target,env,node,npm,resources,fingerprint,offline):
    workspace=workspace_copy(source,state,fingerprint)
    marker=state/'stages'/('build-'+target+'-'+fingerprint+'.json')
    if marker.exists():
        record=read_json(marker)
        if verify_inventory(Path(record['directory']),record['files']):return workspace,Path(record['directory'])
    if offline:raise SetupError('ALDER_OFFLINE','No verified assembled application is cached for this revision. Build online once before offline reinstall.')
    marker.unlink(missing_ok=True)
    env={**env,'ALDER_RESOURCES_DIR':str(resources),'PATH':str(node.parent)+os.pathsep+env.get('PATH','')}
    logs=state/'logs';check_space(state,20*2**30)
    run([node,npm,'ci','--cache',state/'cache/npm'],workspace,env,logs,'npm-ci')
    run([node,npm,'test'],workspace,env,logs,'source-tests',timeout=600)
    run([node,npm,'run','build'],workspace,env,logs,'desktop-build',timeout=600)
    run([node,'scripts/prepare-javascript-notices.mjs'],workspace,env,logs,'javascript-notices')
    # Keep installed Linux launcher icons beside resources, independent of source.
    icon_dest=resources/'setup-icons';icon_dest.mkdir(exist_ok=True)
    for icon in (source/'build/icons').glob('*.png'):shutil.copy2(icon,icon_dest/icon.name)
    run([node,'scripts/validate-setup-metadata.mjs'],workspace,env,logs,'builder-metadata')
    run([node,'scripts/package-desktop.mjs','--dir'],workspace,env,logs,'assemble-desktop')
    app=workspace/'release'/('win-unpacked' if target.startswith('win32') else 'linux-unpacked' if target.startswith('linux') else 'mac-arm64' if target=='darwin-arm64' else 'mac')
    if not app.is_dir():raise SetupError('ALDER_ASSEMBLY',f'Expected application directory is missing: {app}')
    write_json(marker,{'directory':str(app),'files':inventory(app)})
    return workspace,app


def execute(args):
    state=args.state_dir.expanduser().resolve();install=args.install_dir.expanduser().resolve();target=native_target()
    if args.command=='validate':return validate_metadata(SOURCE)
    # No writes or downloads are needed for Python-level doctor.
    info=inspect_host(SOURCE,state,install,target,allow_experimental=args.allow_experimental,
                      need_space=args.command=='doctor')
    if args.command=='doctor':return {'status':'ready',**info}
    own_state(state)
    with operation_lock(state), installation_lock(install):
        if args.command=='uninstall':return uninstall(install)
        if args.command=='rollback':return {'status':'rolled-back',**rollback(install)}
        if args.command=='clean-cache':
            cache=state/'cache'
            size=sum(p.stat().st_size for p in cache.rglob('*') if p.is_file()) if cache.exists() else 0
            if args.yes and cache.exists():remove_owned(cache,state)
            return {'status':'cleaned' if args.yes else 'preview','bytes':size,'path':str(cache),'next':'clean-cache --yes removes only downloaded caches; installed apps and user data are preserved.'}
        fingerprint=source_fingerprint(SOURCE);env=environment(state)
        node,npm=node_runtime(SOURCE,state,target,args.offline)
        env['PATH']=str(node.parent)+os.pathsep+env.get('PATH','')
        active=read_json(install/'active.json') if (install/'active.json').exists() else None
        workspace=state/'workspace'/fingerprint
        if args.command=='verify':
            if not active:raise SetupError('ALDER_INSTALL','No installed Alder at this location.')
            if active['fingerprint']!=fingerprint:
                raise SetupError('ALDER_VERIFY','This checkout differs from the installed revision. Use the matching checkout to verify, or install this revision first.')
            if not verify_inventory(install/active['directory'],read_json(install/active['inventory'])):
                raise SetupError('ALDER_HASH','Installed files failed integrity checking. Run repair.')
            if not (workspace/'node_modules').exists():raise SetupError('ALDER_VERIFY','Verification tools are unavailable. Run install to restore the matching verification workspace.')
            result=desktop(workspace,install/active['directory'],target,node,env,state/'logs')
            capabilities(workspace,resource_dir(install/active['directory'],target),target,env,state/'logs/installed')
            active['verification']=result['status'];write_json(install/'active.json',active)
            return {'status':result['status'],'installation':str(install),'launcher':active.get('launcher'),'checks':result}
        if active and active['fingerprint']==fingerprint and args.command!='repair' and verify_inventory(install/active['directory'],read_json(install/active['inventory'])):
            if not (workspace/'node_modules').exists():
                raise SetupError('ALDER_VERIFY','Verification workspace is missing. Run repair to restore it.')
            result=desktop(workspace,install/active['directory'],target,node,env,state/'logs')
            capabilities(workspace,resource_dir(install/active['directory'],target),target,env,state/'logs/installed')
            active['verification']=result['status'];write_json(install/'active.json',active)
            return {'status':result['status'],'reused':True,'launcher':active.get('launcher'),'installation':str(install)}
        require_closed(install)
        check_space(state,(80 if target=='darwin-x64' else 45)*2**30)
        if args.command=='repair':
            marker=state/'stages'/('build-'+target+'-'+fingerprint+'.json');marker.unlink(missing_ok=True)
            if workspace.exists():remove_owned(workspace,state)
        resource_builder=Resources(SOURCE,state,target,env,args.offline)
        resources=resource_builder.prepare()
        workspace,app=build(SOURCE,state,target,env,node,npm,resources,fingerprint,args.offline)
        layout=read_json(SOURCE/'backend/alder/runtime-layout.json')[target.rsplit('-',1)[0]]
        run([resources/layout['python'],'-m','pytest','backend/tests','-q','-p','no:cacheprovider'],workspace,
            {**env,'PYTHONPATH':str(workspace/'backend'),'ALDER_RESOURCES_DIR':str(resources)},state/'logs','backend-tests',timeout=600)
        stage_report=desktop(workspace,app,target,node,env,state/'logs/staged')
        capabilities(workspace,resource_dir(app,target),target,env,state/'logs/staged')
        check_space(install,sum(p.stat().st_size for p in app.rglob('*') if p.is_file())+2*2**30)
        version=read_json(SOURCE/'package.json')['version']
        new=activate(install,app,target,version,fingerprint,SOURCE)
        try:
            result=desktop(workspace,install/new['directory'],target,node,env,state/'logs/installed')
            capabilities(workspace,resource_dir(install/new['directory'],target),target,env,state/'logs/installed')
        except Exception:
            if active:
                integrations(install,active);write_json(install/'active.json',active)
            raise
        new['verification']=result['status'];write_json(install/'active.json',new)
        if result['status']=='passed':prune_versions(install)
        if source_fingerprint(SOURCE)!=fingerprint:raise SetupError('ALDER_SOURCE','Repository changed during setup. Retry against a stable revision.')
        return {'status':result['status'],'version':version,'target':target,'installation':str(install),
                'launcher':new['launcher'],'sourceUnchanged':True,'offlineRuntime':True,
                'speechDevice':'cpu baseline','humanListeningApproval':False,'warnings':info['warnings']}


def report_failure(args, result):
    # Reporting must not hide the original error when a full/read-only disk is
    # itself the reason setup failed. Always emit the current result to stderr.
    try:
        if (args.state_dir/'.alder-owned.json').is_file():
            write_json(args.state_dir/'report.json',result)
    except OSError as error:
        result['reportWarning']=f'Could not save report.json: {error}'
    print(json.dumps(result,indent=2),file=sys.stderr)
    return 1


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['doctor','validate','install','verify','repair','update','rollback','uninstall','clean-cache'],nargs='?',default='doctor')
    parser.add_argument('--state-dir',type=Path,default=state_default())
    parser.add_argument('--install-dir',type=Path,default=default_install())
    parser.add_argument('--offline',action='store_true')
    parser.add_argument('--json',action='store_true')
    parser.add_argument('--noninteractive',action='store_true',help='Setup never prompts for credentials or runs elevated prerequisites.')
    parser.add_argument('--allow-experimental',action='store_true')
    parser.add_argument('--yes',action='store_true',help='Apply the clean-cache preview.')
    args=parser.parse_args(argv)
    try:
        result=execute(args)
        if args.command not in ('doctor','validate'):
            write_json(args.state_dir/'report.json',{'schemaVersion':1,'command':args.command,**result})
        print(json.dumps(result,indent=2))
        return 2 if result.get('status')=='pending' else 0
    except SetupError as error:
        result={'schemaVersion':1,'status':'failed','code':error.code,'message':str(error),'command':args.command}
        return report_failure(args,result)
    except (OSError,ValueError,KeyError,StopIteration) as error:
        return report_failure(args,{'schemaVersion':1,'status':'failed','code':'ALDER_IO','message':str(error),'command':args.command,
                                    'recovery':'Retry setup after resolving the reported path/network issue. Do not edit repository metadata.'})

if __name__=='__main__':sys.exit(main())
