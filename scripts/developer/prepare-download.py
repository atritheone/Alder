"""Produce the minimal, test-free source download consumed by end-user agents."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile

SOURCE=Path(__file__).resolve().parents[2]
TREES=('backend/alder','frontend/src','frontend/public','electron','build','resources','chatterbox/src','scripts/setup','docs/setup')
FILES=('package.json','package-lock.json','tsconfig.json','vite.config.ts','frontend/index.html',
       'README.md','SETUP.md','AGENTS.md','LICENCE.md','THIRD-PARTY-NOTICES.md',
       'setup.ps1','setup.sh','update.ps1','update.sh','requirements.txt',
       'chatterbox/LICENSE','docs/sitka-provenance.md',
       'flash/alder_logo_white_transparent.png','flash/alder_logo_black_transparent.png')
SCRIPTS=('build-electron.mjs','build-windows-menu.mjs','brand-desktop.mjs',
         'desktop-paths.mjs','package-desktop.mjs','platform-builder-config.mjs',
         'prepare-javascript-notices.mjs','validate-setup-metadata.mjs','verify-resources.mjs',
         'prepare-core-resources.py','prepare-proofreading-resources.py','build-intel-mac-torch.py',
         'python-sources.json','node-sources.json','java-sources.json','calibre-sources.json',
         'ffmpeg-sources.json','torch-sources.json')
TEST_DEPS=('vitest','@playwright/test','jsdom','prettier')


def include(relative):
    parts=relative.parts;name=relative.name.lower()
    if name.startswith('.') or name in ('installer.nsi','alder-icon-source.png'):return False
    if any(p in ('tests','test','fixtures','__pycache__','node_modules','.git') for p in parts):return False
    if name.startswith(('test_','test-','conftest.')) or '.test.' in name or '.spec.' in name:return False
    if relative.as_posix().startswith('electron/native/windows-menu/build/'):return False
    return not name.endswith(('.pyc','.pyo','.map'))


def prepare(output,node,npm):
    version=json.loads((SOURCE/'package.json').read_text())['version']
    label=version[:-2] if version.endswith('.0') else version
    output=output.resolve();output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='alder-download-') as temp:
        root=Path(temp)/('Alder-'+label)
        candidates=[p for tree in TREES for p in (SOURCE/tree).rglob('*') if p.is_file()]
        candidates += [SOURCE/name for name in FILES]+[SOURCE/'scripts'/name for name in SCRIPTS]
        for file in candidates:
            relative=file.relative_to(SOURCE)
            if not include(relative):continue
            dest=root/relative;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,dest)
        package=json.loads((root/'package.json').read_text())
        for name in TEST_DEPS:package['devDependencies'].pop(name,None)
        package['scripts']={key:value for key,value in package['scripts'].items() if key in ('build','typecheck')}
        (root/'package.json').write_text(json.dumps(package,indent=2)+'\n',encoding='utf-8')
        # Recompute reachability from the existing pinned lock, without resolving new versions.
        subprocess.run([str(node),str(npm),'prune','--package-lock-only','--offline','--ignore-scripts','--no-audit','--no-fund'],cwd=root,check=True)
        original=json.loads((SOURCE/'package-lock.json').read_text())['packages']
        lock=json.loads((root/'package-lock.json').read_text())
        for name,item in lock['packages'].items():
            if name:
                assert name in original and item.get('version')==original[name].get('version') and item.get('integrity')==original[name].get('integrity'),name
        for name in TEST_DEPS:assert 'node_modules/'+name not in lock['packages'],name
        for file in [root/'requirements.txt',*(root/'resources/locks').glob('core-*.txt')]:
            lines=[line for line in file.read_text().splitlines() if not re.match(r'(?i)^(pytest|iniconfig|pluggy)(?:==|[<>=])',line)]
            file.write_text('\n'.join(lines)+'\n',encoding='utf-8')
        agents=root/'AGENTS.md'
        instructions=agents.read_text(encoding='utf-8')
        instructions=re.sub(r'## Git workflow\n.*?(?=## )','',instructions,flags=re.S)
        instructions=instructions.replace('using scripts/developer/validate-release.py in the development checkout.',
                                          'in the separate development checkout; no test tools are supplied here.')
        agents.write_text(instructions,encoding='utf-8')
        # Keep explanatory links useful without shipping the developer document collection.
        for document in root.rglob('*.md'):
            def link(match):
                target=match[2]
                if ':' in target or target.startswith('#'):return match[0]
                local=(document.parent/target.split('#')[0]).resolve()
                if local.exists() or not local.is_relative_to(root):return match[0]
                return '['+match[1]+'](https://github.com/atritheone/Alder/blob/main/'+local.relative_to(root).as_posix()+')'
            document.write_text(re.sub(r'\[([^\]]+)\]\(([^)]+)\)',link,document.read_text(encoding='utf-8')),encoding='utf-8')
        # State exactly what was supplied; no Git history, developer reports or test tooling.
        records={p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob('*')) if p.is_file()}
        (root/'download-manifest.json').write_text(json.dumps({'release':label,'version':version,'purpose':'end-user installation and update source','files':records},indent=2)+'\n',encoding='utf-8')
        archive=output/f'Alder-{label}-source.zip'
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as zipped:
            for p in sorted(root.rglob('*')):
                if p.is_file():zipped.write(p,p.relative_to(root.parent).as_posix())
        checksum=hashlib.sha256(archive.read_bytes()).hexdigest()
        (output/(archive.name+'.sha256')).write_text(checksum+'  '+archive.name+'\n',encoding='utf-8')
        print(json.dumps({'archive':str(archive),'sha256':checksum,'files':len(records),'bytes':archive.stat().st_size}))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--node',type=Path,required=True)
    parser.add_argument('--npm-cli',type=Path,required=True)
    args=parser.parse_args();prepare(args.output,args.node,args.npm_cli)
