import json, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]; sys.path[:0] = [str(root/'backend'), str(root/'backend/tests')]
from test_list_kind_revisions import fixture
from alder.document_revisions import review_document, revision_summary
from alder.models import document_text
from alder.publishing import build_export
directory = Path(sys.argv[1]).resolve(); directory.mkdir(parents=True, exist_ok=True)
project = fixture('--bullets' not in sys.argv, 'cell' if '--cell' in sys.argv else 'nested' if '--nested' in sys.argv else 'body', '--continued' in sys.argv)
source = project['book']['chapters'][0]['document']
(directory/'fixture-project.json').write_text(json.dumps(project), encoding='utf-8')
(directory/'fixture-inputs.json').write_text(json.dumps({'original': review_document(source,'original'), 'revised': review_document(source,'final'), 'changes': len(revision_summary(source)), 'comments': 1,
    'text': {v: document_text(review_document(source,v)) for v in ('original','final')}}), encoding='utf-8')
result = build_export(project,'docx',directory)
(directory/'fixture-exports.json').write_text(json.dumps({'docx':result,'reviewDecisions':True,'skipListNumbers':True,'expectedText':['First item']}), encoding='utf-8')
