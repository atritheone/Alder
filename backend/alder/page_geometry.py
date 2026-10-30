"""Page dimensions in millimetres; constants are also consumed by the editor."""
import json
import math
from pathlib import Path

PAGE_FORMAT = json.loads(Path(__file__).with_name("page-format.json").read_text("utf-8"))
PAGE_FIELDS = ("pageWidthMm", "pageHeightMm", "marginTopMm", "marginRightMm",
               "marginBottomMm", "marginLeftMm", "gutterMm")


def _number(value, fallback, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return fallback
    return min(high, max(low, value))


def page_geometry(settings):
    if settings.get("pageSize") == "Custom":
        width = _number(settings.get("pageWidthMm"), 210, PAGE_FORMAT["minimumDimension"], PAGE_FORMAT["maximumDimension"])
        height = _number(settings.get("pageHeightMm"), 297, PAGE_FORMAT["minimumDimension"], PAGE_FORMAT["maximumDimension"])
    else:
        width, height = PAGE_FORMAT["sizes"].get(settings.get("pageSize"), PAGE_FORMAT["sizes"]["A4"])
    if settings.get("orientation") == "landscape":
        width, height = height, width
    margin = _number(settings.get("marginMm"), PAGE_FORMAT["defaultMargin"], 0, PAGE_FORMAT["maximumMargin"])
    margins = {edge: _number(settings.get(f"margin{edge.title()}Mm"), margin, 0, PAGE_FORMAT["maximumMargin"])
               for edge in ("top", "right", "bottom", "left")}
    margins["left"] += _number(settings.get("gutterMm"), 0, 0, PAGE_FORMAT["maximumGutter"])
    adjusted = False
    for first, second, extent in (("left", "right", width), ("top", "bottom", height)):
        total = margins[first] + margins[second]
        if total > extent - PAGE_FORMAT["minimumBody"]:
            factor = (extent - PAGE_FORMAT["minimumBody"]) / total
            margins[first] *= factor
            margins[second] *= factor
            adjusted = True
    return {"width": width, "height": height, "margin": margin, "margins": margins, "adjusted": adjusted}


def validate_page_settings(settings):
    from .line_numbering import validate_line_numbering
    validate_line_numbering(settings.get('lineNumbering'))
    from .watermark import validate_watermark
    validate_watermark(settings.get('watermark'))
    from .page_border import validate_page_border
    validate_page_border(settings.get('pageBorder'))
    from .columns import validate_columns
    validate_columns(settings.get('columns'),page_geometry(settings))
    if not isinstance(settings.get('mirrorMargins', False), bool):
        raise ValueError('Mirrored margins must be true or false.')
    for key in PAGE_FIELDS:
        if key not in settings or settings[key] is None:
            continue
        low, high = (PAGE_FORMAT["minimumDimension"], PAGE_FORMAT["maximumDimension"]) if key in ("pageWidthMm", "pageHeightMm") else (0, PAGE_FORMAT["maximumGutter"] if key == "gutterMm" else PAGE_FORMAT["maximumMargin"])
        value = settings[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f"Invalid document setting: {key}.")
    if any(settings.get(key) is not None for key in PAGE_FIELDS) and page_geometry(settings)["adjusted"]:
        raise ValueError("Page margins must leave at least 20 mm of writing space in each direction.")


def docx_page_settings(document, warnings, section=None):
    """Read the physical geometry of the requested section (the first by default).
    Running stories and other unsupported section properties are handled separately."""
    first = section is None
    section = section if section is not None else document.sections[0]
    width = section.page_width.mm if section.page_width is not None else 210
    height = section.page_height.mm if section.page_height is not None else 297
    settings = {"pageSize": "Custom", "orientation": "portrait",
                "pageWidthMm": width, "pageHeightMm": height}
    for name, dimensions in PAGE_FORMAT["sizes"].items():
        if abs(width - dimensions[0]) < .1 and abs(height - dimensions[1]) < .1:
            settings.update(pageSize=name, orientation="portrait")
            break
        if abs(width - dimensions[1]) < .1 and abs(height - dimensions[0]) < .1:
            settings.update(pageSize=name, orientation="landscape", pageWidthMm=dimensions[0], pageHeightMm=dimensions[1])
            break
    for edge in ("top", "right", "bottom", "left"):
        value = getattr(section, f"{edge}_margin")
        settings[f"margin{edge.title()}Mm"] = value.mm if value is not None else PAGE_FORMAT["defaultMargin"]
    settings['gutterMm'] = section.gutter.mm if section.gutter is not None else 0
    from docx.oxml.ns import qn
    from .columns import read_columns
    from .page_border import read_page_border
    border=read_page_border(section,warnings)
    if border is not None:settings['pageBorder']=border
    from .watermark import read_watermark
    watermark=read_watermark(section,warnings)
    if watermark is not None:settings['watermark']=watermark
    from .line_numbering import read_line_numbering
    line_numbering=read_line_numbering(section,warnings)
    if line_numbering is not None:settings['lineNumbering']=line_numbering
    columns=read_columns(section,warnings)
    if columns is not None: settings['columns']=columns
    mirror = document.settings.element.find(qn('w:mirrorMargins'))
    if first:
        settings['mirrorMargins'] = mirror is not None and mirror.get(qn('w:val'), '1') not in ('0', 'false', 'off')
    top_gutter = document.settings.element.find(qn('w:gutterAtTop'))
    if top_gutter is not None and top_gutter.get(qn('w:val'),'1') not in ('0','false','off'):
        warnings.append("DOCX top binding is converted to a side binding gutter.")
    try:
        validate_page_settings(settings)
    except ValueError:
        # Return usable geometry with a visible conversion report for sizes
        # outside the qualified range or Word pages with no usable text area.
        resolved = page_geometry(settings)
        settings = {"pageSize": "Custom", "orientation": "portrait",
                    "pageWidthMm": resolved['width'], "pageHeightMm": resolved['height'],
                    **{f'margin{edge.title()}Mm': value for edge, value in resolved['margins'].items()},
                    "gutterMm": 0, **({'mirrorMargins':settings.get('mirrorMargins',False)} if first else {})}
        warnings.append("DOCX page dimensions or margins exceed Alder's supported range and were adjusted to retain a usable writing area.")
    if first:
        from .page_numbering import read_docx_numbering
        numbering = read_docx_numbering(section, warnings)
        if 'numberingStart' in numbering:
            settings['firstPageNumber'] = numbering['numberingStart']
        if 'numberingFormat' in numbering:
            settings['pageNumberFormat'] = numbering['numberingFormat']
    return settings


def html_page_metadata(settings):
    import html
    fields = (*PAGE_FIELDS, 'pageSize', 'orientation', 'marginMm', 'mirrorMargins', 'firstPageNumber', 'pageNumberFormat', 'columns', 'noteOptions', 'pageBorder', 'watermark', 'lineNumbering')
    value = {key:settings[key] for key in fields if key in settings}
    return '<meta name="alder-page-settings" content="'+html.escape(json.dumps(value),quote=True)+'"/>'


def read_html_page_metadata(text):
    from bs4 import BeautifulSoup
    from .page_numbering import validate_numbering
    head = BeautifulSoup(text,'html.parser').head
    entry = head.find('meta', attrs={'name':'alder-page-settings'}) if head else None
    if entry is None:return {}
    value = json.loads(entry.get('content','{}'))
    allowed = {*PAGE_FIELDS, 'pageSize','orientation','marginMm','mirrorMargins','firstPageNumber','pageNumberFormat','columns','noteOptions','pageBorder','watermark','lineNumbering'}
    if not isinstance(value,dict) or set(value)-allowed:raise ValueError('Invalid HTML page settings.')
    if value.get('pageSize','A4') not in (*PAGE_FORMAT['sizes'],'Custom') or value.get('orientation','portrait') not in ('portrait','landscape'):raise ValueError('Invalid HTML page geometry.')
    if 'marginMm' in value and (type(value['marginMm']) not in (int,float) or not 0<=value['marginMm']<=100):raise ValueError('Invalid HTML margin.')
    validate_page_settings(value)
    from .note_options import note_options
    note_options(value.get('noteOptions'))
    validate_numbering(value.get('firstPageNumber'),value.get('pageNumberFormat'))
    return value
