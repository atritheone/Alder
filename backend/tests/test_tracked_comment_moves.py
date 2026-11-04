from copy import deepcopy
from pathlib import Path
import pytest
from alder.models import validate_project, document_text
from alder.document_revisions import review_document
from alder.document_comments import walk
from alder.publishing import build_export, import_document
from test_tracked_table_moves import fixture as table_fixture
from test_tracked_list_moves import fixed_fixture as list_fixture
from test_tracked_table_rows import fixture as row_fixture, grouped_fixture

THREAD = {'resolved': True, 'entries': [
    {'id': 'first', 'author': 'Reader', 'text': 'Check this passage.', 'date': ''},
    {'id': 'reply', 'author': 'Editor', 'text': 'Confirmed.', 'date': ''},
]}

def fixture(container):
    project = table_fixture() if container == 'table' else list_fixture()
    for root in project['book']['chapters'][0]['document']['content']:
        if root['type'] != container or not root.get('attrs', {}).get('revisionMove'): continue
        paragraphs = [n for n in walk(root) if n['type'] == 'paragraph']
        ghost = root['attrs']['revisionMove']['kind'] == 'deletion'
        for paragraph, edge in ((paragraphs[0], 'start'), (paragraphs[-1], 'end')):
            anchor = {'type': 'comment_anchor', 'attrs': {'blockId': edge + ('_ghost' if ghost else ''), 'threadId': 'thread', 'edge': edge, 'thread': deepcopy(THREAD)}}
            paragraph.setdefault('content', []).insert(0 if edge == 'start' else len(paragraph['content']), anchor)
    return validate_project(project)

@pytest.mark.parametrize('container', ['table', 'ordered_list'])
@pytest.mark.parametrize('format', ['html', 'epub', 'docx'])
def test_moved_comments_retain_threads_and_both_anchored_outcomes(tmp_path, container, format):
    project = fixture(container); source = project['book']['chapters'][0]['document']
    for view in ('original', 'final'):
        result = build_export(project, format, tmp_path)
        restored = review_document(import_document(Path(result['path']))['document'], view)
        anchors = [n['attrs'] for n in walk(restored) if n['type'] == 'comment_anchor']
        assert [a['edge'] for a in anchors] == ['start', 'end']
        assert anchors[0]['threadId'] == anchors[1]['threadId']
        assert anchors[0]['thread'] == anchors[1]['thread']
        assert anchors[0]['thread']['resolved']
        assert [e['text'] for e in anchors[0]['thread']['entries']] == ['Check this passage.', 'Confirmed.']
        assert document_text(restored) == document_text(review_document(source, view))

@pytest.mark.parametrize('container', ['table', 'ordered_list'])
def test_copied_chapters_get_one_independent_thread_for_both_sides(container):
    project = fixture(container)
    copy = deepcopy(project['book']['chapters'][0]); copy['id'] = 'copied'; project['book']['chapters'].append(copy)
    restored = validate_project(project)
    identities = []
    for chapter in restored['book']['chapters']:
        ids = {n['attrs']['threadId'] for n in walk(chapter['document']) if n['type'] == 'comment_anchor'}
        assert len(ids) == 1; identities.append(ids)
    assert identities[0] != identities[1]

@pytest.mark.parametrize('damage', ['missing_end', 'different_thread', 'different_reply'])
def test_partial_or_divergent_moved_comment_is_refused(damage):
    project = fixture('table'); doc = project['book']['chapters'][0]['document']
    source = next(n for n in doc['content'] if n['type'] == 'table')
    anchors = [n for n in walk(source) if n['type'] == 'comment_anchor']
    if damage == 'missing_end':
        for n in walk(source): n['content'] = [c for c in n.get('content', []) if c is not anchors[-1]]
    elif damage == 'different_thread':
        for n in anchors: n['attrs']['threadId'] = 'different'
    else:
        for n in anchors: n['attrs']['thread']['entries'][0]['text'] = 'Changed only in source'
    with pytest.raises(ValueError): validate_project(project)


def test_native_move_comment_mirroring_splits_formatted_runs_without_losing_text():
    from alder.document_comments import mirror_word_move_comments
    stamp = {'id': 'move', 'author': 'Reader', 'date': '', 'move': True}
    def para(kind, content):
        return {'type': 'paragraph', 'attrs': {'revisionMove': {'kind': kind, 'stamp': stamp, 'originalId': 'p'}}, 'content': content}
    def text(value): return {'type': 'text', 'text': value, 'marks': [{'type': 'strong'}]}
    def anchor(edge): return {'type': 'comment_anchor', 'attrs': {'threadId': 'thread', 'edge': edge, 'thread': deepcopy(THREAD)}}
    document = {'type': 'doc', 'content': [para('deletion', [text('Before selected after.')]),
        para('insertion', [text('Before '), anchor('start'), text('selected'), anchor('end'), text(' after.')])]}
    mirror_word_move_comments(document)
    assert ''.join(n.get('text', '') for n in document['content'][0]['content']) == 'Before selected after.'
    assert [n.get('text') or n['attrs']['edge'] for n in document['content'][0]['content']] == ['Before ', 'start', 'selected', 'end', ' after.']
    assert all(n.get('marks') == [{'type': 'strong'}] for n in document['content'][0]['content'] if n['type'] == 'text')


def commented_rows(kind='deletion', grouped=False):
    project = grouped_fixture(kind) if grouped else row_fixture(kind)
    rows = project['book']['chapters'][0]['document']['content'][0]['content']
    for paragraph,edge in ((rows[1]['content'][0]['content'][0],'start'), (rows[2 if grouped else 1]['content'][-1]['content'][0],'end')):
        paragraph['content'].insert(0 if edge=='start' else len(paragraph['content']), {'type':'comment_anchor','attrs':{'threadId':'thread','edge':edge,'thread':deepcopy(THREAD)}})
    return validate_project(project)


@pytest.mark.parametrize('kind', ['insertion', 'deletion'])
@pytest.mark.parametrize('grouped', [False, True])
@pytest.mark.parametrize('format', ['html', 'epub', 'docx'])
def test_row_review_keeps_complete_comments_only_in_the_surviving_view(tmp_path, kind, grouped, format):
    project = commented_rows(kind, grouped)
    restored = import_document(Path(build_export(project, format, tmp_path)['path']))['document']
    for view in ('original', 'final'):
        anchors = [n for n in walk(review_document(restored,view)) if n['type']=='comment_anchor']
        survives = (kind=='insertion') == (view=='final')
        assert len(anchors) == (2 if survives else 0)
        if survives:
            assert [a['attrs']['edge'] for a in anchors] == ['start','end']
            assert [e['text'] for e in anchors[0]['attrs']['thread']['entries']] == ['Check this passage.', 'Confirmed.']


def test_row_anchor_dependency_reunites_word_split_ids(tmp_path):
    from docx import Document
    from docx.oxml.ns import qn
    project = commented_rows('deletion', True)
    path = Path(build_export(project, 'docx', tmp_path)['path']); word = Document(path)
    for index,row in enumerate(word.tables[0].rows[1:3]): row._tr.trPr.find(qn('w:del')).set(qn('w:id'), str(100+index))
    word.save(path)
    restored = import_document(path)['document']; rows=restored['content'][0]['content'][1:3]
    assert rows[0]['attrs']['revisionBlock']['stamp']['id'] == rows[1]['attrs']['revisionBlock']['stamp']['id']
    assert [row['attrs']['revisionBlock']['part'] for row in rows] == [0,1]
