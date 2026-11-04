from copy import deepcopy
from pathlib import Path
import pytest
from alder.models import create_project, validate_project, document_text
from alder.document_comparison import compare_documents, canonical
from alder.document_combination import combine_documents
from alder.document_revisions import review_document, revision_summary
from alder.document_comments import walk
from alder.comparison_comments import extract_comments
from alder.publishing import build_export, import_document
from test_tracked_comment_moves import THREAD

DATE = '2026-11-04T01:00:00Z'
def paragraph(text): return {'type': 'paragraph', 'content': [{'type': 'text', 'text': text}]}
def thread_values(threads):
    return [{'edges': item['edges'], 'thread': {**item['thread'], 'entries': [{k: v for k, v in entry.items() if k != 'id'} for entry in item['thread']['entries']]}} for item in threads.values()]


def fixture(kind='list', comments=True, conflict=False):
    def item(text): return {'type': 'list_item', 'content': [paragraph(text)]}
    listing = {'type': 'ordered_list', 'attrs': {'order': 3}, 'content': [item('First wording tail'), item('Repeated wording tail'), item('Repeated wording tail')]}
    if kind == 'list': body = listing
    else:
        cell = lambda content: {'type': 'table_cell', 'content': content}
        body = {'type': 'table', 'content': [
            {'type': 'table_row', 'content': [cell([paragraph('First wording tail')]), cell([paragraph('Repeated wording tail')])]},
            {'type': 'table_row', 'content': [cell([paragraph('Repeated wording tail')]), cell([listing] if kind == 'nested' else [paragraph('Last wording tail')])]},
        ]}
    base = {'type': 'doc', 'content': [paragraph('Anchor'), body]}
    a, b = deepcopy(base), deepcopy(base)
    get = lambda doc: [n for n in walk(doc['content'][1]) if n['type'] == 'paragraph']
    get(a)[0]['content'][0]['text'] = 'First revised wording tail'
    get(b)[0 if conflict else -1]['content'][0]['text'] = 'Different revised wording tail' if conflict else 'Last revised wording tail'
    a = compare_documents(base, a, 'Alice', DATE); b = compare_documents(base, b, 'Bob', DATE)
    if comments:
        for doc, edge_index, name in ((a, 0, 'first_comment'), (b, -1, 'last_comment')):
            p = get(doc)[edge_index]
            p['content'].insert(0, {'type': 'comment_anchor', 'attrs': {'threadId': name, 'edge': 'start', 'thread': deepcopy(THREAD)}})
            p['content'].append({'type': 'comment_anchor', 'attrs': {'threadId': name, 'edge': 'end', 'thread': deepcopy(THREAD)}})
    return base, a, b


@pytest.mark.parametrize('kind', ['list', 'table', 'nested'])
@pytest.mark.parametrize('format', ['html', 'epub', 'docx'])
def test_independent_edits_in_one_structure_merge_with_exact_comment_paths(tmp_path, kind, format):
    base, a, b = fixture(kind); before = deepcopy((a, b))
    result = combine_documents(a, b)
    assert not result['conflicts'] and result['reanchoredComments'] == 0
    assert (a, b) == before
    assert {r['author'] for r in revision_summary(result['document'])} == {'Alice', 'Bob'}
    plain, threads, _ = extract_comments(result['document'], recursive=True)
    for side in (a, b):
        _, expected, _ = extract_comments(side, recursive=True)
        for thread in expected.values(): assert thread in threads.values()
    assert canonical(review_document(plain, 'original')) == canonical(base)
    final = document_text(review_document(result['document'], 'final'))
    assert 'First revised wording tail' in final and 'Last revised wording tail' in final
    project = create_project(template='blank'); project['settings'].update(documentKind='docx', includeTitle=False)
    project['book'] = {'version': 1, 'chapters': [{'id': 'chapter', 'title': 'Combined', 'include': True, 'document': result['document']}]}
    project = validate_project(project)
    restored = import_document(Path(build_export(project, format, tmp_path)['path']))['document']
    for view in ('original', 'final'):
        actual, comments, _ = extract_comments(review_document(restored, view), recursive=True)
        expected, expected_comments, _ = extract_comments(review_document(result['document'], view), recursive=True)
        assert document_text(actual) == document_text(expected)
        assert thread_values(comments) == thread_values(expected_comments)


@pytest.mark.parametrize('kind', ['list', 'table', 'nested'])
def test_conflicting_nested_wording_retains_comments_from_both_reviewers(kind):
    base, a, b = fixture(kind, conflict=True)
    result = combine_documents(a, b)
    assert len(result['conflicts']) == 1
    for side, source in [('original', a), ('revised', b)]:
        chosen = combine_documents(a, b, {result['conflicts'][0]['id']: side})['document']
        assert document_text(review_document(chosen, 'final')) == document_text(review_document(source, 'final'))
        _, threads, _ = extract_comments(chosen, recursive=True)
        assert len(threads) == 2
        plain, _, _ = extract_comments(review_document(chosen, 'original'), recursive=True)
        assert canonical(plain) == canonical(base)


@pytest.mark.parametrize('kind', ['list', 'table', 'nested'])
def test_container_formatting_merges_with_independent_descendant_edits(kind):
    base, _, b = fixture(kind, comments=False)
    after = deepcopy(base)
    after['content'][1].setdefault('attrs', {})['listStyle' if kind == 'list' else 'align'] = 'upper-roman' if kind == 'list' else 'right'
    a = compare_documents(base, after, 'Alice', DATE)
    result = combine_documents(a, b)
    assert not result['conflicts']
    assert canonical(review_document(result['document'], 'original')) == canonical(base)
    final = review_document(result['document'], 'final')
    assert final['content'][1]['attrs']['listStyle' if kind == 'list' else 'align'] == ('upper-roman' if kind == 'list' else 'right')
    assert 'Last revised wording tail' in document_text(final)
    assert {r['author'] for r in revision_summary(result['document'])} == {'Alice', 'Bob'}


def test_disjoint_properties_on_the_same_cell_merge_without_overwriting_either():
    base, _, _ = fixture('table', comments=False)
    left, right = deepcopy(base), deepcopy(base)
    left['content'][1]['content'][0]['content'][0]['attrs'] = {'background': '#ffff00'}
    right['content'][1]['content'][0]['content'][0]['attrs'] = {'verticalAlign': 'bottom'}
    a, b = [compare_documents(base, revised, author, DATE) for revised, author in [(left, 'Alice'), (right, 'Bob')]]
    result = combine_documents(a, b)
    assert not result['conflicts']
    final = review_document(result['document'], 'final')['content'][1]['content'][0]['content'][0]['attrs']
    assert final['background'] == '#ffff00' and final['verticalAlign'] == 'bottom'
    assert canonical(review_document(result['document'], 'original')) == canonical(base)


def moved_fixture(kind):
    from test_tracked_comment_moves import fixture as block_fixture
    from test_tracked_item_moves import fixture as item_fixture
    from test_tracked_row_moves import fixture as row_fixture
    project = item_fixture(comments=True) if kind == 'item' else row_fixture(comments=True) if kind == 'row' else block_fixture(kind)
    a = project['book']['chapters'][0]['document']
    a['content'].insert(0, paragraph('Anchor'))
    base = review_document(a, 'original')
    after = deepcopy(base); after['content'][0]['content'][0]['text'] = 'Revised Anchor'
    b = compare_documents(base, after, 'Other reviewer', DATE)
    # These are copies of one review, so their existing comment keeps its ID.
    # Compare documents intentionally creates fresh output identities.
    for n in walk(b):
        if n['type'] == 'comment_anchor': n['attrs']['threadId'] = 'thread'
    return base, a, b


@pytest.mark.parametrize('kind', ['ordered_list', 'table', 'item', 'row'])
@pytest.mark.parametrize('format', ['html', 'epub', 'docx'])
def test_combining_commented_moves_keeps_one_live_thread_and_both_outcomes(tmp_path, kind, format):
    base, a, b = moved_fixture(kind); snapshots = deepcopy((a, b))
    result = combine_documents(a, b)
    assert not result['conflicts'] and result['reanchoredComments'] == 0
    assert (a, b) == snapshots
    project = create_project(template='blank'); project['settings'].update(documentKind='docx', includeTitle=False)
    project['book'] = {'version': 1, 'chapters': [{'id': 'main', 'title': 'Text', 'include': True, 'document': result['document']}]}
    project = validate_project(project)
    restored = import_document(Path(build_export(project, format, tmp_path)['path']))['document']
    for source in (result['document'], restored):
        _, live, _ = extract_comments(source, recursive=True, live_moves=True)
        assert len(live) == 1
        for view in ('original', 'final'):
            actual, comments, _ = extract_comments(review_document(source, view), recursive=True)
            expected = deepcopy(review_document(a, view))
            if view == 'final': expected['content'][0]['content'][0]['text'] = 'Revised Anchor'
            expected, expected_comments, _ = extract_comments(expected, recursive=True)
            assert document_text(actual) == document_text(expected)
            assert thread_values(comments) == thread_values(expected_comments)


@pytest.mark.parametrize('kind', ['ordered_list', 'table', 'item', 'row'])
def test_combining_moved_comments_merges_replies_into_both_paired_copies(kind):
    _, a, b = moved_fixture(kind)
    for n in walk(b):
        if n['type'] == 'comment_anchor':
            n['attrs']['thread']['resolved'] = False
            n['attrs']['thread']['entries'].append({'id': 'new_reply', 'author': 'Other reviewer', 'date': DATE, 'text': 'Please check again.'})
    result = combine_documents(a, b)['document']
    anchors = [n['attrs'] for n in walk(result) if n['type'] == 'comment_anchor']
    assert len(anchors) == 4
    assert all(n['thread'] == anchors[0]['thread'] for n in anchors)
    assert not anchors[0]['thread']['resolved'] and len(anchors[0]['thread']['entries']) == 3


def conflict_fixture(kind='nested', comments=False):
    base, a, _ = fixture(kind, comments=False)
    other = deepcopy(base)
    paragraphs = [n for n in walk(other['content'][1]) if n['type'] == 'paragraph']
    paragraphs[0]['content'][0]['text'] = 'Conflicting first wording tail'
    paragraphs[-1]['content'][0]['text'] = 'Independent last wording tail'
    b = compare_documents(base, other, 'Bob', DATE)
    if comments:
        for doc, index, name in ((a, 0, 'first_comment'), (b, -1, 'last_comment')):
            p = [n for n in walk(doc['content'][1]) if n['type'] == 'paragraph'][index]
            for edge in ('start', 'end'):
                p['content'].insert(0 if edge == 'start' else len(p['content']), {'type': 'comment_anchor', 'attrs': {'threadId': name, 'edge': edge, 'thread': deepcopy(THREAD)}})
    return base, a, b


@pytest.mark.parametrize('kind', ['list', 'table', 'nested'])
def test_nested_conflict_choices_preserve_independent_changes_in_other_children(kind):
    base, a, b = conflict_fixture(kind)
    preview = combine_documents(a, b)
    assert len(preview['conflicts']) == 1
    key = preview['conflicts'][0]['id']
    assert 'Independent' not in preview['conflicts'][0]['revised']
    assert preview['conflicts'][0]['location'] == ('list 1, item 1, paragraph 1' if kind == 'list' else 'table 1, row 1, cell 1, paragraph 1')
    for side in ('original', 'revised'):
        result = combine_documents(a, b, {key: side})
        assert result['conflicts'][0]['id'] == key and result['conflicts'][0]['choice'] == side
        assert canonical(review_document(result['document'], 'original')) == canonical(base)
        final = document_text(review_document(result['document'], 'final'))
        assert 'Independent last wording tail' in final
        assert ('First revised wording tail' if side == 'original' else 'Conflicting first wording tail') in final
        assert len(revision_summary(result['document'])) == 2


def test_multiple_nested_conflicts_have_stable_separate_choices():
    base, a, b = conflict_fixture('nested')
    after = review_document(a, 'final')
    [n for n in walk(after['content'][1]) if n['type'] == 'paragraph'][-1]['content'][0]['text'] = 'Alice last wording tail'
    a = compare_documents(base, after, 'Alice', DATE)
    preview = combine_documents(a, b)
    assert len(preview['conflicts']) == 2
    keys = [r['id'] for r in preview['conflicts']]; assert len(set(keys)) == 2
    result = combine_documents(a, b, {keys[0]: 'original', keys[1]: 'revised'})
    assert [r['id'] for r in result['conflicts']] == keys
    final = document_text(review_document(result['document'], 'final'))
    assert 'First revised wording tail' in final and 'Independent last wording tail' in final


def test_one_review_operation_spanning_children_is_never_split_by_conflict_choices():
    base, a, b = conflict_fixture('nested')
    records = [m['attrs'] for n in walk(b) for m in n.get('marks', []) if m['type'] in ('revision_insertion', 'revision_deletion')]
    assert len({r['id'] for r in records}) == 2
    for record in records: record['id'] = 'one_operation'
    preview = combine_documents(a, b)
    assert len(preview['conflicts']) == 1 and 'Independent' in preview['conflicts'][0]['revised']
    result = combine_documents(a, b, {preview['conflicts'][0]['id']: 'original'})
    assert canonical(review_document(result['document'], 'final')) == canonical(review_document(a, 'final'))
