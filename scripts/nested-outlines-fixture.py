import json, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(root/'backend'), str(root/'backend/tests')]
from test_nested_outlines import fixture
from test_outline_lists import labels
from alder.document_revisions import review_document, revision_summary
from alder.models import document_text
from alder.publishing import build_export

directory = Path(sys.argv[1]).resolve(); directory.mkdir(parents=True, exist_ok=True)
depth = int(sys.argv[sys.argv.index('--depth')+1]) if '--depth' in sys.argv else 1
project = fixture(depth, '--review' in sys.argv, '--cell' in sys.argv)
if '--continuation-change' in sys.argv:
    from test_nested_outlines import continuation_change_fixture
    project=continuation_change_fixture('--restart' not in sys.argv,'--unmatched' in sys.argv,'--cell' in sys.argv,depth)
if '--move' in sys.argv:
    from test_nested_outlines import move_fixture
    project=move_fixture('--cell' in sys.argv,depth,'--separate' in sys.argv,'--continued' in sys.argv)
if '--conversion' in sys.argv:
    from test_nested_outlines import conversion_fixture
    project=conversion_fixture('--reverse' in sys.argv,'--continued' in sys.argv,'--cell' in sys.argv,depth)
source = project['book']['chapters'][0]['document']
expected=['First item','Other item'] if '--move' in sys.argv else ['OUTLINE_A'] if '--conversion' in sys.argv else ['OUTLINE_A','Other 0']
result = build_export(project, 'docx', directory)
(directory/'fixture-project.json').write_text(json.dumps(project), encoding='utf-8')
(directory/'fixture-exports.json').write_text(json.dumps({'docx': result, 'reviewDecisions': bool(revision_summary(source)), 'skipListNumbers': True, 'expectedText': expected}), encoding='utf-8')
(directory/'fixture-inputs.json').write_text(json.dumps({'original': review_document(source, 'original'), 'revised': review_document(source, 'final'), 'changes': len(revision_summary(source)), 'comments': 1, 'expectedText': expected,
    'text': {v: document_text(review_document(source, v)) for v in ('original', 'final')}, 'numberLabels': {v: labels(review_document(source, v)) for v in ('original', 'final')}}), encoding='utf-8')
