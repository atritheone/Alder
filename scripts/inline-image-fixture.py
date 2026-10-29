"""Inline placement and drawing-name round trip through installed Word."""
import json
import runpy
import sys
from pathlib import Path

source = runpy.run_path(str(Path(__file__).with_name('word-processing-fixture.py')))
from alder.publishing import build_export, import_document
fixture = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'backend/tests/test_inline_images.py'))
root = Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=True)
if '--check' not in sys.argv:
    project = source['fixture']()
    project['book']['chapters'][0]['document']['content'].extend(fixture['fixture']()['book']['chapters'][0]['document']['content'])
    results = {kind: build_export(project, kind, root) for kind in ('docx', 'pdf')}
    (root / 'fixture-exports.json').write_text(json.dumps(results), encoding='utf-8')
else:
    result = import_document(root / 'word-resaved.docx')
    nodes = result['document']['content'][-3:]
    assert [n['type'] for n in nodes] == ['paragraph', 'paragraph', 'image'], nodes
    assert [n['type'] for n in nodes[0]['content']] == ['text', 'inline_image', 'text'], nodes[0]
    for image in (nodes[0]['content'][1], nodes[1]['content'][0], nodes[2]):
        assert image['attrs']['decorative'] and image['attrs']['alt'] == 'Retained description'
        assert image['attrs']['title'] == 'Retained title'
        assert abs(image['attrs']['width'] - 48) < .001
    print(json.dumps({'status': 'passed', 'placements': [n['type'] for n in nodes]}))
