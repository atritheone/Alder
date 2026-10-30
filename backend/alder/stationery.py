"""Local page-stock templates, expressed as ordinary editable tables/fields.

Distances in the catalogue are millimetres. Printed stock checks are derived;
editing never clips, truncates or rewrites an overflowing address.
"""
from copy import deepcopy
import json
from pathlib import Path

PRESETS = json.loads(Path(__file__).with_name('stationery-presets.json').read_text(encoding='utf-8'))


def preset(identity):
    if not isinstance(identity, str):
        raise ValueError('Unknown stationery template.')
    found = next((item for item in PRESETS if item['id'] == identity), None)
    if found is None:
        raise ValueError('Unknown stationery template.')
    return deepcopy(found)


def create_stationery(identity, name):
    from .models import create_project, validate_project, uid, ValidationError
    from .form_fields import properties
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 200:
        raise ValidationError('Give the document a name of 1–200 characters.')
    stock = preset(identity)
    project = create_project(name.strip(), 'blank')
    width, height = stock['paper']
    top, right, bottom, left = stock['margins']
    project['settings'].update(documentKind='docx', preferredFormat='docx', includeTitle=False,
        includeToc=False, footer=False, header='', fontSize=10, lineHeight=1.15,
        stationeryPreset=identity, pageSize='Custom', orientation='portrait',
        pageWidthMm=width, pageHeightMm=height, marginTopMm=top, marginRightMm=right,
        marginBottomMm=bottom, marginLeftMm=left, gutterMm=0, mirrorMargins=False)
    project['styles'][0].update(fontSize=10, lineHeight=1.15, spaceAfter=0)
    rows = []
    number = 0
    for row_index, row_height in enumerate(stock['rows']):
        cells = []
        for column, column_width in enumerate(stock['columns']):
            label = (stock['fields'][row_index][column] if 'fields' in stock else
                     f'Label {number + 1}' if column in stock['labelColumns'] else None)
            content = []
            if label:
                number += 1
                content.append({'type':'form_field', 'attrs':properties({
                    'kind':'plain', 'label':label, 'tag':f'address_{number}', 'blockId':uid('block_')}), 'content':[]})
            cells.append({'type':'table_cell', 'attrs':{
                'colwidth':[column_width * 96 / 25.4], 'colspan':1, 'rowspan':1,
                'borderWidth':0, 'verticalAlign':'top',
                **{'padding'+edge:(2 * 72 / 25.4 if label else 0) for edge in ('Top','Bottom','Left','Right')}},
                'content':[{'type':'paragraph', 'attrs':{'spaceBefore':0,'spaceAfter':0,'lineHeight':1.15,
                    'fontSize':10,'widowOrphan':False}, 'content':content}]})
        rows.append({'type':'table_row','attrs':{'minHeight':row_height * 72 / 25.4,'allowSplit':False},'content':cells})
    project['book']={'version':1,'chapters':[{'id':uid('chapter_'),'title':name.strip(),'include':True,
        'document':{'type':'doc','content':[{'type':'table','attrs':{'align':'left'},'content':rows}]}}]}
    project['placements']=[]
    return validate_project(project)


def validate_stock(project):
    """Reject changed stock geometry before printable output; saving stays free."""
    from .page_geometry import page_geometry
    settings = project.get('settings', {})
    identity = settings.get('stationeryPreset')
    if not identity:
        return
    stock = preset(identity)
    message = ('The stationery layout no longer matches its paper. Restore its rows, columns and page settings, '
               'or turn off Check stationery fit in Settings → Page Layout to use ordinary pages.')
    if settings.get('footer') or settings.get('header') or settings.get('runningMatter') or (settings.get('columns') or {}).get('count',1)!=1:
        raise ValueError(message)
    geometry = page_geometry(settings)
    if any(abs(geometry[key] - expected) > .05 for key, expected in zip(('width','height'),stock['paper'])):
        raise ValueError(message)
    if any(abs(geometry['margins'][edge] - expected) > .05 for edge,expected in zip(('top','right','bottom','left'),stock['margins'])):
        raise ValueError(message)
    chapters = [c for c in project.get('book',{}).get('chapters',[]) if c.get('include',True)]
    if len(chapters) != 1 or settings.get('includeTitle') or settings.get('includeToc'):
        raise ValueError(message)
    blocks = chapters[0]['document'].get('content',[])
    # ProseMirror may retain an empty trailing paragraph for leaving a table.
    blocks = [n for n in blocks if n.get('type')!='paragraph' or n.get('content')]
    if len(blocks)!=1 or blocks[0]['type']!='table':
        raise ValueError(message)
    rows = blocks[0].get('content',[])
    if len(rows)!=len(stock['rows']):
        raise ValueError(message)
    for row_index, (row, height) in enumerate(zip(rows,stock['rows'])):
        if row.get('attrs',{}).get('allowSplit'):
            raise ValueError(message)
        if abs((row.get('attrs',{}).get('minHeight') or 0) - height*72/25.4) > .1:
            raise ValueError(message)
        cells = row.get('content',[])
        if len(cells)!=len(stock['columns']):
            raise ValueError(message)
        for column,(cell,width) in enumerate(zip(cells,stock['columns'])):
            attrs=cell.get('attrs',{})
            widths=attrs.get('colwidth') or []
            if attrs.get('colspan',1)!=1 or attrs.get('rowspan',1)!=1 or len(widths)!=1 or abs(widths[0]-width*96/25.4)>.1:
                raise ValueError(message)
            allowed=bool(stock['fields'][row_index][column]) if 'fields' in stock else column in stock['labelColumns']
            if not allowed and any(node.get('content') for node in cell.get('content',[])):
                raise ValueError(message)
