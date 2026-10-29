"""Native Word threaded review comments, range anchors and resolved status."""
import json
import runpy
import sys
from pathlib import Path
source = runpy.run_path(str(Path(__file__).with_name('word-processing-fixture.py')))
comments = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'backend/tests/test_document_comments.py'))
from alder.publishing import build_export, import_document
from alder.document_comments import walk
root = Path(sys.argv[1]).resolve(); root.mkdir(parents=True, exist_ok=True)
if '--check' not in sys.argv:
    project = source['fixture']()
    project['book']['chapters'][0]['document']['content'].extend(comments['fixture']()['book']['chapters'][0]['document']['content'])
    result = build_export(project, 'docx', root)
    (root / 'fixture-exports.json').write_text(json.dumps({'docx': result}), encoding='utf-8')
else:
    opened = import_document(root / 'word-resaved.docx')
    anchors = [n['attrs'] for n in walk(opened['document']) if n['type'] == 'comment_anchor']
    assert [a['edge'] for a in anchors] == ['start', 'end'], anchors
    assert anchors[0]['thread'] == anchors[1]['thread']
    thread = anchors[0]['thread']
    assert thread['resolved'] is True, thread
    assert [e['text'] for e in thread['entries']] == ['Review this wording.\nSecond line.', 'Agreed, now resolved.'], thread
    assert [e['author'] for e in thread['entries']] == ['First reviewer', 'Second reviewer']
    print(json.dumps({'status': 'passed', 'threads': 1, 'entries': 2, 'resolved': True}))
