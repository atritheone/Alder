from copy import deepcopy
from pathlib import Path
import pytest
from alder.models import create_project, validate_project, document_text
from alder.document_revisions import review_document, revision_summary
from alder.document_comparison import compare_documents
from alder.document_comments import walk
from alder.publishing import build_export, import_document
from test_list_revisions import STAMP
from test_tracked_comment_moves import THREAD


def fixture(numbered=True, container='body', continued=False):
    p = lambda text: {'type': 'paragraph', 'attrs': {'leftIndent': 2, 'firstLineIndent': 1}, 'content': [{'type': 'text', 'text': text}]}
    item = lambda text: {'type': 'list_item', 'content': [p(text)]}
    before = {'type': 'ordered_list' if numbered else 'bullet_list', 'attrs': {'order': 7, 'listStyle': 'upper-roman'} if numbered else {'listStyle': 'square'}}
    after = {'type': 'bullet_list' if numbered else 'ordered_list', 'attrs': {'listStyle': 'disc'} if numbered else {'order': 1, 'listStyle': 'decimal'}}
    listing = {**deepcopy(after), 'content': [item('First item'), item('Second item')]}
    listing['content'][0]['content'].extend([p('Continuation wording'), {'type': 'ordered_list', 'attrs': {'order': 3}, 'content': [item('Nested item')]}])
    for paragraph, edge in ((listing['content'][0]['content'][0], 'start'), (listing['content'][-1]['content'][0], 'end')):
        paragraph['content'].insert(0 if edge == 'start' else len(paragraph['content']), {'type': 'comment_anchor', 'attrs': {'threadId': 'thread', 'edge': edge, 'thread': deepcopy(THREAD)}})
    listing['attrs']['revisionProperties'] = {'base': before, 'records': [{'stamp': STAMP, 'status': 'pending', 'before': before, 'after': deepcopy(after)}]}
    content = [p('Anchor'), listing]
    if continued:
        content[1:1] = [{'type': 'ordered_list', 'attrs': {'order': 3, 'listStyle': 'upper-roman' if numbered else 'decimal'}, 'content': [item('Earlier item')]}, p('Between')]
        content.extend([p('After'), {'type': 'ordered_list', 'attrs': {'continuePrevious': True, 'listStyle': 'upper-roman' if numbered else 'decimal'}, 'content': [item('Later first'), item('Later last')]}])
    if container == 'cell': content = [{'type': 'table', 'content': [{'type': 'table_row', 'content': [{'type': 'table_cell', 'content': content}]}]}]
    if container == 'nested': content = [{'type': 'ordered_list', 'content': [{'type': 'list_item', 'content': content}]}]
    project = create_project('List conversion', template='blank'); project['settings'].update(documentKind='docx', includeTitle=False)
    project['book'] = {'version': 1, 'chapters': [{'id': 'main', 'title': 'Text', 'include': True, 'document': {'type': 'doc', 'content': content}}]}
    return validate_project(project)


def appearance(doc):
    return [(n['type'], n.get('attrs', {}).get('listStyle') or ('decimal' if n['type'] == 'ordered_list' else 'disc'),
             n.get('attrs', {}).get('order', 1) if n['type'] == 'ordered_list' else 1,
             bool(n.get('attrs', {}).get('continuePrevious'))) for n in walk(doc) if n['type'] in ('ordered_list', 'bullet_list')]


@pytest.mark.parametrize('numbered', [False, True])
@pytest.mark.parametrize('container', ['body', 'nested', 'cell'])
@pytest.mark.parametrize('format', ['html', 'epub', 'docx'])
@pytest.mark.parametrize('compare', [False, True])
def test_list_kind_review_preserves_items_markers_and_both_decisions(tmp_path, numbered, container, format, compare):
    project = fixture(numbered, container); source = project['book']['chapters'][0]['document']
    if compare:
        source = compare_documents(review_document(source, 'original'), review_document(source, 'final'), STAMP['author'], STAMP['date'])
        project['book']['chapters'][0]['document'] = source
    restored = import_document(Path(build_export(project, format, tmp_path)['path']))['document']
    assert len(revision_summary(restored)) == 1
    for view in ('original', 'final'):
        a, b = review_document(restored, view), review_document(source, view)
        assert document_text(a) == document_text(b)
        assert appearance(a) == appearance(b)


@pytest.mark.parametrize('numbered', [False, True])
@pytest.mark.parametrize('container', ['body', 'nested', 'cell'])
@pytest.mark.parametrize('compare', [False, True])
def test_native_conversion_keeps_dependent_continued_numbering(tmp_path, numbered, container, compare):
    project = fixture(numbered, container, True); source = project['book']['chapters'][0]['document']
    if compare:
        source = compare_documents(review_document(source, 'original'), review_document(source, 'final'), STAMP['author'], STAMP['date'])
        project['book']['chapters'][0]['document'] = source
    restored = import_document(Path(build_export(project, 'docx', tmp_path)['path']))['document']
    assert len(revision_summary(restored)) == 1
    for view in ('original', 'final'):
        assert appearance(review_document(restored, view)) == appearance(review_document(source, view))


@pytest.mark.parametrize('numbered', [False, True])
def test_combining_list_conversion_with_independent_wording_retains_both_reviews(numbered):
    from alder.document_combination import combine_documents
    a = fixture(numbered)['book']['chapters'][0]['document']; base = review_document(a,'original')
    revised = deepcopy(base); revised['content'][1]['content'][1]['content'][0]['content'][0]['text'] = 'Revised second item'
    b = compare_documents(base, revised, 'Second reviewer', STAMP['date'])
    result = combine_documents(a,b)
    assert not result['conflicts'] and len(revision_summary(result['document'])) == 2
    assert appearance(review_document(result['document'],'original')) == appearance(base)
    final = review_document(result['document'],'final')
    assert 'Revised second item' in document_text(final)
    assert appearance(final) == appearance(review_document(a,'final'))
