from copy import deepcopy
from pathlib import Path
import pytest
from alder.models import create_project, validate_project
from alder.document_revisions import review_document, revision_summary
from alder.publishing import build_export, import_document

STAMP = {'id': 'item-split', 'author': 'Writer', 'date': '2026-11-04T01:00:00Z'}


def paragraph(text, **attrs):
    return {'type': 'paragraph', 'attrs': attrs, 'content': [{'type': 'text', 'text': text}]}


def fixture(container='body', comments=False, outline=False, join=False, formatted=False):
    first = paragraph('First', blockId='first')
    first['content'].append({'type': 'revision_break', 'attrs': {'kind': 'insertion', 'scope': 'item', 'stamp': STAMP, 'nextId': 'right'}})
    listing = {'type': 'ordered_list', 'attrs': {'order': 3}, 'content': [
        {'type': 'list_item', 'content': [first]},
        {'type': 'list_item', 'content': [paragraph(' words', blockId='right'), paragraph('Continuation'), {'type': 'bullet_list', 'content': [{'type': 'list_item', 'content': [paragraph('Nested')]}]}]},
        {'type': 'list_item', 'content': [paragraph('Last item')]},
    ]}
    if container == 'continuation':
        listing['content'][0]['content'].insert(0, paragraph('Item introduction'))
    if formatted:
        listing['content'][1]['content'][0]['attrs'].update(leftIndent=11, rightIndent=7, firstLineIndent=3, align='justify')
    if outline:
        from test_outline_lists import template
        listing['attrs']['listTemplate'] = template()
        listing['content'][1]['content'][-1]['type'] = 'ordered_list'
    body = listing
    if container == 'cell':
        body = {'type': 'table', 'content': [{'type': 'table_row', 'content': [{'type': 'table_cell', 'content': [listing]}]}]}
    elif container == 'nested':
        body = {'type': 'bullet_list', 'content': [{'type': 'list_item', 'content': [paragraph('Outer'), listing]}]}
        if outline:
            body.update(type='ordered_list', attrs={'order': 3, 'listTemplate': listing['attrs'].pop('listTemplate')})
    project = create_project('Item boundary', template='blank')
    project['settings'].update(documentKind='docx', includeTitle=False, includeToc=False)
    project['book'] = {'version': 1, 'chapters': [{'id': 'chapter', 'title': 'Document', 'include': True, 'document': {'type': 'doc', 'content': [body]}}]}
    if comments:
        from test_tracked_comment_moves import THREAD
        first['content'].insert(0, {'type': 'comment_anchor', 'attrs': {'threadId': 'item_comment', 'edge': 'start', 'thread': deepcopy(THREAD)}})
        listing['content'][1]['content'][1]['content'].append({'type': 'comment_anchor', 'attrs': {'threadId': 'item_comment', 'edge': 'end', 'thread': deepcopy(THREAD)}})
    if join:
        first['content'] = [n for n in first['content'] if n['type'] != 'revision_break']
        right = listing['content'].pop(1)
        right['content'][0]['content'].insert(0, {'type': 'revision_break', 'attrs': {
            'kind': 'deletion', 'scope': 'item', 'stamp': STAMP, 'nextId': 'right', 'rightType': 'list_item', 'rightAttrs': right.get('attrs', {})}})
        listing['content'][0]['content'].extend(right['content'])
    return validate_project(project)


def structure(node):
    return node['type'], node.get('text', ''), tuple(structure(child) for child in node.get('content', []))


@pytest.mark.parametrize('container', ['body', 'nested', 'cell', 'continuation'])
@pytest.mark.parametrize('format', ['html', 'epub', 'docx'])
@pytest.mark.parametrize('comments', [False, True])
@pytest.mark.parametrize('outline', [False, True])
def test_split_items_retain_both_structures_and_wording(tmp_path, container, format, comments, outline):
    project = fixture(container, comments, outline)
    before = deepcopy(project)
    source = project['book']['chapters'][0]['document']
    result = build_export(project, format, tmp_path)
    imported = import_document(Path(result['path']))['document']
    assert project == before
    assert len(revision_summary(imported)) == 1
    for view in ('original', 'final'):
        assert structure(review_document(imported, view)) == structure(review_document(source, view))
        if outline:
            from test_outline_lists import labels
            assert labels(review_document(imported, view)) == labels(review_document(source, view))


def test_item_boundary_refuses_a_separated_target_and_invalid_scope():
    from alder.document_revisions import validate_break
    source = fixture()['book']['chapters'][0]['document']
    marker = source['content'][0]['content'][0]['content'][0]['content'][-1]['attrs']
    with pytest.raises(ValueError, match='Invalid tracked item'):
        validate_break({**marker, 'scope': 'unknown'})
    source['content'][0]['content'][1]['content'][0]['attrs']['blockId'] = 'different'
    with pytest.raises(ValueError, match='moved apart'):
        review_document(source, 'original')
    source = fixture()['book']['chapters'][0]['document']
    outside = {'type': 'doc', 'content': [source['content'][0]['content'][0]['content'][0]]}
    with pytest.raises(ValueError, match='outside its list'):
        review_document(outside, 'original')


@pytest.mark.parametrize('container', ['body', 'nested', 'cell', 'continuation'])
@pytest.mark.parametrize('format', ['html', 'epub', 'docx'])
@pytest.mark.parametrize('outline', [False, True])
def test_joined_items_retain_both_structures_comments_and_numbering(tmp_path, container, format, outline):
    project = fixture(container, comments=True, outline=outline, join=True)
    source = project['book']['chapters'][0]['document']; before = deepcopy(project)
    imported = import_document(Path(build_export(project, format, tmp_path)['path']))['document']
    assert project == before
    assert len(revision_summary(imported)) == 1
    for view in ('original', 'final'):
        assert structure(review_document(imported, view)) == structure(review_document(source, view))
        if outline:
            from test_outline_lists import labels
            assert labels(review_document(imported, view)) == labels(review_document(source, view))


@pytest.mark.parametrize('outline', [False, True])
def test_joined_item_retains_authored_paragraph_indentation(tmp_path, outline):
    from alder.document_comments import walk
    project = fixture(outline=outline, join=True, formatted=True)
    source = project['book']['chapters'][0]['document']
    restored = import_document(Path(build_export(project, 'docx', tmp_path)['path']))['document']
    for view in ('original', 'final'):
        a = next(n for n in walk(review_document(restored, view)) if n['type'] == 'paragraph' and any(c.get('text') == ' words' for c in n.get('content', [])))
        b = next(n for n in walk(review_document(source, view)) if n['type'] == 'paragraph' and n.get('attrs', {}).get('blockId') == 'right')
        for key in ('leftIndent', 'rightIndent', 'firstLineIndent', 'align'):
            assert a['attrs'][key] == b['attrs'][key]


@pytest.mark.parametrize('join', [False, True])
@pytest.mark.parametrize('container', ['body', 'nested', 'cell', 'continuation'])
@pytest.mark.parametrize('format', ['html', 'epub', 'docx'])
def test_comparison_recognises_item_boundary_and_maps_spanning_comments(tmp_path, join, container, format):
    from alder.document_comparison import compare_documents, canonical
    from alder.comparison_comments import extract_comments
    project = fixture(container, comments=True, outline=True, join=join)
    pending = project['book']['chapters'][0]['document']
    original, final = review_document(pending, 'original'), review_document(pending, 'final')
    before = deepcopy((original, final))
    result = compare_documents(original, final, author='Reader', date=STAMP['date'])
    assert (original, final) == before
    assert len(revision_summary(result)) == 1
    project['book']['chapters'][0]['document'] = result
    restored = import_document(Path(build_export(project, format, tmp_path)['path']))['document']
    for view, expected in [('original', original), ('final', final)]:
        a, threads, _ = extract_comments(review_document(result, view), recursive=True)
        b, expected_threads, _ = extract_comments(expected, recursive=True)
        assert canonical(a) == canonical(b)
        assert list(threads.values()) == list(expected_threads.values())
        assert structure(review_document(restored, view)) == structure(review_document(result, view))


@pytest.mark.parametrize('damage', ['level', 'before-indent', 'after-alignment'])
def test_item_join_cannot_hide_independent_native_formatting(tmp_path, damage):
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    path = Path(build_export(fixture(join=True), 'docx', tmp_path)['path'])
    doc = Document(path)
    props = next(p._p.pPr for p in doc.paragraphs if p._p.pPr is not None and p._p.pPr.find(qn('w:pPrChange')) is not None)
    old = props.find(qn('w:pPrChange')).find(qn('w:pPr'))
    if damage == 'level': old.find(qn('w:numPr')).find(qn('w:ilvl')).set(qn('w:val'), '2')
    elif damage == 'before-indent': old.find(qn('w:ind')).set(qn('w:left'), '500')
    else:
        value = OxmlElement('w:jc'); value.set(qn('w:val'), 'right'); props.append(value)
    doc.save(path)
    with pytest.raises(ValueError, match='independent or incomplete'):
        import_document(path)


@pytest.mark.parametrize('damage', ['author', 'before-indent'])
def test_continuation_split_cannot_hide_independent_native_formatting(tmp_path, damage):
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    path = Path(build_export(fixture('continuation'), 'docx', tmp_path)['path'])
    doc = Document(path)
    props = next(p._p.pPr for p in doc.paragraphs if p._p.pPr is not None and p._p.pPr.find(qn('w:pPrChange')) is not None)
    change = props.find(qn('w:pPrChange')); old = change.find(qn('w:pPr'))
    if damage == 'author': change.set(qn('w:author'), 'Another reviewer')
    elif damage == 'after-alignment':
        value = OxmlElement('w:jc'); value.set(qn('w:val'), 'right'); props.append(value)
    else:
        target = old if damage == 'before-indent' else props
        target.find(qn('w:ind')).set(qn('w:left'), '1234')
    doc.save(path)
    with pytest.raises(ValueError, match='independent or incomplete'):
        import_document(path)


@pytest.mark.parametrize('container', ['body', 'nested', 'cell', 'continuation'])
@pytest.mark.parametrize('outline', [False, True])
def test_new_item_paragraph_retains_its_own_appearance_until_split_is_rejected(tmp_path, container, outline):
    project=fixture(container,outline=outline,formatted=True)
    source=project['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(project,'docx',tmp_path)['path']))['document']
    from alder.document_comments import walk
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        a,b=review_document(restored,view),review_document(source,view)
        assert structure(a)==structure(b)
        for actual,expected in zip([n for n in walk(a) if n['type']=='paragraph'],[n for n in walk(b) if n['type']=='paragraph']):
            for key in ('leftIndent','rightIndent','firstLineIndent'):
                assert (actual.get('attrs',{}).get(key) or 0)==pytest.approx(expected.get('attrs',{}).get(key) or 0,abs=.051)
            assert (actual.get('attrs',{}).get('align') or 'left')==(expected.get('attrs',{}).get('align') or 'left')
