"""Portable table appearance. All distances are points except grid widths (CSS px)."""
import math
import re

PADDING = ('Top', 'Bottom', 'Left', 'Right')


def validate_table_attributes(kind, attrs):
    if kind == 'table' and attrs.get('align') not in (None, 'left', 'center', 'right'):
        raise ValueError('Unsupported table alignment.')
    if kind == 'table_row':
        bounds = {'minHeight': 1440}
    elif kind in ('table_cell', 'table_header'):
        bounds = {**{'padding' + side: 144 for side in PADDING}, 'borderWidth': 12}
        if attrs.get('verticalAlign') not in (None, 'top', 'middle', 'bottom'):
            raise ValueError('Unsupported cell vertical alignment.')
        for key in ('background', 'borderColor'):
            if attrs.get(key) is not None and not re.fullmatch(r'#[0-9a-fA-F]{6}', str(attrs[key])):
                raise ValueError('Table colours must use six-digit hexadecimal values.')
        for key in ('colspan', 'rowspan'):
            if key in attrs and (type(attrs[key]) is not int or not 1 <= attrs[key] <= 1000):
                raise ValueError('Invalid table cell span.')
        widths = attrs.get('colwidth')
        if widths is not None and (not isinstance(widths, list) or len(widths) != attrs.get('colspan', 1) or any(type(width) not in (int, float) or not math.isfinite(width) or not 0 <= width <= 10000 for width in widths)):
            raise ValueError('Invalid table column widths.')
    else:
        bounds = {}
    for key, maximum in bounds.items():
        value = attrs.get(key)
        if value is not None and (type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= maximum):
            raise ValueError(f'{key} must be between 0 and {maximum} points.')


def table_css(kind, attrs):
    css = []
    if kind == 'table':
        css.extend(('margin-left:' + ('auto' if attrs.get('align') in ('center', 'right') else '0'), 'margin-right:' + ('auto' if attrs.get('align') == 'center' else '0')))
    if kind == 'table_row' and attrs.get('minHeight') is not None:
        css.append(f'height:{attrs["minHeight"]:g}pt')
    if kind in ('table_cell', 'table_header'):
        for side in PADDING:
            if attrs.get('padding' + side) is not None:
                css.append(f'padding-{side.lower()}:{attrs["padding" + side]:g}pt')
        if attrs.get('verticalAlign'):
            css.append('vertical-align:' + attrs['verticalAlign'])
        if attrs.get('borderWidth') is not None:
            css.append(f'border:{attrs["borderWidth"]:g}pt solid {attrs.get("borderColor") or "#999999"}')
        elif attrs.get('borderColor'):
            css.append('border-color:' + attrs['borderColor'])
        if attrs.get('background'):
            css.append('background-color:' + attrs['background'])
    return ';'.join(css)


def html_table_attributes(kind, element):
    styles = dict((key.strip().lower(), value.strip()) for key, _, value in (entry.partition(':') for entry in element.get('style', '').split(';')) if key and value)
    attrs = {}
    def points(value, maximum):
        match = re.fullmatch(r'(\d+(?:\.\d+)?)(pt|px)?', value or '')
        return min(maximum, float(match[1]) * (.75 if match[2] == 'px' else 1)) if match else None
    def colour(value):
        if re.fullmatch(r'#[0-9a-fA-F]{6}', value or ''): return value
        rgb = re.fullmatch(r'rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)', value or '')
        return '#' + ''.join(f'{min(255, int(v)):02x}' for v in rgb.groups()) if rgb else None
    if kind == 'table':
        align = element.get('data-table-align') or element.get('align') or ('center' if styles.get('margin-left') == styles.get('margin-right') == 'auto' else 'right' if styles.get('margin-left') == 'auto' else 'left')
        if align in ('left', 'center', 'right'): attrs['align'] = align
    if kind == 'table_row':
        attrs['minHeight'] = points(styles.get('height'), 1440)
    if kind in ('table_cell', 'table_header'):
        for side in PADDING:
            attrs['padding' + side] = points(styles.get('padding-' + side.lower(), styles.get('padding')), 144)
        if styles.get('vertical-align') in ('top', 'middle', 'bottom'): attrs['verticalAlign'] = styles['vertical-align']
        attrs['background'] = colour(styles.get('background-color', styles.get('background')))
        border = styles.get('border', '').split()
        attrs['borderWidth'] = 0 if styles.get('border') == 'none' else points(styles.get('border-width', border[0] if border else ''), 12)
        attrs['borderColor'] = colour(styles.get('border-color', border[-1] if border else ''))
        widths = element.get('data-colwidth', '')
        if re.fullmatch(r'\d+(?:,\d+)*', widths):
            parsed = [min(10000, int(width)) for width in widths.split(',')]
            try: span = int(element.get('colspan', 1))
            except (TypeError, ValueError): span = 1
            if len(parsed) == span: attrs['colwidth'] = parsed
    return {key: value for key, value in attrs.items() if value is not None}


def write_docx_cell(cell, attrs, header=False):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
    props = cell._tc.get_or_add_tcPr()
    cell.vertical_alignment = {'top': WD_CELL_VERTICAL_ALIGNMENT.TOP, 'middle': WD_CELL_VERTICAL_ALIGNMENT.CENTER, 'bottom': WD_CELL_VERTICAL_ALIGNMENT.BOTTOM}.get(attrs.get('verticalAlign'), WD_CELL_VERTICAL_ALIGNMENT.TOP)
    margins = OxmlElement('w:tcMar')
    for side in PADDING:
        item = OxmlElement('w:' + side.lower())
        item.set(qn('w:w'), str(round((attrs.get('padding' + side) if attrs.get('padding' + side) is not None else 5.25) * 20)))
        item.set(qn('w:type'), 'dxa'); margins.append(item)
    props.append(margins)
    border = OxmlElement('w:tcBorders')
    width = attrs.get('borderWidth') if attrs.get('borderWidth') is not None else .75
    for side in PADDING:
        item = OxmlElement('w:' + side.lower())
        item.set(qn('w:val'), 'single' if width else 'nil')
        item.set(qn('w:sz'), str(max(2, round(width * 8))))
        item.set(qn('w:color'), (attrs.get('borderColor') or '#999999')[1:])
        border.append(item)
    props.append(border)
    background = attrs.get('background') or ('#eeeeee' if header else None)
    if background:
        shading = OxmlElement('w:shd'); shading.set(qn('w:fill'), background[1:]); props.append(shading)


def read_docx_cell(cell):
    from docx.oxml.ns import qn
    props = cell._tc.tcPr
    if props is None: return {}
    attrs = {}
    align = props.find(qn('w:vAlign'))
    if align is not None:
        value = align.get(qn('w:val'))
        if value in ('top', 'center', 'bottom'): attrs['verticalAlign'] = 'middle' if value == 'center' else value
    margins = props.find(qn('w:tcMar'))
    if margins is not None:
        for side in PADDING:
            value = margins.find(qn('w:' + side.lower()))
            if value is not None and value.get(qn('w:type'), 'dxa') == 'dxa': attrs['padding' + side] = max(0, min(144, int(value.get(qn('w:w'), 0)) / 20))
    borders = props.find(qn('w:tcBorders'))
    if borders is not None:
        value = borders.find(qn('w:top'))
        if value is not None:
            attrs['borderWidth'] = 0 if value.get(qn('w:val')) in ('nil', 'none') else max(0, min(12, int(value.get(qn('w:sz'), 6)) / 8))
            colour = value.get(qn('w:color'), '')
            if re.fullmatch('[0-9a-fA-F]{6}', colour): attrs['borderColor'] = '#' + colour
    shade = props.find(qn('w:shd'))
    if shade is not None and re.fullmatch('[0-9a-fA-F]{6}', shade.get(qn('w:fill'), '')): attrs['background'] = '#' + shade.get(qn('w:fill'))
    return attrs
