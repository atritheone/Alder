import base64
import codecs
import hashlib
import pytest
from alder.plain_text_edits import prepare_replacement


def prepare(raw, edits):
    return base64.b64decode(prepare_replacement({'sourceBytes':base64.b64encode(raw).decode(),
        'sourceDigest':hashlib.sha256(raw).hexdigest(),'edits':edits})['bytes'])


def test_preserves_bytes_and_uses_utf16_offsets():
    raw=codecs.BOM_UTF8+'😀 old\r\nother\n'.encode()
    result=prepare(raw,[{'start':3,'end':6,'originalText':'old','replacement':'new'}])
    assert result==codecs.BOM_UTF8+'😀 new\r\nother\n'.encode()


def test_cp1252_unrepresentable_replacement_is_refused():
    with pytest.raises(ValueError,match='UTF-8'):
        prepare(b'caf\xe9',[{'start':0,'end':4,'originalText':'café','replacement':'😀'}])


@pytest.mark.parametrize('edits',[
    [{'start':0,'end':0,'originalText':'','replacement':'x'}],
    [{'start':1,'end':2,'originalText':'a','replacement':'x'}],
    [{'start':0,'end':2,'originalText':'ab','replacement':'x'}, {'start':1,'end':3,'originalText':'bc','replacement':'y'}],
])
def test_invalid_groups_refused(edits):
    with pytest.raises(ValueError): prepare(b'abc',edits)
