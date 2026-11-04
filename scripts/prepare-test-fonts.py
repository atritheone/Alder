"""Prepare only the pinned publication fonts needed by backend source tests."""
import argparse
import json
from pathlib import Path
import shutil
import sys
import tempfile

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE / 'scripts/setup'))
from downloads import fetch, extract


def prepare(output, cache):
    manifest = json.loads((SOURCE / 'resources/manifests/common.json').read_text())
    record = next(item for item in manifest['artifacts'] if item['id'] == 'liberation-fonts')
    archive = fetch(record, cache)
    names = [f'LiberationSerif-{style}.ttf' for style in ('Regular', 'Bold', 'Italic', 'BoldItalic')]
    names += ['LICENSE', 'AUTHORS']
    with tempfile.TemporaryDirectory(prefix='alder-test-fonts-') as temporary:
        stage = Path(temporary)
        extract(archive, stage)
        files = {}
        for name in names:
            matches = list(stage.rglob(name))
            if len(matches) != 1:
                raise RuntimeError(f'Expected one {name} in the pinned font archive')
            files[name] = matches[0]
        destination = Path(output) / 'fonts'
        destination.mkdir(parents=True, exist_ok=True)
        for name, source in files.items():
            shutil.copy2(source, destination / name)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--cache', required=True, type=Path)
    args = parser.parse_args()
    prepare(args.output, args.cache)
