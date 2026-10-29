"""Tab-stop exchange fixture for the isolated Word qualification harness."""
import json
import runpy
import sys
from pathlib import Path

source = runpy.run_path(str(Path(__file__).with_name('word-processing-fixture.py')))
from alder.publishing import build_export, import_document

destination = Path(sys.argv[1]).resolve()
destination.mkdir(parents=True, exist_ok=True)
if '--check' not in sys.argv:
    project = source['fixture']()
    doc = project['book']['chapters'][0]['document']
    for align in ('left', 'center', 'right', 'decimal'):
        doc['content'].append(source['paragraph']('TAB_' + align.upper() + '\t12.34', leftIndent=12,
            tabStops=[{'position':216, 'align':align, 'leader':'dot'}]))
        if '--center' in sys.argv: doc['content'][-1]['attrs']['align'] = 'center'
    exports = {format: build_export(project, format, destination) for format in ('docx', 'html')}
    (destination / 'fixture-exports.json').write_text(json.dumps(exports), 'utf-8')
else:
    result = import_document(destination / 'word-resaved.docx')
    found = [p for p in result['document']['content'] if p.get('content', [{}])[0].get('text', '').startswith('TAB_')]
    assert len(found) == 4, found
    for paragraph, align in zip(found, ('left', 'center', 'right', 'decimal')):
        assert paragraph['attrs']['tabStops'] == [{'position':216, 'align':align, 'leader':'dot'}]
        assert '\t12.34' in ''.join(c.get('text','') for c in paragraph['content'])
    print('Word retained all four tab alignments, leaders and literal tabs.')
