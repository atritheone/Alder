from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile
import pytest
from alder.models import create_project, validate_project, document_text, ValidationError
from alder.publishing import build_export, import_document
from alder.document_comments import walk


def fixture():
    p = create_project(template='blank')
    p['settings'].update(documentKind='docx', includeTitle=False)
    thread = {'resolved': True, 'entries': [
        {'id': 'entry_one', 'author': 'First reviewer', 'text': 'Review this wording.\nSecond line.', 'date': '2026-10-29T01:02:03Z'},
        {'id': 'entry_two', 'author': 'Second reviewer', 'text': 'Agreed, now resolved.', 'date': '2026-10-29T02:03:04Z'},
    ]}
    marker = lambda edge: {'type': 'comment_anchor', 'attrs': {'threadId': 'thread_one', 'edge': edge, 'thread': deepcopy(thread)}}
    document = {'type': 'doc', 'content': [
        {'type': 'paragraph', 'content': [{'type': 'text', 'text': 'Before '}, marker('start'), {'type': 'text', 'text': 'selected'}]},
        {'type': 'paragraph', 'content': [{'type': 'text', 'text': 'passage'}, marker('end'), {'type': 'text', 'text': ' after.'}]},
    ]}
    p['book'] = {'version': 1, 'chapters': [{'id': 'chapter', 'title': 'Document', 'include': True, 'document': document}]}
    return validate_project(p)


@pytest.mark.parametrize('format', ['html', 'epub', 'docx'])
def test_comment_threads_anchors_and_resolution_survive_exchange(tmp_path, format):
    p = fixture(); before = deepcopy(p)
    result = build_export(p, format, tmp_path)
    assert p == before
    opened = import_document(Path(result['path']))
    anchors = [n['attrs'] for n in walk(opened['document']) if n['type'] == 'comment_anchor']
    assert [a['edge'] for a in anchors] == ['start', 'end']
    assert anchors[0]['threadId'] == anchors[1]['threadId']
    assert anchors[0]['thread'] == anchors[1]['thread']
    assert anchors[0]['thread']['resolved'] is True
    entries = anchors[0]['thread']['entries']
    assert [e['author'] for e in entries] == ['First reviewer', 'Second reviewer']
    assert [e['text'] for e in entries] == ['Review this wording.\nSecond line.', 'Agreed, now resolved.']
    assert 'Review this' not in document_text(opened['document'])
    assert 'Before selected\npassage after.' in document_text(opened['document'])


@pytest.mark.parametrize('format', ['txt', 'md', 'pdf'])
def test_review_text_is_not_published_as_body_text(tmp_path, format):
    result = build_export(fixture(), format, tmp_path)
    if format == 'pdf':
        from pypdf import PdfReader
        text = '\n'.join(p.extract_text() for p in PdfReader(result['path']).pages)
    else:
        text = Path(result['path']).read_text(encoding='utf-8')
    assert 'Review this' not in text and 'reviewer' not in text
    assert 'Before selected' in text
    assert any('comment' in w.lower() for w in result['warnings'])


def test_incomplete_anchors_keep_review_text_and_warn_on_word_conversion(tmp_path):
    p = fixture(); doc = p['book']['chapters'][0]['document']
    del doc['content'][0]['content'][1]
    result = build_export(p, 'docx', tmp_path)
    assert any('Incomplete comment' in w for w in result['warnings'])
    opened = import_document(Path(result['path']))
    anchors = [n for n in walk(opened['document']) if n['type'] == 'comment_anchor']
    assert len(anchors) == 2 and len(anchors[0]['attrs']['thread']['entries']) == 2


def test_comments_are_validated_and_copied_chapters_get_independent_threads():
    p = fixture(); p['book']['chapters'].append({**deepcopy(p['book']['chapters'][0]), 'id': 'copy'})
    p = validate_project(p)
    ids = [[n['attrs']['threadId'] for n in walk(c['document']) if n['type'] == 'comment_anchor'] for c in p['book']['chapters']]
    assert ids[0][0] != ids[1][0] and all(pair[0] == pair[1] for pair in ids)
    anchor = next(n for n in walk(p['book']['chapters'][0]['document']) if n['type'] == 'comment_anchor')
    anchor['attrs']['thread']['entries'][0]['date'] = 'invalid'
    with pytest.raises(ValidationError): validate_project(p)


@pytest.mark.parametrize('format', ['html', 'epub', 'docx'])
def test_clean_export_removes_comments_only_from_the_export_copy(tmp_path, format):
    p = fixture(); before = deepcopy(p)
    result = build_export(p, format, tmp_path, {'includeReviewComments': False})
    assert p == before
    opened = import_document(Path(result['path']))
    assert not any(n['type'] == 'comment_anchor' for n in walk(opened['document']))
    assert document_text(opened['document']) == 'Before selected\npassage after.'
    if format == 'docx':
        with ZipFile(result['path']) as archive: assert 'word/comments.xml' not in archive.namelist()
