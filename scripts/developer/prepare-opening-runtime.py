"""Provision only pinned core Python and fonts for native startup/opening CI.

This is a developer fixture, not an end-user installation or feature acceptance.
It deliberately does not download narration/grammar models or alter host Python.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import sys

SOURCE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SOURCE / 'scripts/setup'))
from cli import environment, own_state
from doctor import native_target
from downloads import extract, gunzip
from resources import Resources

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--state', type=Path, required=True)
parser.add_argument('--native-audio', action='store_true', help='Include only pinned audio converters for optional native-voice probes.')
args = parser.parse_args()
state = args.state.resolve()
own_state(state)
target = native_target()
resources = Resources(SOURCE, state, target, environment(state))
python = resources.runtime('core', 'python')
font = resources.artifacts['liberation-fonts']
scratch = state / 'scratch/opening-fonts'
scratch.mkdir(parents=True, exist_ok=True)
extract(resources.fetch(font), scratch)
fonts = resources.output / 'fonts'
fonts.mkdir(parents=True, exist_ok=True)
for file in scratch.rglob('*'):
    if file.is_file() and (file.name.startswith('LiberationSerif-') or file.name in ('LICENSE', 'AUTHORS')):
        shutil.copyfile(file, fonts / file.name)
record = {'scope': 'developer core startup/opening fixture; optional models absent', 'target': target,
          'python': str(python), 'resources': str(resources.output)}
if args.native_audio:
    audio=resources.output/'speech/ffmpeg';audio.mkdir(parents=True,exist_ok=True)
    for item in json.loads((SOURCE/'scripts/ffmpeg-sources.json').read_text())[target]:
        file=resources.fetch(item)
        if item['name'].endswith('.gz'):
            name=item['name'].split('-')[0]+('.exe' if target.startswith('win32') else '')
            gunzip(file,audio/name)
        else:shutil.copy2(file,audio/item['name'].split('.')[-1])
    record['ffmpeg']=str(audio/('ffmpeg.exe' if target.startswith('win32') else 'ffmpeg'))
(state / 'opening-runtime.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
if os.environ.get('GITHUB_ENV'):
    with open(os.environ['GITHUB_ENV'], 'a', encoding='utf-8') as stream:
        stream.write(f'ALDER_RESOURCES_DIR={resources.output}\nPYTHON={python}\nALDER_DATA_DIR={state / "test-data"}\nPYTHONPATH={SOURCE / "backend"}\n')
        if args.native_audio:stream.write(f'FFMPEG={record["ffmpeg"]}\n')
print(json.dumps(record))
