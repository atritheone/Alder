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
from downloads import extract
from resources import Resources

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--state', type=Path, required=True)
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
(state / 'opening-runtime.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
if os.environ.get('GITHUB_ENV'):
    with open(os.environ['GITHUB_ENV'], 'a', encoding='utf-8') as stream:
        stream.write(f'ALDER_RESOURCES_DIR={resources.output}\nPYTHON={python}\nALDER_DATA_DIR={state / "test-data"}\nPYTHONPATH={SOURCE / "backend"}\n')
print(json.dumps(record))
