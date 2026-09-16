"""Provision native Unix runtimes. Run on the target architecture, never Windows.

The source bundle supplies already-pinned dictionaries, fonts, models and JARs.
Native Python archives are checksum pinned; pip reports record resolved wheels.
--core-only supports source/desktop testing, and cannot pass release verification.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def download(item, cache):
    target = cache / item['name']
    if len(item.get('sha256', '')) != 64:
        raise ValueError('A pinned SHA256 is required for ' + item['name'])
    if not target.is_file():
        cache.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(target.suffix + '.partial')
        urllib.request.urlretrieve(item['url'], partial)
        if digest(partial) != item['sha256']:
            raise ValueError('Download checksum mismatch: ' + item['name'])
        partial.replace(target)
    if digest(target) != item['sha256']:
        raise ValueError('Cached checksum mismatch: ' + item['name'])
    return target


def extract(archive, destination, strip=0):
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as package:
        members = []
        for member in package.getmembers():
            parts = Path(member.name).parts
            if len(parts) <= strip:
                continue
            member.name = str(Path(*parts[strip:]))
            members.append(member)
        package.extractall(destination, members=members, filter='data')


def python_runtime(item, destination, cache):
    marker = destination / '.alder-python-source.json'
    if marker.is_file() and json.loads(marker.read_text()) != item:
        raise ValueError('The existing runtime uses a different Python source; choose a fresh output directory.')
    if not marker.is_file():
        extract(download(item, cache), destination, strip=1)
        marker.write_text(json.dumps(item, sort_keys=True))
    return destination / 'bin/python3'


def run(args, **kwargs):
    subprocess.run([str(a) for a in args], check=True, **kwargs)


def pip_install(python, requirements, report, extra=()):
    run([python, '-I', '-m', 'pip', 'install', '--disable-pip-version-check',
         '--report', report, *extra, '-r', requirements])
    run([python, '-I', '-m', 'pip', 'check'])


def copy_tree(source, target):
    if not source.is_dir():
        raise ValueError('Required source resources missing: ' + str(source))
    shutil.copytree(source, target, dirs_exist_ok=True, symlinks=False,
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-resources', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'work/bundle-resources')
    parser.add_argument('--cache', type=Path, default=ROOT / 'work/unix-downloads')
    parser.add_argument('--core-only', action='store_true')
    parser.add_argument('--speech-requirements', type=Path, default=ROOT / 'requirements-speech.txt')
    parser.add_argument('--qa-requirements', type=Path, default=ROOT / 'requirements-qa.txt')
    parser.add_argument('--native-tools', type=Path, help='Prepared target-native tools tree, including Calibre and FFmpeg; see docs/cross-platform.md')
    args = parser.parse_args()
    if sys.platform not in ('linux', 'darwin'):
        parser.error('Run this builder inside Linux or macOS.')
    arch = {'x86_64': 'x64', 'AMD64': 'x64', 'arm64': 'arm64', 'aarch64': 'arm64'}.get(platform.machine())
    target = ('macos' if sys.platform == 'darwin' else 'linux') + '-' + str(arch)
    sources = json.loads((ROOT / 'scripts/python-sources.json').read_text())
    if target not in sources:
        parser.error('No pinned interpreter for ' + target)
    source, output, cache = args.source_resources.resolve(), args.output.resolve(), args.cache.resolve()
    if source == output or source.is_relative_to(output) or output.is_relative_to(source) or output == ROOT:
        parser.error('Choose separate source and generated output directories.')
    output.mkdir(parents=True, exist_ok=True)
    native_marker = output / 'native-target.json'
    expected_target = {'platform': sys.platform, 'architecture': arch}
    if native_marker.is_file() and json.loads(native_marker.read_text()) != expected_target:
        raise ValueError('This output contains resources for another OS/architecture. Choose a fresh directory.')
    native_marker.write_text(json.dumps(expected_target))
    manifest_path = output / 'platform-manifest.json'
    manifest_path.unlink(missing_ok=True)  # An interrupted preparation must not look release-ready.
    python = python_runtime(sources[target], output / 'python', cache)
    pip_install(python, ROOT / 'requirements-core.lock.txt', output / 'core-pip-report.json')
    for relative in ('nltk_data', 'fonts', 'tools/tika', 'tools/epubcheck', 'notices', 'sources'):
        copy_tree(source / relative, output / relative)
    java = json.loads((ROOT / 'scripts/java-sources.json').read_text())[target]
    if not (output / 'tools/java').exists():
        extract(download(java, cache), output / 'tools/java', strip=1)
    spec = importlib.util.spec_from_file_location('core_builder', ROOT / 'scripts/prepare-core-resources.py')
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    audit = builder.verify_runtime(output)
    (output / 'core-runtime-audit.json').write_text(json.dumps(audit, indent=2))
    (output / 'core-resource-manifest.json').write_text(json.dumps({'schemaVersion': 2, 'platform': target, 'python': sources[target], 'verification': audit}, indent=2))
    if not args.core_only:
        speech = python_runtime(sources[target], output / 'speech/python', cache)
        qa = python_runtime(sources[target], output / 'speech/qa/python', cache)
        if target == 'macos-x64':
            probe = subprocess.run([str(speech), '-c', 'import torch,torchaudio; assert torch.__version__.split("+")[0] == "2.6.0"'], capture_output=True)
            if probe.returncode:
                run([sys.executable, ROOT / 'scripts/build-intel-mac-torch.py', '--python', speech, '--work', ROOT / 'work/intel-mac-torch'])
        pip_install(speech, args.speech_requirements, output / 'speech-pip-report.json')
        pip_install(qa, args.qa_requirements, output / 'qa-pip-report.json')
        copy_tree(ROOT / 'chatterbox/src', output / 'speech/chatterbox/src')
        shutil.copy2(ROOT / 'chatterbox/LICENSE', output / 'speech/chatterbox/LICENSE')
        for relative in ('speech/models', 'speech/qa/models'):
            copy_tree(source / relative, output / relative)
        # A complete marker requires both real models to load in their native
        # isolated workers. Imports alone can miss unsupported backend operators.
        environment = {**os.environ, 'PYTHONPATH': str(output / 'speech/chatterbox/src'),
                       'PYTHONNOUSERSITE': '1', 'PYTHONDONTWRITEBYTECODE': '1',
                       'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1'}
        environment.pop('PYTHONHOME', None)
        for name, interpreter, worker, model in [
            ('speech', speech, 'speech_worker.py', output / 'speech/models/turbo'),
            ('qa', qa, 'speech_qa_worker.py', output / 'speech/qa/models/base.en')]:
            result = subprocess.run([str(interpreter), '-s', str(ROOT / 'backend/alder' / worker), '--model', str(model)],
                input='{"id":"build-audit","operation":"prepare"}\n', text=True, capture_output=True,
                env=environment, timeout=600)
            replies = []
            for line in result.stdout.splitlines():
                try: replies.append(json.loads(line))
                except ValueError: pass
            reply = next((item for item in replies if item.get('id') == 'build-audit'), {})
            if result.returncode or not reply.get('ok'):
                raise RuntimeError(name + ' model-load audit failed: ' + str(reply.get('error', '')) + '\n' + result.stderr[-8000:])
            (output / (name + '-runtime-audit.json')).write_text(json.dumps(reply, indent=2))
        if not args.native_tools:
            parser.error('--native-tools is required for a complete release (Calibre and FFmpeg).')
        copy_tree(args.native_tools / 'calibre', output / 'tools/calibre')
        copy_tree(args.native_tools / 'ffmpeg', output / 'speech/ffmpeg')
        for name, interpreter in [('speech', speech), ('qa', qa)]:
            freeze = subprocess.check_output([str(interpreter), '-m', 'pip', 'freeze'], text=True)
            (output / (name + '-resolved.lock.txt')).write_text(freeze)
        (output / 'publishing-resource-manifest.json').write_text(json.dumps({'schemaVersion': 2, 'platform': target, 'java': java}, indent=2))
    records = {p.relative_to(output).as_posix(): digest(p) for p in output.rglob('*') if p.is_file() and '__pycache__' not in p.parts}
    manifest_path.write_text(json.dumps({'schemaVersion': 1, 'platform': sys.platform, 'architecture': arch,
        'target': target, 'complete': not args.core_only, 'files': records}, indent=2))
    print(json.dumps({'status': 'passed', 'target': target, 'complete': not args.core_only, 'resources': str(output)}))


if __name__ == '__main__':
    main()
