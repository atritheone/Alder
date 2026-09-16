"""Extract pinned private publishing/audio tools on the target Unix OS."""
import argparse
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('unix_resources', Path(__file__).with_name('prepare-unix-resources.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=ROOT / 'work/native-downloads')
    parser.add_argument('--output', type=Path, default=ROOT / 'work/native-tools')
    args = parser.parse_args()
    arch = 'arm64' if platform.machine() in ('arm64', 'aarch64') else 'x64'
    target = sys.platform + '-' + arch
    if target not in ('linux-x64', 'darwin-x64', 'darwin-arm64'):
        parser.error('Unsupported native tools target: ' + target)
    output = args.output.resolve()
    audio = output / 'ffmpeg'
    audio.mkdir(parents=True, exist_ok=True)
    for item in json.loads((ROOT / 'scripts/ffmpeg-sources.json').read_text())[target]:
        source = builder.download(item, args.cache)
        if item['name'].endswith('.gz'):
            name = item['name'].split('-')[0]
            with gzip.open(source, 'rb') as src, (audio / name).open('wb') as dest:
                shutil.copyfileobj(src, dest)
            (audio / name).chmod(0o755)
        else:
            shutil.copy2(source, audio / item['name'].split('.')[-1])
    item = json.loads((ROOT / 'scripts/calibre-sources.json').read_text())['darwin' if sys.platform == 'darwin' else 'linux-x64']
    archive = builder.download(item, args.cache)
    if sys.platform == 'darwin':
        with tempfile.TemporaryDirectory(prefix='alder-calibre-') as mount:
            subprocess.run(['hdiutil', 'attach', '-nobrowse', '-readonly', '-mountpoint', mount, str(archive)], check=True)
            try:
                app = next(Path(mount).glob('*.app'))
                target_app = output / 'calibre/calibre.app'
                target_app.parent.mkdir(parents=True, exist_ok=True)
                subprocess.run(['ditto', str(app), str(target_app)], check=True)
            finally:
                subprocess.run(['hdiutil', 'detach', mount], check=True)
    else:
        builder.extract(archive, output / 'calibre')
    (output / 'manifest.json').write_text(json.dumps({'target': target, 'calibre': item}, indent=2))
    print('Prepared native tools:', output)


if __name__ == '__main__': main()
