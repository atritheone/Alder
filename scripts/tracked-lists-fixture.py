import json, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(root/'backend'), str(root/'backend/tests')]
from test_tracked_lists import fixture, continued_fixture, outline_continued_fixture
from alder.publishing import build_export
directory = Path(sys.argv[1]).resolve(); directory.mkdir(parents=True, exist_ok=True)
project = fixture('deletion' if '--delete' in sys.argv else 'insertion', sys.argv[2] if len(sys.argv) > 2 else 'body', outline='--outline' in sys.argv)
if '--continued' in sys.argv:
    project = continued_fixture('deletion' if '--delete' in sys.argv else 'insertion', '--restart' not in sys.argv, sys.argv[2] if len(sys.argv)>2 else 'body')
    if '--outline' in sys.argv:
        project = outline_continued_fixture('deletion' if '--delete' in sys.argv else 'insertion','--restart' in sys.argv,len(sys.argv)>2 and sys.argv[2]=='cell','--bullet' in sys.argv)
if '--independent' in sys.argv:
    from test_nested_outlines import boundary_fixture
    depth = int(sys.argv[sys.argv.index('--depth')+1]) if '--depth' in sys.argv else 1
    project = boundary_fixture('deletion' if '--delete' in sys.argv else 'insertion', '--continued' in sys.argv, '--restart' in sys.argv, len(sys.argv)>2 and sys.argv[2]=='cell', depth)
if '--compare' in sys.argv:
    from alder.document_revisions import review_document, revision_summary
    from alder.document_comparison import compare_documents
    from alder.models import document_text
    from test_outline_lists import labels
    pending = project['book']['chapters'][0]['document']
    original, final = review_document(pending, 'original'), review_document(pending, 'final')
    project['book']['chapters'][0]['document'] = compared = compare_documents(original, final, author='Reviewer', date='2026-11-04T01:00:00Z')
    (directory/'fixture-inputs.json').write_text(json.dumps({'original': original, 'revised': final, 'changes': len(revision_summary(compared)), 'comments': 1,
        'text': {'original': document_text(original), 'final': document_text(final)}, 'numberLabels': {'original': labels(original), 'final': labels(final)}}), encoding='utf-8')
result = build_export(project, 'docx', directory)
(directory/'fixture-project.json').write_text(json.dumps(project), encoding='utf-8')
(directory/'fixture-exports.json').write_text(json.dumps({'docx': result, 'reviewDecisions': True, 'skipListNumbers': True, 'expectedText': ['OUTLINE_A'] if '--outline' in sys.argv and '--continued' in sys.argv else ['First', 'Last item']}), encoding='utf-8')
