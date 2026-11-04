from copy import deepcopy
from pathlib import Path
import pytest
from alder.document_comments import walk
from alder.document_comparison import compare_documents
from alder.document_revisions import review_document, revision_summary
from alder.models import validate_project, document_text
from alder.publishing import build_export, import_document
from test_outline_lists import fixture as outline_fixture
from test_outline_revisions import assert_appearance
from test_list_revisions import STAMP, appearances


def fixture(reverse=False, continued=False, formatted=False, cell=False):
    project = outline_fixture()
    outline = project['book']['chapters'][0]['document']
    if not continued:
        outline['content'] = outline['content'][:1]
    for i, listing in enumerate([n for n in walk(outline) if n['type'] == 'ordered_list']):
        listing['content'][0]['content'].insert(1, {'type': 'paragraph', 'content': [{'type': 'text', 'text': f'Continuation wording {i}'}]})
    if formatted:
        for n in walk(outline):
            if n['type'] == 'paragraph':
                n.setdefault('attrs', {}).update(leftIndent=5, firstLineIndent=3)
    ordinary = deepcopy(outline)
    for n in walk(ordinary):
        if n['type'] == 'ordered_list':
            n.setdefault('attrs', {}).pop('listTemplate', None)
    original, final = (outline, ordinary) if reverse else (ordinary, outline)
    if cell:
        for doc in (original, final):
            doc['content'] = [{'type': 'table', 'content': [{'type': 'table_row', 'content': [{'type': 'table_cell', 'content': doc['content']}]}]}]
    source = compare_documents(original, final, STAMP['author'], STAMP['date'])
    project['book']['chapters'][0]['document'] = source
    return validate_project(project)


@pytest.mark.parametrize('reverse', [False, True])
@pytest.mark.parametrize('continued', [False, True])
@pytest.mark.parametrize('formatted', [False, True])
@pytest.mark.parametrize('cell', [False, True])
@pytest.mark.parametrize('format', ['html', 'epub', 'docx'])
def test_conversion_keeps_numbering_and_authored_indents_in_both_views(tmp_path, reverse, continued, formatted, cell, format):
    project = fixture(reverse, continued, formatted, cell)
    source = project['book']['chapters'][0]['document']
    restored = import_document(Path(build_export(project, format, tmp_path)['path']))['document']
    assert len(revision_summary(restored)) == len(revision_summary(source)) == 1
    for view in ('original', 'final'):
        actual, expected = review_document(restored, view), review_document(source, view)
        assert document_text(actual) == document_text(expected)
        assert_appearance(actual, expected)
        if not any(n.get('attrs', {}).get('listTemplate') for n in walk(expected)):
            assert appearances(actual) == appearances(expected)


@pytest.mark.parametrize('view', ['original', 'final'])
@pytest.mark.parametrize('formatted', [False, True])
def test_decided_conversion_can_be_exported_again_without_changing_paragraph_indents(tmp_path, view, formatted):
    project = fixture(formatted=formatted, continued=True)
    source = review_document(project['book']['chapters'][0]['document'], view)
    project['book']['chapters'][0]['document'] = source
    for _ in range(2):
        restored = import_document(Path(build_export(project, 'docx', tmp_path)['path']))['document']
        assert_appearance(restored, source)
        assert len(revision_summary(restored)) == 0
        project['book']['chapters'][0]['document'] = restored


@pytest.mark.parametrize('side', ['old', 'final'])
def test_native_conversion_cannot_discard_an_independent_paragraph_indent(tmp_path, side):
    from docx import Document
    from docx.oxml.ns import qn
    project = fixture(formatted=True)
    path = Path(build_export(project, 'docx', tmp_path)['path'])
    word = Document(path); props = word.paragraphs[0]._p.pPr
    if side == 'old': props = props.find(qn('w:pPrChange')).find(qn('w:pPr'))
    props.find(qn('w:ind')).set(qn('w:left'), '2000'); word.save(path)
    with pytest.raises(ValueError, match='list formatting'):
        import_document(path)
