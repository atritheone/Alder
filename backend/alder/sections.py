"""Section boundaries are body nodes; their page settings apply after the break."""
from .page_geometry import PAGE_FIELDS, PAGE_FORMAT, validate_page_settings, page_geometry
from .page_numbering import validate_numbering


def validate_section(attrs):
    from .note_options import note_options
    note_options(attrs.get('noteOptions'))
    from .running_matter import validate_running_matter
    validate_running_matter(attrs.get('runningMatter'), section=True)
    validate_numbering(attrs.get('numberingStart'), attrs.get('numberingFormat'))
    if attrs.get('kind', 'nextPage') not in ('nextPage', 'continuous', 'oddPage', 'evenPage'):
        raise ValueError('Unsupported section break.')
    page = attrs.get('page', {})
    if not isinstance(page, dict) or set(page) - set(PAGE_FIELDS) - {'pageSize', 'orientation', 'marginMm', 'columns', 'pageBorder', 'watermark', 'lineNumbering'}:
        raise ValueError('Invalid section page settings.')
    if page.get('pageSize', 'A4') not in (*PAGE_FORMAT['sizes'], 'Custom') or page.get('orientation', 'portrait') not in ('portrait', 'landscape'):
        raise ValueError('Invalid section paper or orientation.')
    if 'marginMm' in page and (type(page['marginMm']) not in (int, float) or not 0 <= page['marginMm'] <= 100):
        raise ValueError('Invalid section margin.')
    validate_page_settings(page)
    if page_geometry(page)['adjusted']:
        raise ValueError('Section margins must leave at least 20 mm of writing space.')


def write_docx_geometry(section, settings):
    from .line_numbering import write_line_numbering
    write_line_numbering(section,settings.get('lineNumbering'))
    from .page_border import write_page_border
    write_page_border(section,settings.get('pageBorder'))
    from .columns import write_columns
    write_columns(section,settings.get('columns'))
    from docx.shared import Mm
    from docx.enum.section import WD_ORIENT
    geometry = page_geometry(settings)
    section.page_width, section.page_height = Mm(geometry['width']), Mm(geometry['height'])
    section.orientation = WD_ORIENT.LANDSCAPE if geometry['width'] > geometry['height'] else WD_ORIENT.PORTRAIT
    for edge, value in geometry['margins'].items():
        setattr(section, f'{edge}_margin', Mm(value))
    gutter = min(50, max(0, settings.get('gutterMm') or 0))
    section.gutter = Mm(gutter)
    section.left_margin = Mm(geometry['margins']['left'] - gutter)
