"""Prepare exact-byte folder replacements; this module never writes source files."""
import base64
import hashlib
from .plain_text_file import decode_file, encode_file


def prepare_replacement(data):
    raw = base64.b64decode(data.get('sourceBytes', ''), validate=True)
    if len(raw) > 8_000_000:
        raise ValueError('Folder replacements support text files up to 8 MB each.')
    expected = data.get('sourceDigest')
    if expected != hashlib.sha256(raw).hexdigest():
        raise ValueError('The replacement source bytes changed.')
    text, metadata = decode_file(raw)
    encoded = text.encode('utf-16-le')
    edits = data.get('edits')
    if not isinstance(edits, list) or not 1 <= len(edits) <= 10000:
        raise ValueError('Use between 1 and 10,000 text replacements.')
    previous = 0
    output = []
    for edit in edits:
        start, end = edit.get('start'), edit.get('end')
        replacement, original = edit.get('replacement'), edit.get('originalText')
        if type(start) is not int or type(end) is not int or start < previous or end <= start or end * 2 > len(encoded) or not isinstance(replacement, str) or not isinstance(original, str):
            raise ValueError('Replacement ranges overlap or are no longer valid.')
        # Decode each slice strictly: offsets may never split a surrogate pair.
        if encoded[start * 2:end * 2].decode('utf-16-le') != original:
            raise ValueError('The replacement text no longer matches its source.')
        output.extend((encoded[previous * 2:start * 2], replacement.encode('utf-16-le')))
        previous = end
    output.append(encoded[previous * 2:])
    result = encode_file(b''.join(output).decode('utf-16-le'), metadata)
    if len(result) > 8_000_000:
        raise ValueError('The replaced file would exceed the eight-megabyte folder limit.')
    return {'bytes': base64.b64encode(result).decode('ascii'), 'digest': hashlib.sha256(result).hexdigest()}
