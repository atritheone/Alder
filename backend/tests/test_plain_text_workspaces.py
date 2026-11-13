from copy import deepcopy
from alder.store import Store
from alder.models import text_document
from alder.plain_text_workspaces import plain_copy, reopen_text


def test_plain_copy_keeps_original_rich_workspace_unchanged(tmp_path):
    store = Store(tmp_path)
    source = store.create('Legacy TXT', 'blank')
    document = text_document('Main wording.\nSecond line.')
    document['content'][0]['content'][0]['marks'] = [{'type': 'strong'}]
    source['book'] = {'version': 1, 'chapters': [{'id':'legacy', 'title':'Text', 'role':'chapter', 'document':document}]}
    source['settings'].update(documentKind='txt', preferredFormat='txt')
    source = store.update(source['id'], source, source['revision'])
    before = deepcopy(source)
    copy = plain_copy(store, source['id'])
    assert store.get(source['id']) == before
    assert copy['id'] != source['id']
    assert copy['book']['chapters'][0]['text'] == 'Main wording.\nSecond line.'
    assert copy['book']['chapters'][0]['document']['content'][0]['content'][0].get('marks') is None
    assert copy['settings']['documentKind'] == 'txt'


def test_encoding_reopen_retains_original_workspace_and_exact_bytes(tmp_path):
    from alder.plain_text_file import encode_file
    store = Store(tmp_path)
    source = store.create('Original wording', 'blank')
    source['settings'].update(documentKind='txt', preferredFormat='txt')
    source = store.update(source['id'], source, source['revision'])
    before = deepcopy(source)
    raw = '字 café\r\n'.encode('utf-16-le')
    reopened = reopen_text(store, source['id'], raw, 'utf-16-le')
    assert reopened['id'] != source['id']
    assert store.get(source['id']) == before
    text = reopened['book']['chapters'][0]['text']
    assert text == '字 café\n'
    assert encode_file(text, reopened['settings']['textFile']) == raw


def test_explicit_decoding_refuses_lossy_or_unsupported_encodings():
    import pytest
    from alder.plain_text_file import decode_file
    with pytest.raises(ValueError):
        decode_file(b'caf\xe9', 'utf-8')
    with pytest.raises(ValueError):
        decode_file(b'abc', 'utf-32')
    assert decode_file(b'\xc3\xa9', 'cp1252')[0] == 'Ã©'
