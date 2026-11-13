"""Lossless TXT byte formats, independent of publication formatting."""
import codecs
import difflib
import re


def decode_file(raw, selected_encoding=None):
    if selected_encoding is not None and selected_encoding not in ('utf-8', 'utf-16-le', 'utf-16-be', 'cp1252'):
        raise ValueError('Unsupported TXT encoding.')
    encoding, bom = selected_encoding or 'utf-8', b''
    for marker, candidate in ((codecs.BOM_UTF8, 'utf-8'), (codecs.BOM_UTF16_LE, 'utf-16-le'), (codecs.BOM_UTF16_BE, 'utf-16-be')):
        if raw.startswith(marker) and (selected_encoding is None or selected_encoding == candidate):
            encoding, bom = candidate, marker
            break
    try:
        text = raw[len(bom):].decode(encoding)
    except UnicodeDecodeError:
        if bom or selected_encoding is not None:
            raise ValueError('The TXT file contains invalid encoded text. Its original bytes were preserved.')
        encoding = 'cp1252'
        try:
            text = raw.decode(encoding)
        except UnicodeDecodeError as error:
            raise ValueError('The TXT encoding could not be read safely. Choose another encoding before editing.') from error
    endings = re.findall(r'\r\n|\r|\n', text)
    counts = {ending: endings.count(ending) for ending in set(endings)}
    default = max(dict.fromkeys(endings), key=counts.get) if endings else '\n'
    normal = text.replace('\r\n', '\n').replace('\r', '\n')
    return normal, {'version': 1, 'encoding': encoding, 'bom': bool(bom), 'eol': default,
                    'originalText': normal, 'endings': endings}


def encode_file(text, metadata):
    if not isinstance(text, str) or not isinstance(metadata, dict):
        raise ValueError('Invalid TXT text or format metadata.')
    if metadata.get('version', 1) != 1 or any(type(metadata.get(key, False)) is not bool for key in ('bom', 'convertEol')):
        raise ValueError('Invalid TXT format metadata.')
    encoding = metadata.get('encoding', 'utf-8')
    if encoding not in ('utf-8', 'utf-16-le', 'utf-16-be', 'cp1252'):
        raise ValueError('Unsupported TXT encoding.')
    eol = metadata.get('eol', '\n')
    if eol not in ('\r\n', '\n', '\r'):
        raise ValueError('Invalid TXT line ending.')
    old = metadata.get('originalText', '')
    endings = metadata.get('endings', [])
    if not isinstance(old, str) or not isinstance(endings, list) or any(ending not in ('\r\n', '\n', '\r') for ending in endings):
        raise ValueError('Invalid stored TXT line endings.')
    lines = text.split('\n')
    chosen = [eol] * (len(lines) - 1)
    if not metadata.get('convertEol'):
        for kind, old_start, old_end, new_start, new_end in difflib.SequenceMatcher(None, old.split('\n'), lines).get_opcodes():
            if kind != 'equal' and not (kind == 'replace' and old_end - old_start == new_end - new_start):
                continue
            for offset in range(new_end - new_start):
                source, destination = old_start + offset, new_start + offset
                if source < len(endings) and destination < len(chosen):
                    if endings[source] not in ('\r\n', '\n', '\r'):
                        raise ValueError('Invalid stored TXT line ending.')
                    chosen[destination] = endings[source]
    output = ''.join(line + (chosen[i] if i < len(chosen) else '') for i, line in enumerate(lines))
    try:
        result = output.encode(encoding)
    except UnicodeEncodeError as error:
        raise ValueError('This text cannot be saved in the selected encoding. Convert to UTF-8 or UTF-16 to retain all characters.') from error
    if metadata.get('bom'):
        marker = {'utf-8': codecs.BOM_UTF8, 'utf-16-le': codecs.BOM_UTF16_LE, 'utf-16-be': codecs.BOM_UTF16_BE}.get(encoding)
        if marker is None:
            raise ValueError('The selected TXT encoding does not support a byte-order mark.')
        result = marker + result
    return result
