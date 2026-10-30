"""Resolve native Word run direction without changing authored Unicode text.

ICU supplies the Unicode bidirectional algorithm, including neutral punctuation,
brackets and isolates. Resolve whole paragraphs, not individual formatting runs.
"""
from contextlib import nullcontext
from copy import deepcopy
import ctypes
import ctypes.util
from functools import lru_cache
import os
from pathlib import Path
import re
import sys
import unicodedata


def _library_candidates():
    if sys.platform == 'win32':
        yield str(Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/icu.dll')
    elif sys.platform == 'darwin':
        yield '/usr/lib/libicucore.A.dylib'
    else:
        found = ctypes.util.find_library('icuuc')
        if found:
            yield found
    # Calibre's already verified runtime includes ICU. Do not load DLLs from
    # the process working directory or search arbitrary user-controlled paths.
    from .platform_runtime import resource_executable
    configured = os.environ.get('ALDER_RESOURCES_DIR')
    roots = [Path(configured)] if configured else [
        Path(__file__).resolve().parents[2] / 'work/bundle-resources',
        Path(__file__).resolve().parents[2] / 'release/win-unpacked/resources',
    ]
    for root in roots:
        directory = resource_executable(root, 'calibre').parent
        patterns = ('app/bin/icuuc*.dll',) if sys.platform == 'win32' else (
            '../Frameworks/libicuuc*.dylib', '../Frameworks/libicucore*.dylib',
        ) if sys.platform == 'darwin' else ('lib/libicuuc.so*',)
        for pattern in patterns:
            yield from (str(path.resolve()) for path in sorted(directory.glob(pattern)))


@lru_cache(maxsize=1)
def _icu():
    for candidate in _library_candidates():
        try:
            path = Path(candidate)
            context = os.add_dll_directory(str(path.parent)) if sys.platform == 'win32' and path.is_absolute() and path.parent.is_dir() else nullcontext()
            with context:
                library = ctypes.CDLL(candidate)
            suffixes = [''] + ['_' + version for version in re.findall(r'\d+', path.name)]
            for suffix in suffixes:
                try:
                    functions = [getattr(library, name + suffix) for name in (
                        'ubidi_open', 'ubidi_close', 'ubidi_setPara', 'ubidi_getLevels')]
                    break
                except AttributeError:
                    continue
            else:
                continue
            opened, close, set_para, levels = functions
            opened.argtypes = []; opened.restype = ctypes.c_void_p
            close.argtypes = [ctypes.c_void_p]; close.restype = None
            set_para.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint16), ctypes.c_int32,
                                ctypes.c_uint8, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int32)]
            set_para.restype = None
            levels.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int32)]
            levels.restype = ctypes.POINTER(ctypes.c_uint8)
            return library, opened, close, set_para, levels
        except (OSError, AttributeError):
            continue
    raise ValueError('Mixed-direction Word export requires the local ICU runtime. Repair the Alder installation; the source document is unchanged.')


def embedding_levels(text, rtl=False):
    """One resolved level per Python character, including supplementary Unicode."""
    if not text:
        return []
    _, opened, close, set_para, get_levels = _icu()
    raw = text.encode('utf-16-le')
    units = (ctypes.c_uint16 * (len(raw) // 2)).from_buffer_copy(raw)
    handle = opened()
    if not handle:
        raise MemoryError('Unable to resolve document text direction.')
    try:
        error = ctypes.c_int32(0)
        set_para(handle, units, len(units), int(rtl), None, ctypes.byref(error))
        if error.value > 0:
            raise ValueError(f'Unable to resolve document text direction (ICU {error.value}).')
        levels = get_levels(handle, ctypes.byref(error))
        if error.value > 0 or not levels:
            raise ValueError(f'Unable to resolve document text direction (ICU {error.value}).')
        result = []; offset = 0
        for char in text:
            result.append(levels[offset]); offset += 2 if ord(char) > 0xffff else 1
        return result
    finally:
        close(handle)


def _style_chain(identifier, styles):
    from docx.oxml.ns import qn
    seen = set()
    while identifier in styles and identifier not in seen:
        seen.add(identifier); style = styles[identifier]; yield style
        base = style.find(qn('w:basedOn'))
        identifier = base.get(qn('w:val')) if base is not None else None


def word_directions(text, rtl=False):
    levels = embedding_levels(text, rtl)
    result = [0] * len(text)
    start = 0
    for end in range(1, len(text) + 1):
        if end == len(text) or levels[end] != levels[start]:
            # Word's rtl property controls complex-script number/neutral
            # context, not the numeric embedding level. Numbers nested inside
            # an RTL run keep that context even though ICU's level is even.
            # Strong Latin text must never receive the rtl override.
            value = int(levels[start] > 0 and not any(
                unicodedata.bidirectional(c) == 'L' for c in text[start:end]))
            result[start:end] = [value] * (end - start)
            start = end
    return result


def resolve_word_directions(document):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    styles = {style.style_id: style.element for style in document.styles}
    text_tags = {qn('w:t'), qn('w:delText')}
    symbols = {qn('w:tab'): '\t', qn('w:br'): '\n', qn('w:cr'): '\n',
               qn('w:footnoteReference'): '\ufffc', qn('w:endnoteReference'): '\ufffc',
               qn('w:drawing'): '\ufffc', qn('w:noBreakHyphen'): '\u2011', qn('w:softHyphen'): '\u00ad'}
    for part in document.part.package.parts:
        root = getattr(part, '_element', None)
        if root is None:
            continue
        for paragraph in root.iter(qn('w:p')):
            props = paragraph.find(qn('w:pPr'))
            pstyle = props.find(qn('w:pStyle')) if props is not None else None
            sources = [props] + [style.find(qn('w:pPr')) for style in _style_chain(
                pstyle.get(qn('w:val')) if pstyle is not None else 'Normal', styles)]
            bidi = next((source.find(qn('w:bidi')) for source in sources
                         if source is not None and source.find(qn('w:bidi')) is not None), None)
            rtl = bidi is not None and bidi.get(qn('w:val'), '1') not in ('0', 'false', 'off')
            runs = []; text = ''
            for run in paragraph.iter(qn('w:r')):
                if next(run.iterancestors(qn('w:p')), None) is not paragraph:
                    continue
                children = []
                for child in run:
                    if child.tag == qn('w:rPr'):
                        continue
                    value = (child.text or '') if child.tag in text_tags else symbols.get(child.tag, '')
                    children.append((child, len(text), value)); text += value
                runs.append((run, children))
            if not rtl and not any(unicodedata.bidirectional(char) in ('R', 'AL', 'RLE', 'RLO', 'RLI') for char in text):
                continue
            levels = word_directions(text, rtl)
            for run, children in runs:
                pieces = []; current = None; previous = None
                for child, offset, value in children:
                    segments = []
                    if child.tag in text_tags and value:
                        start = 0
                        for end in range(1, len(value) + 1):
                            if end == len(value) or levels[offset + end] % 2 != levels[offset + start] % 2:
                                clone = deepcopy(child); clone.text = value[start:end]
                                clone.set(qn('xml:space'), 'preserve')
                                segments.append((clone, levels[offset + start] % 2)); start = end
                    else:
                        segments.append((deepcopy(child), levels[offset] % 2 if value else previous))
                    for clone, direction in segments:
                        if current is None or direction is not None and direction != previous:
                            current = deepcopy(run)
                            for entry in list(current):
                                if entry.tag != qn('w:rPr'):
                                    current.remove(entry)
                            rpr = current.find(qn('w:rPr'))
                            if rpr is None:
                                rpr = OxmlElement('w:rPr'); current.insert(0, rpr)
                            for old in list(rpr.findall(qn('w:rtl'))):
                                rpr.remove(old)
                            if direction is not None:
                                flag = OxmlElement('w:rtl'); flag.set(qn('w:val'), str(direction)); rpr.append(flag)
                            pieces.append(current); previous = direction
                        current.append(clone)
                if pieces:
                    parent = run.getparent(); index = parent.index(run)
                    parent.remove(run)
                    for piece in pieces:
                        parent.insert(index, piece); index += 1


def complex_script_properties(document):
    """Mirror inherited size/emphasis for Word's separate complex-script font."""
    from docx.oxml.ns import qn
    styles = {style.style_id: style.element for style in document.styles}
    normal = document.styles['Normal'].element
    for part in document.part.package.parts:
        root = getattr(part, '_element', None)
        if root is None:
            continue
        for run in root.iter(qn('w:r')):
            props = run.find(qn('w:rPr'))
            flag = props.find(qn('w:rtl')) if props is not None else None
            if flag is None or flag.get(qn('w:val'), '1') in ('0', 'false', 'off'):
                continue
            sources = [props]
            run_style = props.find(qn('w:rStyle'))
            if run_style is not None:
                sources.extend(style.find(qn('w:rPr')) for style in _style_chain(run_style.get(qn('w:val')), styles))
            paragraph = next(run.iterancestors(qn('w:p')), None)
            if paragraph is not None:
                pstyle = paragraph.find('./' + qn('w:pPr') + '/' + qn('w:pStyle'))
                if pstyle is not None:
                    sources.extend(style.find(qn('w:rPr')) for style in _style_chain(pstyle.get(qn('w:val')), styles))
            sources.append(normal.find(qn('w:rPr')))
            for source_tag, target_tag in (('b', 'bCs'), ('i', 'iCs'), ('sz', 'szCs')):
                value = next((source.find(qn('w:' + source_tag)) for source in sources
                              if source is not None and source.find(qn('w:' + source_tag)) is not None), None)
                if value is None:
                    continue
                old = props.find(qn('w:' + target_tag))
                if old is not None:
                    props.remove(old)
                converted = deepcopy(value); converted.tag = qn('w:' + target_tag); props.append(converted)
