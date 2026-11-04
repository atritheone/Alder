import json, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(root/'backend'), str(root/'backend/tests')]
from test_structured_combination import fixture, moved_fixture, conflict_fixture
from alder.document_combination import combine_documents
from alder.document_revisions import review_document, revision_summary
from alder.models import create_project, validate_project, document_text
from alder.publishing import build_export
directory = Path(sys.argv[1]).resolve(); directory.mkdir(parents=True, exist_ok=True)
kind = sys.argv[2] if len(sys.argv) > 2 else 'nested'
base, a, b = moved_fixture(kind.removeprefix('move-')) if kind.startswith('move-') else conflict_fixture(kind.removeprefix('conflict-'),comments=True) if kind.startswith('conflict-') else fixture(kind)
combined = combine_documents(a, b)
conflicts = [{'location': c['location'], 'choice': 'original'} for c in combined['conflicts']]
if conflicts: combined = combine_documents(a, b, {c['id']: 'original' for c in combined['conflicts']})
source = combined['document']
project = create_project('Combined structure', template='blank'); project['settings'].update(documentKind='docx', includeTitle=False)
project['book'] = {'version': 1, 'chapters': [{'id': 'chapter', 'title': 'Combined', 'include': True, 'document': source}]}; project = validate_project(project)
(directory/'fixture-inputs.json').write_text(json.dumps({'combining': True, 'original': a, 'revised': b, 'conflicts': conflicts, 'changes': len(revision_summary(source)), 'comments': 1 if kind.startswith('move-') else 2,
    'text': {view: document_text(review_document(source, view)) for view in ('original', 'final')}}), encoding='utf-8')
result = build_export(project, 'docx', directory)
(directory/'fixture-project.json').write_text(json.dumps(project), encoding='utf-8')
(directory/'fixture-exports.json').write_text(json.dumps({'docx': result, 'reviewDecisions': True, 'skipListNumbers': True, 'expectedText': ['Anchor']}), encoding='utf-8')
