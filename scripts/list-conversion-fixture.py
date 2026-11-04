import json, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(root/'backend'), str(root/'backend/tests')]
from test_list_conversion_revisions import fixture
from test_outline_lists import labels
from alder.document_revisions import review_document, revision_summary
from alder.document_comments import walk
from alder.models import document_text
from alder.publishing import build_export

directory = Path(sys.argv[1]).resolve(); directory.mkdir(parents=True, exist_ok=True)
project = fixture('--reverse' in sys.argv, '--continued' in sys.argv, '--formatted' in sys.argv, '--cell' in sys.argv)
source = project['book']['chapters'][0]['document']
original, final = review_document(source, 'original'), review_document(source, 'final')
template = next((n['attrs']['listTemplate'] for n in walk(final) if n.get('attrs', {}).get('listTemplate')), None)
result = build_export(project, 'docx', directory)
(directory/'fixture-project.json').write_text(json.dumps(project), encoding='utf-8')
(directory/'fixture-exports.json').write_text(json.dumps({'docx': result, 'reviewDecisions': True, 'skipListNumbers': True, 'expectedText': ['OUTLINE_A', 'Continuation wording']}), encoding='utf-8')
(directory/'fixture-inputs.json').write_text(json.dumps({'original': original, 'revised': final, 'changes': len(revision_summary(source)), 'comments': 0, 'expectedText': ['OUTLINE_A'],
    'conversionChange': {'reverse': '--reverse' in sys.argv, 'template': template},
    'text': {v: document_text(review_document(source, v)) for v in ('original', 'final')}, 'numberLabels': {v: labels(review_document(source, v)) for v in ('original', 'final')}}), encoding='utf-8')
