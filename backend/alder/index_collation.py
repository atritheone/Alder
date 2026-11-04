"""Local ICU index ordering; never use the process's mutable locale."""
from contextlib import contextmanager, nullcontext
import ctypes
from functools import lru_cache
import locale
import os
from pathlib import Path
import re
import sys


def validate_language(value):
    if value is not None and (not isinstance(value, str) or len(value) > 40 or
            not re.fullmatch(r'[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*', value)):
        raise ValueError('Use an index sorting language tag, such as en-GB or sv-SE.')


@lru_cache(maxsize=1)
def _icu():
    from .text_direction import _library_candidates
    for candidate in _library_candidates('i18n'):
        try:
            path = Path(candidate)
            context = os.add_dll_directory(str(path.parent)) if sys.platform == 'win32' and path.is_absolute() and path.parent.is_dir() else nullcontext()
            with context:
                library = ctypes.CDLL(candidate)
            for suffix in [''] + ['_' + v for v in re.findall(r'\d+', path.name)]:
                try:
                    functions = [getattr(library, name + suffix) for name in (
                        'ucol_open', 'ucol_close', 'ucol_getSortKey', 'ucol_setAttribute',
                        'ucol_countAvailable', 'ucol_getAvailable')]
                    break
                except AttributeError:
                    continue
            else:
                continue
            opened, close, key, attribute, count, available = functions
            opened.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_int32)]; opened.restype = ctypes.c_void_p
            close.argtypes = [ctypes.c_void_p]; close.restype = None
            key.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint16), ctypes.c_int32, ctypes.POINTER(ctypes.c_uint8), ctypes.c_int32]; key.restype = ctypes.c_int32
            attribute.argtypes = [ctypes.c_void_p, ctypes.c_int32, ctypes.c_int32, ctypes.POINTER(ctypes.c_int32)]; attribute.restype = None
            count.argtypes = []; count.restype = ctypes.c_int32
            available.argtypes = [ctypes.c_int32]; available.restype = ctypes.c_char_p
            languages = {available(i).decode('ascii').split('_')[0] for i in range(count())}
            return library, opened, close, key, attribute, languages
        except (OSError, AttributeError):
            continue
    raise ValueError('Index sorting requires the local ICU runtime. Repair the Alder installation; the source document is unchanged.')


@contextmanager
def sort_keys(language=None):
    validate_language(language)
    language = language or 'en'
    _, opened, close, key, attribute, languages = _icu()
    if language.split('-')[0].lower() not in languages:
        raise ValueError(f'Index sorting language {language!r} is unavailable in the local runtime.')
    error = ctypes.c_int32(0)
    handle = opened(language.encode('ascii'), ctypes.byref(error))
    if error.value > 0 or not handle:
        if handle:
            close(handle)
        raise ValueError('Unable to open the index sorting language.')
    try:
        # Match Intl.Collator: variant strength, canonical equivalence, punctuation
        # significant, case/numeric ordering not overridden by the user's OS.
        for attr, value in ((1, 21), (2, 16), (3, 16), (4, 17), (5, 2), (7, 16)):
            attribute(handle, attr, value, ctypes.byref(error))
        if error.value > 0:
            raise ValueError('Unable to configure index sorting.')
        @lru_cache(maxsize=None)
        def order(text):
            raw = text.encode('utf-16-le')
            units = (ctypes.c_uint16 * (len(raw) // 2)).from_buffer_copy(raw)
            length = key(handle, units, len(units), None, 0)
            if length < 1:
                raise ValueError('Unable to sort an index term.')
            result = (ctypes.c_uint8 * length)()
            key(handle, units, len(units), result, length)
            return bytes(result)
        yield order
    finally:
        close(handle)


def word_language(language):
    """Use a stable Word LCID, refusing unrepresentable collation extensions."""
    validate_language(language)
    tag = (language or 'en').replace('-', '_').lower()
    candidates = [(id, name.lower()) for id, name in locale.windows_locale.items()]
    exact = next((id for id, name in candidates if name == tag), None)
    if exact is not None:
        return exact
    # A neutral language uses its primary Windows sublanguage, not host locale.
    if '_' not in tag:
        primary = next((id for id, name in candidates if name.split('_')[0] == tag and id >> 10 == 1), None)
        if primary is not None:
            return primary
    raise ValueError(f'Word cannot preserve index sorting language {language!r}. Choose a supported regional language before Word export.')


def language_from_word(value):
    if value.isdecimal():
        value = locale.windows_locale.get(int(value), '').replace('_', '-')
    try:
        validate_language(value)
        word_language(value)
    except ValueError:
        return None
    return value
