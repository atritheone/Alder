import json, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(root/'backend'), str(root/'backend/tests')]
from test_item_breaks import structure
from alder.document_revisions import review_document, revision_summary
from alder.publishing import import_document
from alder.models import document_text
from alder.document_comments import walk
directory = Path(sys.argv[1])
source = json.loads((directory/'fixture-project.json').read_text(encoding='utf-8'))['book']['chapters'][0]['document']
for filename, views in [('word-resaved.docx', ('original', 'final')), ('word-accept.docx', ('final',)), ('word-reject.docx', ('original',))]:
    restored = import_document(directory/filename)['document']
    assert len(revision_summary(restored)) == (len(revision_summary(source)) if filename == 'word-resaved.docx' else 0), (filename, 'groups')
    for view in views:
        actual, expected = review_document(restored, view), review_document(source, view)
        assert document_text(actual) == document_text(expected), (filename, view, document_text(actual), document_text(expected))
        assert structure(actual) == structure(expected), (filename, view, structure(actual), structure(expected))
        for a, b in zip([n for n in walk(actual) if n['type'] == 'paragraph'], [n for n in walk(expected) if n['type'] == 'paragraph']):
            for key in ('leftIndent', 'rightIndent', 'firstLineIndent', 'align'):
                if b.get('attrs', {}).get(key) is not None:
                    assert a.get('attrs', {}).get(key) == b['attrs'][key], (filename, view, key, a.get('attrs'), b['attrs'])
        if any(n.get('attrs', {}).get('listTemplate') for n in walk(expected)):
            from test_outline_lists import labels
            assert labels(actual) == labels(expected), (filename, view, 'outline labels')
            continue  # Native nested marker/start values are derived from the template.
        for a, b in zip([n for n in walk(actual) if n['type'] == 'ordered_list'], [n for n in walk(expected) if n['type'] == 'ordered_list']):
            for key, default in [('order', 1), ('listStyle', 'decimal')]:
                assert (a.get('attrs', {}).get(key) or default) == (b.get('attrs', {}).get(key) or default), (filename, view, key)
print('Word retains item boundaries, both review structures, numbering, appearance, and exact wording.')
