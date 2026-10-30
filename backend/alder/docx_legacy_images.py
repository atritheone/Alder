"""Read embedded raster pictures in Word's older VML representation."""
import math
import re
import base64
import io
from pathlib import Path

VML = 'urn:schemas-microsoft-com:vml'
OFFICE = 'urn:schemas-microsoft-com:office:office'


def length(value):
    match = re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(pt|px|in|cm|mm)?\s*', value or '')
    if not match:
        return None
    result = float(match[1]) * {'pt': 96/72, 'px': 1, 'in': 96, 'cm': 96/2.54, 'mm': 96/25.4, None: 1}[match[2]]
    return result if math.isfinite(result) and 1 <= result <= 10000 else None


def read_pictures(drawing, owner, assets, warnings):
    from docx.oxml.ns import qn
    from .publishing import _asset_from_bytes, _warn
    from .image_crop import validate_crop
    result = []
    for shape in drawing.iter(f'{{{VML}}}shape'):
        image = shape.find(f'{{{VML}}}imagedata')
        if image is None:
            continue
        rid = image.get(qn('r:id')) or image.get(f'{{{OFFICE}}}relid')
        relationship = owner.rels.get(rid)
        if relationship is None or relationship.is_external:
            raise ValueError('A legacy Word picture is missing or linked externally. Embed the picture in the source document before opening it.')
        part = relationship.target_part
        asset = _asset_from_bytes(part.blob, Path(str(part.partname)).name, assets, warnings)
        if not asset:
            raise ValueError('A legacy Word picture could not be decoded. Convert it to a raster picture in the source document.')
        attrs = {'assetId': asset, 'src': 'asset:'+asset, 'alt': shape.get('alt', '')}
        title = image.get(f'{{{OFFICE}}}title') or shape.get('title')
        if title:
            attrs['title'] = title
        style = dict(item.strip().lower().split(':', 1) for item in shape.get('style', '').split(';') if ':' in item)
        style = {key.strip(): value.strip() for key, value in style.items()}
        width = length(style.get('width'))
        if width:
            attrs['width'] = width
        try:
            crop = {}
            for edge in ('left', 'right', 'top', 'bottom'):
                value = image.get('crop'+edge, '0').strip()
                crop[edge] = float(value[:-1])/65536*100 if value.endswith('f') else float(value)*100
            if any(crop.values()):
                attrs['crop'] = validate_crop(crop)
        except (ValueError, TypeError):
            _warn(warnings, 'A legacy Word picture with unsupported crop or padding was imported uncropped.')
        if (style.get('position', 'static') != 'static' or style.get('rotation', '0') != '0'
                or style.get('flip') or any(key.startswith('mso-position') for key in style)):
            _warn(warnings, 'A positioned legacy Word picture was converted to an unrotated inline picture.')
        if any(image.get(key) is not None for key in ('gain', 'gamma', 'blacklevel', 'grayscale', 'bilevel', 'chromakey')):
            _warn(warnings, 'Legacy Word picture colour effects are not retained.')
        height = length(style.get('height'))
        from PIL import Image
        picture = next(item for item in assets if item['id'] == asset)
        with Image.open(io.BytesIO(base64.b64decode(picture['data']))) as decoded:
            natural_width, natural_height = decoded.size
        crop = attrs.get('crop') or {}
        natural_ratio = natural_height * (100-crop.get('top',0)-crop.get('bottom',0)) / (natural_width * (100-crop.get('left',0)-crop.get('right',0)))
        if width and height and abs(height/width-natural_ratio) > .02:
            _warn(warnings, 'A stretched legacy Word picture was restored to its natural aspect ratio.')
        result.append({'type': 'inline_image', 'attrs': attrs})
    return result
