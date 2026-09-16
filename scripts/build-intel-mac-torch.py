"""Build the pinned CPU Torch wheels where upstream supplies no Intel Mac wheel.

Requires Apple's command-line compiler tools, Git, Internet and substantial disk/RAM.
This path is experimental until a complete real-engine run passes on the VM.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


def run(args, **kwargs):
    subprocess.run([str(a) for a in args], check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--python', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    args = parser.parse_args()
    revisions = json.loads(Path(__file__).with_name('torch-sources.json').read_text())
    run(['xcrun', '--find', 'clang'])
    python = args.python.resolve()
    args.work.mkdir(parents=True, exist_ok=True)
    lock = Path(__file__).resolve().parents[1] / 'resources/locks/intel-mac-build.txt'
    run([python, '-m', 'pip', 'install', '--require-hashes', '--no-deps', '-r', lock])
    env = {**os.environ, 'PATH': str(python.parent) + os.pathsep + os.environ.get('PATH', ''),
           'USE_CUDA': '0', 'USE_MPS': '0', 'BUILD_TEST': '0', 'USE_DISTRIBUTED': '0',
           'USE_FBGEMM': '0', 'MAX_JOBS': os.environ.get('ALDER_BUILD_JOBS', '4'), 'MACOSX_DEPLOYMENT_TARGET': '13.0'}
    for repo, directory, version in [('pytorch/pytorch', 'torch', '2.6.0'), ('pytorch/audio', 'torchaudio', '2.6.0')]:
        source = args.work / directory
        if not source.exists():
            run(['git', 'clone', '--recursive', '--depth', '1', '--shallow-submodules', '--branch', 'v' + version, 'https://github.com/' + repo + '.git', source])
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
        if revision != revisions[repo]:
            raise ValueError('The Torch source checkout does not match its pinned release commit: ' + repo)
        (args.work / (directory + '-source-revision.txt')).write_text(revision + '\n')
        build_env = {**env, 'PYTORCH_BUILD_VERSION': version, 'PYTORCH_BUILD_NUMBER': '1', 'BUILD_VERSION': version,
                     'BUILD_SOX': '0', 'USE_FFMPEG': '0', 'USE_KALDI': '0'}
        run([python, '-m', 'pip', 'wheel', '--no-build-isolation', '--no-deps', '--wheel-dir', args.work / 'wheels', '.'], cwd=source, env=build_env)
        wheel = next((args.work / 'wheels').glob(directory + '-' + version + '-*.whl'))
        run([python, '-m', 'pip', 'install', '--no-deps', wheel], env=env)
    run([python, '-c', 'import torch,torchaudio; print(torch.__version__,torchaudio.__version__)'])


if __name__ == '__main__': main()
