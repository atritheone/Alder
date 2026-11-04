from copy import deepcopy
from pathlib import Path
import pytest
from alder.models import validate_project, document_text
from alder.publishing import build_export, import_document
from alder.document_revisions import review_document, revision_summary
from test_tracked_table_rows import fixture as row_fixture


def fixture(kind='insertion'):
    project = row_fixture()
    rows = project['book']['chapters'][0]['document']['content'][0]['content']
    rows[1]['attrs'].pop('revisionBlock')
    for r, row in enumerate(rows):
        cell = deepcopy(row['content'][0])
        cell['attrs'].update(blockId=f'column_{r}', revisionBlock={
            'kind': kind, 'originalId': f'column_{r}', 'part': r, 'count': len(rows),
            'stamp': {'id': 'column_change', 'author': 'Reviewer', 'date': '2026-11-04T00:00:00Z'}})
        cell['content'][0]['content'][0]['text'] = f'Changed {r}'
        row['content'].insert(1, cell)
    return validate_project(project)


@pytest.mark.parametrize('kind', ['insertion', 'deletion'])
@pytest.mark.parametrize('format', ['html', 'epub'])
def test_column_exchange_retains_one_decision_and_both_grids(tmp_path, kind, format):
    project = fixture(kind)
    source = project['book']['chapters'][0]['document']
    restored = import_document(Path(build_export(project, format, tmp_path)['path']))['document']
    assert len(revision_summary(restored)) == 1
    for view in ('original', 'final'):
        actual = review_document(restored, view)
        assert document_text(actual) == document_text(review_document(source, view))
        for row in actual['content'][0]['content']:
            assert len(row['content']) == (3 if (view == 'final') == (kind == 'insertion') else 2)
            for cell in row['content']:
                assert cell['attrs']['colwidth'] == [150]
                assert cell['attrs']['background'] == '#ddeeff'
                assert cell['attrs']['verticalAlign'] == 'bottom'
                assert cell['content'][0]['content'][0]['marks'] == [{'type': 'strong'}]


@pytest.mark.parametrize('damage', ['missing', 'position', 'author', 'part', 'merge', 'all', 'table_review', 'partial_bookmark'])
def test_column_review_refuses_incomplete_or_ambiguous_groups(damage):
    project = fixture()
    table = project['book']['chapters'][0]['document']['content'][0]
    rows = table['content']
    cell = rows[1]['content'][1]
    if damage == 'missing': cell['attrs'].pop('revisionBlock')
    elif damage == 'position': rows[1]['content'][0], rows[1]['content'][1] = rows[1]['content'][1], rows[1]['content'][0]
    elif damage == 'author': cell['attrs']['revisionBlock']['stamp']['author'] = 'Another reviewer'
    elif damage == 'part': cell['attrs']['revisionBlock']['part'] = 0
    elif damage == 'merge': rows[0]['content'][0]['attrs']['rowspan'] = 2
    elif damage == 'all':
        for row in rows: row['content'] = [row['content'][1]]
    elif damage == 'table_review': table['attrs']['revisionBlock'] = deepcopy(cell['attrs']['revisionBlock'])
    else: cell['content'][0]['content'].append({'type': 'bookmark', 'attrs': {'blockId': 'partial', 'name': 'Partial', 'range': True}})
    with pytest.raises(ValueError): validate_project(project)


@pytest.mark.parametrize('kind', ['insertion', 'deletion'])
def test_word_pending_column_export_refuses_before_losing_original_geometry(tmp_path, kind):
    project = fixture(kind)
    with pytest.raises(ValueError, match='column changes'): build_export(project, 'docx', tmp_path)
    for view in ('original', 'final'):
        resolved = deepcopy(project)
        resolved['book']['chapters'][0]['document'] = review_document(project['book']['chapters'][0]['document'], view)
        assert Path(build_export(resolved, 'docx', tmp_path)['path']).exists()


@pytest.mark.parametrize('kind', ['insertion', 'deletion'])
@pytest.mark.parametrize('position', [0, 1, 2])
@pytest.mark.parametrize('count', [1, 2])
def test_comparison_groups_complete_column_bands(kind, position, count):
    from alder.document_comparison import compare_documents, canonical
    source = review_document(fixture()['book']['chapters'][0]['document'], 'original')
    longer = deepcopy(source)
    for r, row in enumerate(longer['content'][0]['content']):
        extra = []
        for c in range(count):
            cell = deepcopy(row['content'][0]); cell['attrs'].pop('blockId', None)
            cell['content'][0]['content'][0]['text'] = f'Added {r} {c}'
            extra.append(cell)
        row['content'][position:position] = extra
    before, after = (source, longer) if kind == 'insertion' else (longer, source)
    snapshots = deepcopy((before, after))
    actual = compare_documents(before, after, 'Reviewer', '2026-11-04T00:00:00Z')
    assert (before, after) == snapshots
    assert len(revision_summary(actual)) == 1
    assert canonical(review_document(actual, 'original')) == canonical(before)
    assert canonical(review_document(actual, 'final')) == canonical(after)


def test_same_column_identity_cannot_span_tables():
    project = fixture()
    doc = project['book']['chapters'][0]['document']
    copy = deepcopy(doc['content'][0]); doc['content'].append(copy)
    for r, row in enumerate(copy['content']):
        change = row['content'][1]['attrs']['revisionBlock']
        change['part'] += 3
    for table in doc['content']:
        for row in table['content']: row['content'][1]['attrs']['revisionBlock']['count'] = 6
    with pytest.raises(ValueError, match='one table'): validate_project(project)


@pytest.mark.parametrize('kind', ['insertion', 'deletion'])
def test_comparison_keeps_comments_on_changed_and_surviving_cells(kind):
    from alder.document_comparison import compare_documents
    from test_document_comparison import commented, threads
    shorter = review_document(fixture()['book']['chapters'][0]['document'], 'original')
    longer = review_document(fixture()['book']['chapters'][0]['document'], 'final')
    for document, column in ((shorter, 1), (longer, 2)):
        document['content'][0]['content'][0]['content'][column]['content'] = [commented('Right words', 'right')]
    longer['content'][0]['content'][1]['content'][1]['content'] = [commented('Added words', 'added')]
    before, after = (shorter, longer) if kind == 'insertion' else (longer, shorter)
    actual = compare_documents(before, after, 'Reviewer', '2026-11-04T00:00:00Z')
    assert len(revision_summary(actual)) == 1
    for view, expected in (('original', before), ('final', after)):
        result = review_document(actual, view)
        assert document_text(result) == document_text(expected)
        assert len(threads(result)) == len(threads(expected))


def test_comparison_does_not_guess_duplicate_column_ownership():
    from alder.document_comparison import compare_documents
    shorter = review_document(fixture()['book']['chapters'][0]['document'], 'original')
    longer = deepcopy(shorter)
    for row in longer['content'][0]['content']: row['content'].insert(1, deepcopy(row['content'][0]))
    before = deepcopy((shorter, longer))
    with pytest.raises(ValueError): compare_documents(shorter, longer, 'Reviewer', '')
    assert (shorter, longer) == before


@pytest.mark.parametrize('format', ['html', 'epub'])
def test_nested_column_reviews_keep_headers_objects_and_complete_bookmarks(tmp_path, format):
    from test_equations import equation
    project = fixture('deletion')
    source = project['book']['chapters'][0]['document']
    inner = source['content'][0]
    for cell in inner['content'][0]['content']: cell['type'] = 'table_header'
    paragraph = inner['content'][1]['content'][1]['content'][0]
    paragraph['content'] = [
        {'type': 'bookmark', 'attrs': {'blockId': 'marked', 'name': 'Column_passage', 'range': True}},
        *paragraph['content'],
        {'type': 'bookmark_end', 'attrs': {'targetId': 'marked'}},
        equation('<msup><mi>x</mi><mn>2</mn></msup>'),
    ]
    paragraph['content'][-1]['attrs']['latex'] = 'x^2'
    source['content'] = [{'type': 'table', 'content': [{'type': 'table_row', 'content': [
        {'type': 'table_cell', 'content': [{'type': 'paragraph', 'content': [{'type': 'text', 'text': 'Outer'}]}, inner]}
    ]}]}]
    project = validate_project(project)
    restored = import_document(Path(build_export(project, format, tmp_path)['path']))['document']
    from alder.document_comparison import canonical
    for view in ('original', 'final'):
        # Exchange may materialise default formatting, but authored objects,
        # header-cell types and both exact review grids must remain intact.
        expected = review_document(project['book']['chapters'][0]['document'], view)
        actual = review_document(restored, view)
        assert document_text(actual) == document_text(expected)
        inner_actual = actual['content'][0]['content'][0]['content'][0]['content'][1]
        inner_expected = expected['content'][0]['content'][0]['content'][0]['content'][1]
        def grid(table):
            return [[(cell['type'], cell['attrs']['colwidth'], cell['attrs']['background'], cell['attrs']['verticalAlign'])
                     for cell in row['content']] for row in table['content']]
        assert grid(inner_actual) == grid(inner_expected)
        def objects(node):
            from alder.document_comments import walk
            nodes = [n for n in walk(node) if n['type'] in ('equation', 'bookmark', 'bookmark_end')]
            targets = {n['attrs']['blockId']: n['attrs']['name'] for n in nodes if n['type'] == 'bookmark'}
            result = [canonical(n) for n in nodes]
            for n in result:
                if n['type'] == 'bookmark_end':
                    assert n['attrs']['targetId'] in targets
                    n['attrs']['targetId'] = targets[n['attrs']['targetId']]
            return result
        assert objects(inner_actual) == objects(inner_expected)
