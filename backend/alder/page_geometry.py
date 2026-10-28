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
    numbering = section._sectPr.find(qn('w:pgNumType'))
    if numbering is not None:
        if first and numbering.get(qn('w:start')) is not None:
            try:
                settings['firstPageNumber'] = min(9999, max(1, int(numbering.get(qn('w:start')))))
            except ValueError:
                warnings.append('DOCX starting page number is invalid and was reset to 1.')
        elif not first and numbering.get(qn('w:start')) is not None:
            warnings.append('DOCX section page-number restarts are converted to continuous numbering.')
        if numbering.get(qn('w:fmt'), 'decimal') != 'decimal':
            warnings.append('DOCX page-number formats are converted to decimal numbering.')
    if document.settings.element.find(qn('w:mirrorMargins')) is not None or document.settings.element.find(qn('w:gutterAtTop')) is not None:
        warnings.append("DOCX mirrored margins or top binding are converted to ordinary margins with a left binding gutter.")
    try:
        validate_page_settings(settings)
    except ValueError:
        # Return usable geometry with a visible conversion report for sizes
        # outside the qualified range or Word pages with no usable text area.
        resolved = page_geometry(settings)
        settings = {"pageSize": "Custom", "orientation": "portrait",
                    "pageWidthMm": resolved['width'], "pageHeightMm": resolved['height'],
                    **{f'margin{edge.title()}Mm': value for edge, value in resolved['margins'].items()},
                    "gutterMm": 0}
        warnings.append("DOCX page dimensions or margins exceed Alder's supported range and were adjusted to retain a usable writing area.")
    return settings
