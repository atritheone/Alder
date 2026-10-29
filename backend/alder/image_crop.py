"""Non-destructive percentage crops; original collected assets stay untouched."""
import hashlib
import json
import math
from pathlib import Path
import tempfile

EDGES = ('left', 'top', 'right', 'bottom')


def validate_crop(value):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) - set(EDGES):
        raise ValueError('Image crop must contain left, top, right and bottom percentages.')
    crop = {}
    for edge in EDGES:
        amount = value.get(edge, 0)
        if type(amount) not in (int, float) or not math.isfinite(amount) or not 0 <= amount <= 99:
            raise ValueError('Crop percentages must be between 0 and 99.')
        crop[edge] = round(amount, 3)
    if crop['left'] + crop['right'] > 99 or crop['top'] + crop['bottom'] > 99:
        raise ValueError('The crop must leave at least 1% of the image in each direction.')
    return crop if any(crop.values()) else None


def cropped_raster(image, crop):
    crop = validate_crop(crop)
    if not crop:
        return image
    width, height = image.size
    left = min(width - 1, round(width * crop['left'] / 100))
    top = min(height - 1, round(height * crop['top'] / 100))
    right = max(left + 1, round(width * (1 - crop['right'] / 100)))
    bottom = max(top + 1, round(height * (1 - crop['bottom'] / 100)))
    return image.crop((left, top, right, bottom))


def cached_crop(path: Path, crop, cache: Path) -> Path:
    from PIL import Image
    crop = validate_crop(crop)
    if crop is None:
        return path
    stat = path.stat()
    if stat.st_size > 20 * 1024 * 1024:
        raise ValueError('Image exceeds the 20 MB cropping limit.')
    key = hashlib.sha256(json.dumps([str(path.resolve()), stat.st_size, stat.st_mtime_ns, crop], sort_keys=True).encode()).hexdigest()
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / (key + '.png')
    if target.is_file():
        return target
    with Image.open(path) as image:
        if image.width * image.height > 40_000_000:
            raise ValueError('Image exceeds the 40 megapixel cropping limit.')
        rendered = cropped_raster(image, crop).convert('RGBA' if 'A' in image.getbands() else 'RGB')
        with tempfile.NamedTemporaryFile(dir=cache, suffix='.tmp', delete=False) as handle:
            temporary = Path(handle.name)
            try:
                rendered.save(handle, format='PNG')
            except BaseException:
                handle.close()
                temporary.unlink(missing_ok=True)
                raise
    try:
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    # Only generated crop files in this private directory are cache candidates.
    total = target.stat().st_size
    candidates = []
    for item in cache.glob('*.png'):
        if item == target:
            continue
        try:
            candidates.append((item.stat().st_mtime, item))
        except FileNotFoundError:
            pass
    for index, (_, item) in enumerate(sorted(candidates, reverse=True)):
        try:
            total += item.stat().st_size
            if index >= 127 or total > 256 * 1024 * 1024:
                item.unlink()
        except FileNotFoundError:
            pass
    return target
