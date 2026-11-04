import json, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(root/'backend'), str(root/'backend/tests')]
from test_item_breaks import fixture
from alder.publishing import build_export
directory = Path(sys.argv[1]).resolve(); directory.mkdir(parents=True, exist_ok=True)
project = fixture(sys.argv[2] if len(sys.argv) > 2 else 'body', comments='--comments' in sys.argv, outline='--outline' in sys.argv, join='--join' in sys.argv, formatted='--formatted' in sys.argv)
if '--compare' in sys.argv:
    from alder.document_revisions import review_document, revision_summary
    from alder.document_comparison import compare_documents
    from alder.models import document_text
    from alder.outline_lists import outline_layout
    from test_outline_lists import labels
    pending = project['book']['chapters'][0]['document']
    pending['content'].insert(0, {'type': 'paragraph', 'content': [{'type': 'text', 'text': 'Anchor'}]})
    original, final = review_document(pending, 'original'), review_document(pending, 'final')
    project['book']['chapters'][0]['document'] = compared = compare_documents(original, final, author='Reviewer', date='2026-11-04T01:00:00Z')
    (directory/'fixture-inputs.json').write_text(json.dumps({'original': original, 'revised': final, 'changes': len(revision_summary(compared)),
        'comments': 1 if '--comments' in sys.argv else 0, 'text': {'original': document_text(original), 'final': document_text(final)},
        'numberLabels': {'original': labels(original), 'final': labels(final)}}), encoding='utf-8')
result = build_export(project, 'docx', directory)
(directory/'fixture-project.json').write_text(json.dumps(project), encoding='utf-8')
(directory/'fixture-exports.json').write_text(json.dumps({'docx': result, 'reviewDecisions': True, 'skipListNumbers': True, 'expectedText': ['First', 'Last item']}), encoding='utf-8')
