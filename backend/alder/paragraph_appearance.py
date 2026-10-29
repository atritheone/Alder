"""Paragraph shading and uniform solid borders, with distances in points."""
import math
import re

COLOURS = ('paragraphBackground', 'paragraphBorderColor')
LIMITS = {'paragraphBorderWidth': 12, 'paragraphPadding': 31}


def validate_appearance(attrs):
    for key in COLOURS:
        value = attrs.get(key)
        if value is not None and (not isinstance(value, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}|transparent', value)):
            raise ValueError('Paragraph colours must be hexadecimal colours or transparent.')
    for key, maximum in LIMITS.items():
        value = attrs.get(key)
        if value is not None and (type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= maximum):
            raise ValueError(f'{key} must be between 0 and {maximum} points.')


def appearance_css(attrs):
    css = []
    for key, prop in (('paragraphBackground', 'background-color'), ('paragraphBorderColor', 'outline-color')):
        if attrs.get(key) is not None: css.append(f'{prop}:{attrs[key]}')
    if attrs.get('paragraphBorderWidth') is not None: css.append(f'outline-style:solid;outline-width:{attrs["paragraphBorderWidth"]:g}pt;outline-offset:{-attrs["paragraphBorderWidth"]:g}pt')
    if attrs.get('paragraphPadding') is not None: css.append(f'padding:{attrs["paragraphPadding"]:g}pt')
    return ';'.join(css)


def html_appearance(css):
    attrs = {}
    css = {**css}
    for key in ('color', 'width', 'style'):
        if 'outline-' + key in css and 'border-' + key not in css: css['border-' + key] = css['outline-' + key]
    border = css.get('border', css.get('outline', '')).split()
    for key, prop in (('paragraphBackground', 'background-color'), ('paragraphBorderColor', 'border-color')):
        value = css.get(prop, border[-1] if key == 'paragraphBorderColor' and border else '')
        rgb = re.fullmatch(r'rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)', value)
        if rgb: value = '#' + ''.join(f'{min(255,int(v)):02x}' for v in rgb.groups())
        if re.fullmatch(r'#[0-9a-fA-F]{6}|transparent', value): attrs[key] = value
    for key, prop in (('paragraphBorderWidth', 'border-width'), ('paragraphPadding', 'padding')):
        value = css.get(prop, border[0] if key == 'paragraphBorderWidth' and border else '')
        match = re.fullmatch(r'(\d+(?:\.\d+)?)(pt|px)?', value)
        if match: attrs[key] = min(LIMITS[key], float(match[1]) * (.75 if match[2] == 'px' else 1))
    if css.get('border') == 'none' or css.get('border-style') == 'none': attrs['paragraphBorderWidth'] = 0
    return attrs


def write_appearance(props, attrs, warnings=None):
    if warnings is not None:
        width, padding = attrs.get("paragraphBorderWidth"), attrs.get("paragraphPadding")
        if (width and (width < .25 or round(width * 8) != width * 8)) or (padding is not None and round(padding) != padding):
            message = "DOCX rounds paragraph border widths to eighths of a point (minimum quarter-point) and border spacing to whole points."
            if message not in warnings: warnings.append(message)
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    parent = props._element.get_or_add_pPr()
    if attrs.get('paragraphBackground') is not None:
        for previous in parent.findall(qn('w:shd')): parent.remove(previous)
        shading = OxmlElement('w:shd')
        shading.set(qn('w:val'), 'clear')
        shading.set(qn('w:fill'), attrs['paragraphBackground'][1:] if attrs['paragraphBackground'] != 'transparent' else 'auto')
        parent.insert_element_before(shading, 'w:tabs', 'w:suppressAutoHyphens', 'w:kinsoku', 'w:wordWrap', 'w:overflowPunct', 'w:topLinePunct', 'w:autoSpaceDE', 'w:autoSpaceDN', 'w:bidi', 'w:adjustRightInd', 'w:snapToGrid', 'w:spacing', 'w:ind', 'w:contextualSpacing', 'w:mirrorIndents', 'w:suppressOverlap', 'w:jc', 'w:textDirection', 'w:textAlignment', 'w:textboxTightWrap', 'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr', 'w:sectPr', 'w:pPrChange')
    if any(attrs.get(key) is not None for key in ('paragraphBorderWidth', 'paragraphBorderColor', 'paragraphPadding')):
        previous = parent.find(qn('w:pBdr'))
        borders = previous if previous is not None else OxmlElement('w:pBdr')
        for side in ('top', 'left', 'bottom', 'right', 'between'):
            edge = borders.find(qn('w:' + side))
            if edge is None: edge = OxmlElement('w:' + side); borders.append(edge)
            width = attrs.get('paragraphBorderWidth')
            colour = attrs.get('paragraphBorderColor')
            if width is not None: edge.set(qn('w:val'), 'single' if width and colour != 'transparent' else 'nil'); edge.set(qn('w:sz'), str(max(2, round(width * 8))))
            elif edge.get(qn('w:val')) is None: edge.set(qn('w:val'), 'nil')
            if colour is not None: edge.set(qn('w:color'), colour[1:] if colour != 'transparent' else 'auto')
            if attrs.get('paragraphPadding') is not None: edge.set(qn('w:space'), str(round(attrs['paragraphPadding'])))
        if previous is None: parent.insert_element_before(borders, 'w:shd', 'w:tabs', 'w:suppressAutoHyphens', 'w:kinsoku', 'w:wordWrap', 'w:overflowPunct', 'w:topLinePunct', 'w:autoSpaceDE', 'w:autoSpaceDN', 'w:bidi', 'w:adjustRightInd', 'w:snapToGrid', 'w:spacing', 'w:ind', 'w:contextualSpacing', 'w:mirrorIndents', 'w:suppressOverlap', 'w:jc', 'w:textDirection', 'w:textAlignment', 'w:textboxTightWrap', 'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr', 'w:sectPr', 'w:pPrChange')


def read_appearance(props, warnings=None):
    from docx.oxml.ns import qn
    parent = props._element.pPr
    if parent is None: return {}
    attrs = {}
    shading = parent.find(qn('w:shd'))
    if shading is not None:
        if warnings is not None and (shading.get(qn('w:val'), 'clear') not in ('clear', 'nil') or any('theme' in key.lower() for key in shading.attrib)):
            message = 'Patterned or theme-based DOCX paragraph shading is converted to its stored solid fill.'
            if message not in warnings: warnings.append(message)
        fill = shading.get(qn('w:fill'), 'auto')
        if re.fullmatch(r'[0-9a-fA-F]{6}', fill): attrs['paragraphBackground'] = '#' + fill.lower()
        elif fill == 'auto': attrs['paragraphBackground'] = 'transparent'
    borders = parent.find(qn('w:pBdr'))
    edge = borders.find(qn('w:top')) if borders is not None else None
    if borders is not None and warnings is not None:
        edges = [borders.find(qn('w:' + side)) for side in ('top', 'left', 'bottom', 'right')]
        appearances = [tuple(sorted(e.attrib.items())) if e is not None else None for e in edges]
        if len(set(appearances)) > 1 or any(e is not None and (e.get(qn('w:val'), 'single') not in ('single', 'none', 'nil') or any('theme' in key.lower() for key in e.attrib)) for e in edges):
            message = 'DOCX paragraph borders with different edges, patterns or theme colours are converted to a uniform solid border based on the top edge.'
            if message not in warnings: warnings.append(message)
    if edge is not None:
        if edge.get(qn('w:val')) in ('none', 'nil'): attrs['paragraphBorderWidth'] = 0
        else:
            try: attrs['paragraphBorderWidth'] = max(0, min(12, float(edge.get(qn('w:sz'), '6')) / 8))
            except ValueError: pass
        colour = edge.get(qn('w:color'), '')
        if re.fullmatch(r'[0-9a-fA-F]{6}', colour): attrs['paragraphBorderColor'] = '#' + colour.lower()
        if edge.get(qn('w:space')) is not None:
            try: attrs['paragraphPadding'] = max(0, min(31, float(edge.get(qn('w:space')))))
            except ValueError: pass
    return attrs
