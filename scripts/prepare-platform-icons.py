"""Maintainer-only deterministic icon conversion; outputs are committed to Git."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = Image.open(root / 'frontend/public/branding/alder-icon-source.png').convert('RGBA')
icons = root / 'build/icons'
icons.mkdir(parents=True, exist_ok=True)
for size in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
    source.resize((size, size), Image.Resampling.LANCZOS).save(icons / f'{size}x{size}.png')
source.resize((1024, 1024), Image.Resampling.LANCZOS).save(root / 'build/alder.icns', format='ICNS')
print('Generated Linux PNG icons and macOS ICNS from the existing Alder artwork.')
