"""Focused native Word exchange fixture; all generated files stay in the supplied folder."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from alder.models import create_project, validate_project, document_text
from alder.publishing import build_export, import_document


def paragraph(text, **attrs):
    return {'type': 'paragraph', 'attrs': attrs, 'content': [{'type': 'text', 'text': text}]}


def create(destination):
    p = create_project(template='blank')
    p['settings'].update(documentKind='docx', includeTitle=False, defaultTabStopPt=48,
                         pageSize='A4', marginTopMm=22, marginBottomMm=25.4,
                         marginLeftMm=25.4, marginRightMm=22, gutterMm=4,
                         runningMatter={'headerDistanceMm': 8, 'footerDistanceMm': 9,
                             'header': {'default': {'type': 'doc', 'content': [paragraph('RULER HEADER')]}}})
    stops = [{'position': 72, 'align': 'left', 'leader': 'dot'},
             {'position': 144, 'align': 'bar', 'leader': 'none'},
             {'position': 216, 'align': 'decimal', 'leader': 'line'}]
    p['styles'][0].update(tabStops=stops)
    content = [paragraph('RULER_TABS\tAmount\t12.34', styleId=p['styles'][0]['id'], leftIndent=240, firstLineIndent=-180),
               paragraph('RULER_CLEAR\tDefault stops', styleId=p['styles'][0]['id'], tabStops=[]),
               {'type': 'table', 'attrs': {'align': 'right'}, 'content': [
                   {'type': 'table_row', 'attrs': {'minHeight': 42.35}, 'content': [
                       {'type': 'table_cell', 'attrs': {'colwidth': [width]}, 'content': [paragraph(text)]}
                       for text, width in [('RULER_LEFT', 112.5), ('RULER_RIGHT', 187.5)]]}]}
    ]
    p['book'] = {'version': 1, 'chapters': [{'id': 'rulers', 'title': 'Rulers', 'include': True,
                    'document': {'type': 'doc', 'content': content}}]}
    p = validate_project(p)
    result = build_export(p, 'docx', destination)
    (destination / 'fixture-exports.json').write_text(json.dumps({'docx': result,
        'expectedText': ['RULER_TABS', 'RULER_CLEAR', 'RULER_LEFT', 'RULER_RIGHT'], 'skipListNumbers': True}), encoding='utf-8')


def verify(destination):
    exported = json.loads((destination / 'fixture-exports.json').read_text('utf-8'))
    original = import_document(Path(exported['docx']['path']))
    returned = import_document(destination / 'word-resaved.docx')
    assert document_text(returned['document']) == document_text(original['document'])
    blocks = returned['document']['content']
    assert blocks[0]['attrs']['tabStops'] == original['document']['content'][0]['attrs']['tabStops']
    assert blocks[1]['attrs']['tabStops'] == []
    assert blocks[0]['attrs']['leftIndent'] == 240
    assert blocks[0]['attrs']['firstLineIndent'] == -180
    assert returned['settings']['defaultTabStopPt'] == 48
    for key in ['marginTopMm', 'marginBottomMm', 'marginLeftMm', 'marginRightMm', 'gutterMm']:
        assert abs(returned['settings'][key] - original['settings'][key]) < .03, key
    matter = returned['settings']['runningMatter']
    assert abs(matter['headerDistanceMm'] - 8) < .03
    assert abs(matter['footerDistanceMm'] - 9) < .03
    assert 'RULER HEADER' in document_text(matter['header']['default'])
    table = next(node for node in blocks if node['type'] == 'table')
    assert table['attrs']['align'] == 'right'
    row = table['content'][0]
    assert abs(row['attrs']['minHeight'] - 42.35) < .051
    for cell, width in zip(row['content'], [112.5, 187.5]):
        assert abs(cell['attrs']['colwidth'][0] - width) < .067
    print('PASS: Word retained bar/decimal/leader/cleared tabs, default spacing, hanging indents, margins/gutter, running distances and fractional table dimensions.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    (verify if args.verify else create)(args.directory)
