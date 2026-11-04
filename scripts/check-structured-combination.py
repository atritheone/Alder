import json, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(root/'backend'), str(root/'backend/tests')]
from alder.document_revisions import review_document, revision_summary
from alder.publishing import import_document
from alder.models import document_text
from test_item_breaks import structure
directory = Path(sys.argv[1])
source = json.loads((directory/'fixture-project.json').read_text(encoding='utf-8'))['book']['chapters'][0]['document']
for filename, views in [('word-resaved.docx', ('original', 'final')), ('word-accept.docx', ('final',)), ('word-reject.docx', ('original',))]:
    restored = import_document(directory/filename)['document']
    if filename == 'word-resaved.docx':
        assert {(r['author'], r['date']) for r in revision_summary(restored)} == {(r['author'], r['date']) for r in revision_summary(source)}
    else: assert not revision_summary(restored)
    for view in views:
        a, b = review_document(restored, view), review_document(source, view)
        assert document_text(a) == document_text(b), (filename, view)
        assert structure(a) == structure(b), (filename, view, 'structure')
print('Word retains combined nested reviews, authors/dates and both complete document views.')
