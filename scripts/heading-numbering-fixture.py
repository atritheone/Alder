"""Native Word qualification for heading hierarchy, restart and editing semantics."""
import json
from pathlib import Path
import runpy
import sys
source = runpy.run_path(str(Path(__file__).with_name('word-processing-fixture.py')))
from alder.publishing import build_export, import_document
from alder.heading_numbering import number_headings
from alder.models import document_text
from alder.document_references import reference_values
root = Path(sys.argv[1]).resolve(); root.mkdir(parents=True, exist_ok=True)
expected = ['1', '1.1', '1.2', '5', '5.1', '6', '6.1.1']
if '--check' not in sys.argv:
    project = source['fixture']()
    for i, level in enumerate([1,2,2,1,2,1,3]):
        project['book']['chapters'][0]['document']['content'].append({
            'type': 'heading', 'attrs': {'blockId': f'heading_{i}', 'level': level, 'headingNumbered': True, **({'headingStart': 5} if i == 3 else {})},
            'content': [{'type': 'text', 'text': f'HEADING_NUMBER_{i}'}],
        })
    project['book']['chapters'][0]['document']['content'].append({'type':'paragraph', 'content':[
        {'type':'text', 'text':'See section '},
        {'type':'cross_reference', 'attrs':{'targetId':'heading_4', 'referenceFormat':'number'}, 'content':[{'type':'text', 'text':'Stale number'}]},
    ]})
    result = build_export(project, 'docx', root)
    (root / 'fixture-exports.json').write_text(json.dumps({'docx': result, 'headingNumbersExpected': expected}), encoding='utf-8')
else:
    imported = import_document(root / 'word-resaved.docx')['document']
    nodes = [n for n in imported['content'] if n['type'] == 'heading' and 'HEADING_NUMBER_' in json.dumps(n)]
    assert len(nodes) == 7 and all(n['type'] == 'heading' for n in nodes)
    number_headings([{'blocks': nodes}])
    assert [n['attrs']['_headingLabel'] for n in nodes] == expected
    assert [n['attrs'].get('headingStart') for n in nodes] == [None,None,None,5,None,None,None]
    refs = [c for n in imported['content'] for c in n.get('content', []) if c['type'] == 'cross_reference']
    assert len(refs) == 1 and refs[0]['attrs']['referenceFormat'] == 'number', refs
    assert refs[0]['attrs']['targetId'] == nodes[4]['attrs']['blockId'], refs
    assert document_text(refs[0]) == '5.1', refs
    assert reference_values([imported])[(refs[0]['attrs']['targetId'], 'number')] == '5.1'
    print('Word preserves hierarchy, restart, continuation and a live full-number REF field.')
