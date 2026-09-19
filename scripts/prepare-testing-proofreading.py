"""Provision the source launcher's local proofreading pack using setup's pins."""
import argparse
import json
import os
from pathlib import Path
import sys

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE / 'scripts/setup'))
from resources import Resources


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--offline', action='store_true')
    options = parser.parse_args()
    state = options.state.resolve()
    if state == SOURCE or state.is_relative_to(SOURCE):
        parser.error('Generated resources must be outside the checkout.')
    state.mkdir(parents=True, exist_ok=True)
    marker = state / '.alder-owned.json'
    owner = {'kind': 'source-testing-proofreading', 'source': str(SOURCE)}
    if not marker.exists():
        if any(state.iterdir()):
            parser.error('Refusing an unowned resource directory.')
        marker.write_text(json.dumps(owner) + '\n', encoding='utf-8')
    elif json.loads(marker.read_text(encoding='utf-8')) != owner:
        parser.error('Resource directory belongs to another owner.')
    for directory in ('scratch', 'logs'):
        (state / directory).mkdir(exist_ok=True)
    Resources(SOURCE, state, 'win32-x64', dict(os.environ), options.offline).proofreading()
