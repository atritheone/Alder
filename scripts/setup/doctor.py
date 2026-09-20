"""Validate repository completeness before provisioning, then inspect the host."""
import ctypes
import ctypes.util
import os
from pathlib import Path
import platform
import re
import shutil
import struct
import subprocess
import sys
from common import SetupError, read_json, check_space
from features import MODEL_TARGETS, feature_plan
from windows_tools import windows_build_tools

TARGETS = ('win32-x64', 'linux-x64', 'darwin-arm64', 'darwin-x64')


def memory_bytes():
    if sys.platform=='win32':
        class Memory(ctypes.Structure):
            _fields_=[('length',ctypes.c_ulong),('load',ctypes.c_ulong)]+[(name,ctypes.c_ulonglong) for name in ('totalPhys','availPhys','totalPage','availPage','totalVirtual','availVirtual','extended')]
        data=Memory();data.length=ctypes.sizeof(data)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(data)):return data.totalPhys
    elif sys.platform=='darwin':
        try:return int(subprocess.check_output(['sysctl','-n','hw.memsize'],text=True))
        except (OSError,ValueError,subprocess.SubprocessError):pass
    elif hasattr(os,'sysconf'):
        return os.sysconf('SC_PAGE_SIZE')*os.sysconf('SC_PHYS_PAGES')
    return None


def native_target():
    arch = {'AMD64':'x64','x86_64':'x64','arm64':'arm64','aarch64':'arm64'}.get(platform.machine())
    target = sys.platform + '-' + str(arch)
    if target not in TARGETS:
        raise SetupError('ALDER_TARGET', f'Unsupported native target: {target}')
    return target


def validate_metadata(source):
    source = Path(source)
    package = read_json(source / 'package.json')
    for name in ('name','version','description','homepage','author','license'):
        if not package.get(name): raise SetupError('ALDER_METADATA', f'Missing package.json {name}; maintainer fix required.')
    if not re.match(r'https://\S+$', package['homepage']): raise SetupError('ALDER_METADATA','Invalid project homepage.')
    if not re.fullmatch(r'\d+\.\d+\.\d+',package['version']):
        raise SetupError('ALDER_METADATA','Alder releases require a major.minor.patch version.')
    lock=read_json(source/'package-lock.json')
    if lock.get('version')!=package['version'] or lock.get('packages',{}).get('',{}).get('version')!=package['version']:
        raise SetupError('ALDER_METADATA','package.json and package-lock.json release versions disagree; obtain a corrected repository.')
    build=package['build']
    for platform_name, label in [('win32','Windows'),('linux','Linux'),('darwin','Mac')]:
        if package.get('alderSetup',{}).get('descriptions',{}).get(platform_name) != 'Alder Organic Language Engine for '+label:
            raise SetupError('ALDER_METADATA','Missing or incorrect platform description: '+platform_name)
    if not isinstance(package['author'],dict) or not package['author'].get('email'):
        raise SetupError('ALDER_METADATA','Missing author email.')
    if not isinstance(package.get('alderSetup',{}).get('dataCompatibility'),int):
        raise SetupError('ALDER_METADATA','Missing user-data compatibility declaration.')
    if not build.get('appId') or not build.get('linux',{}).get('maintainer'):
        raise SetupError('ALDER_METADATA','Missing application ID/Linux maintainer.')
    if build['mac'].get('identity') != '-' or build['mac'].get('notarize') is not False:
        raise SetupError('ALDER_METADATA','Local Mac installation must use ad-hoc signing without notarisation.')
    pairs=[(x['from'],x['to']) for x in build['extraResources']]
    if len(set(pairs)) != len(pairs): raise SetupError('ALDER_METADATA','Duplicated resource configuration.')
    for file in ('build/alder.ico','build/alder.icns','build/icons/16x16.png','build/icons/256x256.png','build/icons/512x512.png','LICENCE.md','chatterbox/LICENSE','scripts/setup/cli.py','setup.sh','setup.ps1','update.sh','update.ps1'):
        if not (source/file).is_file(): raise SetupError('ALDER_METADATA',f'Missing committed asset: {file}')
    with (source/'build/alder.icns').open('rb') as f:
        magic,size=struct.unpack('>4sI',f.read(8))
        if magic != b'icns' or size!=(source/'build/alder.icns').stat().st_size:
            raise SetupError('ALDER_METADATA','Invalid macOS icon.')
    common=read_json(source/'resources/manifests/common.json')
    records=common['artifacts']+common['models']
    proofreading=read_json(source/'resources/manifests/proofreading.json')
    if set(proofreading['pythonBindings']) != set(MODEL_TARGETS):
        raise SetupError('ALDER_METADATA','Proofreading bindings must cover Windows x64, Linux x64 and Apple Silicon; Intel Mac is explicitly rules-only.')
    if 'dist-electron/*.node' not in build.get('asarUnpack',[]):
        raise SetupError('ALDER_METADATA','The Windows native menu module must be unpacked from ASAR.')
    for file in ('scripts/build-windows-menu.mjs','electron/native/windows-menu/menu.cc','electron/native/windows-menu/binding.gyp'):
        if not (source/file).is_file():raise SetupError('ALDER_METADATA','Missing Windows native menu source: '+file)
    gyp=package.get('devDependencies',{}).get('node-gyp')
    if not isinstance(gyp,str) or not re.fullmatch(r'\d+\.\d+\.\d+',gyp) or lock.get('packages',{}).get('node_modules/node-gyp',{}).get('version')!=gyp:
        raise SetupError('ALDER_METADATA','Windows menu builds require a pinned node-gyp matching package-lock.json.')
    records += [proofreading['rules'],proofreading['model'],*proofreading['pythonBindings'].values(),*proofreading['notices']]
    for file in ('python','node','java','calibre','ffmpeg'):
        manifest=read_json(source/f'scripts/{file}-sources.json')
        for value in manifest.values(): records.extend(value if isinstance(value,list) else [value])
    for record in records:
        if not record.get('name') or not record.get('url','').startswith('https://'):
            raise SetupError('ALDER_METADATA','Incomplete artifact record.')
        if not (re.fullmatch('[0-9a-f]{64}',record.get('sha256','')) or re.fullmatch('[0-9a-f]{128}',record.get('sha512',''))):
            raise SetupError('ALDER_METADATA',f'Missing checksum for {record["name"]}.')
    py=read_json(source/'scripts/python-sources.json'); nodes=read_json(source/'scripts/node-sources.json')
    for name in ('build.txt','intel-mac-build.txt'):
        lock=source/'resources/locks'/name
        if not lock.is_file() or any('--hash=sha256:' not in line for line in lock.read_text().splitlines() if line and not line.startswith('#')):
            raise SetupError('ALDER_METADATA','Missing or unhashed build dependency lock: '+name)
    boot={line.split('\t')[0]:line.split('\t')[1:] for line in (source/'resources/manifests/bootstrap.tsv').read_text().splitlines()}
    for target in TARGETS:
        key=target.replace('win32','windows').replace('darwin','macos')
        if boot.get(target) != [py[key]['url'],py[key]['sha256']] or target not in nodes:
            raise SetupError('ALDER_METADATA',f'Bootstrap records disagree for {target}.')
        for group in ('core','speech','qa') + (('proofreading',) if target in proofreading['pythonBindings'] else ()):
            lock=source/f'resources/locks/{group}-{target}.txt'
            if not lock.is_file(): raise SetupError('ALDER_METADATA',f'Missing native lock: {lock.name}')
            lines=[x for x in lock.read_text().splitlines() if x and not x.startswith('#')]
            if not lines or any('--hash=sha256:' not in line for line in lines):
                raise SetupError('ALDER_METADATA',f'Unhashed dependency in {lock.name}')
            if group=='proofreading':
                binding=proofreading['pythonBindings'][target]
                expected=f'llama-cpp-python @ {binding["url"]} --hash=sha256:{binding["sha256"]}'
                if expected not in lines:raise SetupError('ALDER_METADATA','Proofreading lock and native binding disagree for '+target)
    return {'metadata':'passed','version':package['version'],'targets':list(TARGETS),'artifacts':len(records)}


def inspect_host(source, state, install, target, *, allow_experimental=False, need_space=True, need_build=True):
    result=validate_metadata(source)
    if (hasattr(os,'geteuid') and os.geteuid()==0) or (sys.platform=='win32' and ctypes.windll.shell32.IsUserAnAdmin()):
        raise SetupError('ALDER_ROOT','Use a normal desktop account, without sudo/administrator elevation.')
    for directory in (state,install):
        p=Path(directory).resolve(); src=Path(source).resolve()
        if p==Path(p.anchor) or p==Path.home().resolve() or p.is_relative_to(src) or src.is_relative_to(p):
            raise SetupError('ALDER_PATH',f'Choose a dedicated external directory, not a source/home/root ancestor: {p}')
        existing=p
        while not existing.exists():existing=existing.parent
        if not os.access(existing,os.W_OK):raise SetupError('ALDER_PERMISSION',f'Not writable by the desktop user: {existing}')
    if Path(state).resolve().is_relative_to(Path(install).resolve()) or Path(install).resolve().is_relative_to(Path(state).resolve()):
        raise SetupError('ALDER_PATH','Setup state and installation directories must be separate, non-overlapping directories.')
    if target=='darwin-x64' and not allow_experimental:
        raise SetupError('ALDER_EXPERIMENTAL','Intel Mac requires an unverified Torch source build with substantial time/disk costs. Use --allow-experimental to attempt it; full success still requires all checks.')
    warnings=[]
    if sys.platform=='darwin' and int(platform.mac_ver()[0].split('.')[0])<14:
        raise SetupError('ALDER_PREREQUISITE','macOS 14 or newer is required by the pinned native publishing and recognition engines.')
    memory=memory_bytes()
    if memory and memory<8*2**30:raise SetupError('ALDER_MEMORY','At least 8 GiB RAM is required for full local narration setup; 16 GiB is recommended.')
    if memory and memory<16*2**30:warnings.append('Less than 16 GiB RAM: model loading and CPU inference may be slow.')
    if sys.platform=='linux':
        libc,version=platform.libc_ver()
        if libc!='glibc' or tuple(int(x) for x in version.split('.')[:2])<(2,35):
            raise SetupError('ALDER_PREREQUISITE','A glibc 2.35+ Linux desktop is required; Alpine/musl is unsupported.')
        missing=[lib for lib in ('gtk-3','nss3','asound','gbm','Xss','xkbcommon') if not ctypes.util.find_library(lib)]
        if missing:
            raise SetupError('ALDER_PREREQUISITE', 'Missing Linux libraries: '+', '.join(missing)+'. See docs/setup/linux.md for distro-specific packages; do not run setup with sudo.')
        if not (os.environ.get('DISPLAY') or os.environ.get('WAYLAND_DISPLAY')):
            warnings.append('No graphical session; installation verification will remain pending until verify runs from the desktop.')
    build_tools=windows_build_tools() if target=='win32-x64' and need_build else None
    if sys.platform=='darwin' and not shutil.which('xcrun'):
        raise SetupError('ALDER_PREREQUISITE','Install Apple Command Line Tools with xcode-select --install, then retry.')
    if need_space:
        check_space(state,(80 if target=='darwin-x64' else 45)*2**30)
        check_space(install,18*2**30)
    optional_voices = {'provider': 'sapi' if sys.platform == 'win32' else 'macos' if sys.platform == 'darwin' else 'espeak',
                       'required': False, 'verification': 'Native rendering is checked after assembly.'}
    if sys.platform == 'linux':
        optional_voices['libraryFound'] = bool(os.environ.get('ALDER_ESPEAK_LIBRARY') or ctypes.util.find_library('espeak-ng'))
        if not optional_voices['libraryFound']:
            optional_voices['reason'] = 'Optional eSpeak NG library/voice data are absent; Chatterbox is independent.'
    return {**result,'target':target,'stateDirectory':str(state),'installation':str(install), 'systemVoices': optional_voices,
            'features':feature_plan(source,target),'windowsBuildTools':build_tools,
            'memoryGiB':round(memory/2**30,1) if memory else None,
            'speechRuntime':'CPU wheels on Windows/Linux; native Torch on Mac; actual device is verified by inference',
            'warnings':warnings,'estimatedPeakGiB':80 if target=='darwin-x64' else 45,
            'support':'experimental' if target=='darwin-x64' else 'native verification required',
            'sourcePolicy':'read-only; all generated state is external'}
