import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path[:0]=[str(root/'backend'),str(root/'backend/tests')]
from test_list_revisions import appearances
from alder.publishing import import_document
from alder.document_revisions import review_document,revision_summary
from alder.models import document_text
from alder.document_comments import walk
directory=Path(sys.argv[1]);source=json.loads((directory/'fixture-project.json').read_text(encoding='utf-8'))['book']['chapters'][0]['document']
for filename,views in [('word-resaved.docx',('original','final')),('word-accept.docx',('final',)),('word-reject.docx',('original',))]:
    restored=import_document(directory/filename)['document']
    assert len(revision_summary(restored))==(len(revision_summary(source)) if filename=='word-resaved.docx' else 0),(filename,'review groups')
    for view in views:
        actual,expected=review_document(restored,view),review_document(source,view)
        assert document_text(actual)==document_text(expected),(filename,view)
        if any(n.get('attrs',{}).get('listTemplate') for n in walk(source)):
            from test_outline_revisions import assert_appearance
            assert_appearance(actual,expected)
            if '--continuation-intent' in sys.argv:
                intent=lambda doc:[bool(n.get('attrs',{}).get('continuePrevious')) for n in walk(doc) if n.get('attrs',{}).get('listTemplate')]
                assert intent(actual)==intent(expected),(filename,view,'outline continuation intent',intent(actual),intent(expected))
        if not any(n.get('attrs',{}).get('listTemplate') for n in walk(expected)):
            assert appearances(actual)==appearances(expected),(filename,view,appearances(actual),appearances(expected))
print('Word preserves list markers, starts and item content through resave and both decisions.')
