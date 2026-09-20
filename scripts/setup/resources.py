"""Provision every resource from committed records, never an author's environment."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import re
import sys
from common import SetupError, digest, inventory, read_json, write_json, run, verify_inventory, remove_owned
from downloads import fetch, extract, gunzip
from features import feature_plan


class Resources:
    def __init__(self, source, state, target, env, offline=False):
        self.source=Path(source); self.state=Path(state); self.target=target
        self.env=env; self.offline=offline; self.cache=self.state/'cache/artifacts'
        self.output=self.state/'resources'/target
        self.logs=self.state/'logs'
        self.python_key=target.replace('win32','windows').replace('darwin','macos')
        self.py_record=read_json(self.source/'scripts/python-sources.json')[self.python_key]
        self.common=read_json(self.source/'resources/manifests/common.json')
        self.artifacts={x['id']:x for x in self.common['artifacts']}

    def fetch(self,item): return fetch(item,self.cache,self.offline)

    def execute(self,args,label,**kwargs):
        return run(args,self.source,kwargs.pop('env',self.env),self.logs,label,**kwargs)

    def component(self,name,records,make):
        """Failed components are rebuilt fresh; successful ones are content verified."""
        marker=self.state/'components'/(self.target+'-'+name+'.json')
        identity=json.dumps(records,sort_keys=True)
        print('[verify component] '+name,file=sys.stderr,flush=True)
        if marker.exists():
            previous=read_json(marker)
            if previous['inputs']==identity and verify_inventory(self.output,previous['files']):
                return
        self.output.mkdir(parents=True,exist_ok=True)
        marker.unlink(missing_ok=True)
        produced=make()
        print('[record component] '+name,file=sys.stderr,flush=True)
        all_files={}
        for directory in produced:
            directory=Path(directory)
            if directory.is_file():
                all_files[directory.relative_to(self.output).as_posix()]={'sha256':digest(directory),'bytes':directory.stat().st_size}
            else:
                prefix=directory.relative_to(self.output).as_posix()
                all_files.update({prefix+'/'+k:v for k,v in inventory(directory).items()})
        write_json(marker,{'inputs':identity,'files':all_files})

    def fresh(self,path):
        if path.exists():remove_owned(path,self.state)
        path.mkdir(parents=True)

    def runtime(self,group,relative):
        destination=self.output/relative
        lock=self.source/f'resources/locks/{group}-{self.target}.txt'
        build_lock=self.source/'resources/locks/build.txt'
        def make():
            self.fresh(destination)
            extract(self.fetch(self.py_record),destination,strip=1)
            executable=destination/('python.exe' if self.target.startswith('win32') else 'bin/python3')
            runtime_env={**self.env,'PATH':str(destination/('Scripts' if self.target.startswith('win32') else 'bin'))+os.pathsep+str(executable.parent)+os.pathsep+self.env.get('PATH','')}
            wheels=self.state/'cache'/('python-'+self.target+'-'+group)
            wheels.mkdir(parents=True,exist_ok=True)
            for requirement,label in [(build_lock,'build-tools'),(lock,group)]:
                args=[executable,'-I','-m','pip','install','--disable-pip-version-check','--require-hashes',
                      '--no-deps','--no-build-isolation','--report',self.logs/f'{group}-{label}-pip.json']
                # pip caches downloaded wheels; --offline additionally prohibits index access.
                if self.offline:args += ['--no-index','--find-links',wheels]
                else:
                    self.execute([executable,'-I','-m','pip','download','--require-hashes','--no-deps',
                                  '--no-build-isolation','--dest',wheels,'-r',requirement],f'{group}-{label}-download',env=runtime_env)
                    args += ['--no-index','--find-links',wheels]
                # Direct URLs bypass --no-index. Resolve them to verified local files
                # before installation so --offline never contacts their host.
                lines=[]
                for line in requirement.read_text().splitlines():
                    if ' @ https://' in line:
                        hashes=re.findall(r'--hash=sha256:([0-9a-f]+)',line)
                        match=next((p for p in wheels.iterdir() if p.is_file() and digest(p) in hashes),None)
                        if match is None:raise SetupError('ALDER_OFFLINE','Required direct dependency is not cached: '+line.split(' @ ')[0])
                        line=re.sub(r'(?<= @ )https://\S+',match.resolve().as_uri(),line)
                    lines.append(line)
                local_lock=self.state/'scratch'/f'{group}-{label}-local.txt'
                local_lock.write_text('\n'.join(lines)+'\n')
                args += ['-r',local_lock]
                self.execute(args,f'{group}-{label}-install',env=runtime_env)
            if self.target=='darwin-x64' and group=='speech':
                if self.offline: raise SetupError('ALDER_OFFLINE','Experimental Intel Torch compilation requires network access.')
                self.execute([executable,self.source/'scripts/build-intel-mac-torch.py','--python',executable,
                              '--work',self.state/'intel-mac-torch'],'intel-mac-torch')
            self.execute([executable,'-I','-m','pip','check'],group+'-pip-check')
            return [destination]
        records={'python':self.py_record,'lock':digest(lock),'buildLock':digest(build_lock)}
        if self.target=='darwin-x64' and group=='speech':
            records['nativeBuildLock']=digest(self.source/'resources/locks/intel-mac-build.txt')
            records['torchRevisions']=read_json(self.source/'scripts/torch-sources.json')
        self.component(group+'-python',records,make)
        return destination/('python.exe' if self.target.startswith('win32') else 'bin/python3')

    def common_data(self):
        relevant=[x for x in self.common['artifacts'] if x['id'] not in ('temurin-jre','calibre-portable')]
        def make():
            stage=self.state/'scratch/common';self.fresh(stage)
            directories=[]
            for item in relevant:
                archive=self.fetch(item); key=item['id']
                if key.startswith('omw') or key=='wordnet':
                    dest=self.output/'nltk_data/corpora'/item['name'];dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(archive,dest);directories.append(dest)
                elif key=='tika':
                    dest=self.output/'tools/tika'/item['name'];dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(archive,dest);directories.append(dest)
                elif key=='epubcheck':
                    dest=self.output/'tools/epubcheck';self.fresh(dest);extract(archive,dest);directories.append(dest)
                elif key=='liberation-fonts':
                    fonts=stage/'fonts';extract(archive,fonts)
                    dest=self.output/'fonts';self.fresh(dest)
                    for file in fonts.rglob('*'):
                        if file.is_file() and (file.name.startswith('LiberationSerif-') or file.name in ('LICENSE','AUTHORS')):shutil.copy2(file,dest/file.name)
                    directories.append(dest)
                elif key.endswith('-source'):
                    dest=self.output/'sources'/item['name'];dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(archive,dest);directories.append(dest)
            for item in self.common['models']:
                dest=self.output/item['destination'];dest.parent.mkdir(parents=True,exist_ok=True)
                shutil.copy2(self.fetch(item),dest);directories.append(dest)
                (dest.parent/'revision.txt').write_text(item['revision']+'\n')
            for directory in ('speech/models/turbo','speech/qa/models/base.en'):
                directories.append(self.output/directory/'revision.txt')
            return directories
        self.component('common',{'artifacts':relevant,'models':self.common['models']},make)

    def native_tools(self):
        java=self.artifacts['temurin-jre'] if self.target.startswith('win32') else read_json(self.source/'scripts/java-sources.json')[self.python_key]
        calibre=self.artifacts['calibre-portable'] if self.target.startswith('win32') else read_json(self.source/'scripts/calibre-sources.json')['darwin' if self.target.startswith('darwin') else self.target]
        ffmpeg=read_json(self.source/'scripts/ffmpeg-sources.json')[self.target]
        def make():
            java_dest=self.output/'tools/java';self.fresh(java_dest);extract(self.fetch(java),java_dest,strip=1)
            cal_dest=self.output/'tools/calibre';self.fresh(cal_dest)
            archive=self.fetch(calibre)
            if self.target.startswith('win32'):
                stage=self.state/'scratch/calibre';self.fresh(stage)
                drive=next((x+':' for x in 'ZYXWVUTSR' if not Path(x+':/').exists()),None)
                if drive is None:raise SetupError('ALDER_PREREQUISITE','No drive letter available for the portable Calibre extractor.')
                self.execute(['subst',drive,stage],'calibre-map')
                try:self.execute([archive,drive+'\\payload'],'calibre-extract')
                finally:self.execute(['subst',drive,'/D'],'calibre-unmap')
                binary=next(stage.rglob('ebook-convert.exe'))
                shutil.copytree(binary.parent,cal_dest,dirs_exist_ok=True)
            elif self.target.startswith('darwin'):
                mount=self.state/'scratch/calibre-mount';self.fresh(mount)
                self.execute(['hdiutil','attach','-nobrowse','-readonly','-mountpoint',mount,archive],'calibre-mount')
                try:self.execute(['ditto',next(mount.glob('*.app')),cal_dest/'calibre.app'],'calibre-extract')
                finally:self.execute(['hdiutil','detach',mount],'calibre-unmount')
            else:extract(archive,cal_dest)
            audio=self.output/'speech/ffmpeg';self.fresh(audio)
            for item in ffmpeg:
                file=self.fetch(item)
                if item['name'].endswith('.gz'):
                    name=item['name'].split('-')[0]+('.exe' if self.target.startswith('win32') else '')
                    gunzip(file,audio/name)
                else:shutil.copy2(file,audio/item['name'].split('.')[-1])
            write_json(self.output/'publishing-resource-manifest.json',{'schemaVersion':2,'platform':self.target,'java':java,'calibre':calibre,'ffmpeg':ffmpeg,'common':self.common['artifacts']})
            return [java_dest,cal_dest,audio,self.output/'publishing-resource-manifest.json']
        self.component('native-tools',{'java':java,'calibre':calibre,'ffmpeg':ffmpeg},make)

    def proofreading(self):
        manifest=read_json(self.source/'resources/manifests/proofreading.json')
        advanced=feature_plan(self.source,self.target)['proofreading']['advanced']!='unavailable'
        if advanced:
            self.runtime('proofreading','proofreading/python')
        def make():
            spec=importlib.util.spec_from_file_location('proofreading_resources',self.source/'scripts/prepare-proofreading-resources.py')
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            module.prepare(self.output/'proofreading',self.state/'cache/proofreading',self.offline,not advanced)
            produced=[self.output/'proofreading/languagetool',self.output/'proofreading/rules-inventory.json',
                      self.output/'proofreading/proofreading-owner.json',
                      self.output/'proofreading/manifest.json',self.output/'proofreading/notices']
            if advanced:produced.append(self.output/'proofreading/models')
            return produced
        self.component('proofreading-data',{'manifest':manifest,'advanced':advanced,
                       'preparer':digest(self.source/'scripts/prepare-proofreading-resources.py')},make)

    def prepare(self):
        core=self.runtime('core','python')
        self.common_data()
        speech=self.runtime('speech','speech/python')
        qa=self.runtime('qa','speech/qa/python')
        self.native_tools()
        self.proofreading()
        dest=self.output/'speech/chatterbox'
        self.fresh(dest)
        shutil.copytree(self.source/'chatterbox/src',dest/'src',ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
        shutil.copy2(self.source/'chatterbox/LICENSE',dest/'LICENSE')
        spec=importlib.util.spec_from_file_location('core_audit',self.source/'scripts/prepare-core-resources.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        audit=module.verify_runtime(self.output)
        write_json(self.output/'core-runtime-audit.json',audit)
        write_json(self.output/'core-resource-manifest.json',{'schemaVersion':2,'platform':self.target,'verification':audit,'python':self.py_record})
        write_json(self.output/'platform-manifest.json',{'schemaVersion':1,'platform':self.target.rsplit('-',1)[0],'architecture':self.target.rsplit('-',1)[1],'complete':True})
        write_json(self.output/'setup-provenance.json',{'common':self.common,'target':self.target,'sourcePolicy':'Pinned public artifacts; no author environment copied.'})
        return self.output
