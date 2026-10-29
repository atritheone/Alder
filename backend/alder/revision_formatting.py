"""Attribute-level review history; accepted later edits remain authoritative."""
from copy import deepcopy
import re

FORMATS = {'strong', 'em', 'underline', 'strike', 'code', 'link', 'text_style', 'highlight', 'subscript', 'superscript'}


def validate_format_log(log):
    from .document_revisions import validate_revision
    if not isinstance(log, dict) or not isinstance(log.get('base'), list) or not isinstance(log.get('records'), list) or not 1 <= len(log['records']) <= 1000:
        raise ValueError('Invalid formatting revision history.')
    def appearance(value):
        if value is not None and not isinstance(value, dict):
            raise ValueError('Invalid reviewed formatting properties.')
        if isinstance(value, dict):
            href = value.get('href')
            if href and (not isinstance(href, str) or re.match(r'\s*(?:javascript|vbscript|data|file):', href, re.I)):
                raise ValueError('Unsafe reviewed link URL.')
    seen = set()
    for mark in log['base']:
        if not isinstance(mark, dict) or mark.get('type') not in FORMATS or mark['type'] in seen:
            raise ValueError('Unsupported reviewed formatting.')
        seen.add(mark['type']); appearance(mark.get('attrs'))
    for record in log['records']:
        if not isinstance(record, dict): raise ValueError('Invalid formatting revision record.')
        validate_revision(record.get('stamp'))
        if record.get('status') not in ('pending', 'accepted', 'rejected') or not isinstance(record.get('patches'), list) or not 1 <= len(record['patches']) <= len(FORMATS):
            raise ValueError('Invalid formatting revision record.')
        seen = set()
        for patch in record['patches']:
            if not isinstance(patch, dict) or patch.get('type') not in FORMATS or patch['type'] in seen or 'before' not in patch or 'after' not in patch:
                raise ValueError('Unsupported formatting revision patch.')
            seen.add(patch['type']); appearance(patch['before']); appearance(patch['after'])


def format_marks(log, original=False):
    validate_format_log(log)
    marks = {mark['type']: deepcopy(mark.get('attrs') or {}) for mark in log['base']}
    for record in log['records']:
        if record['status'] == 'rejected' or (original and record['status'] == 'pending'): continue
        for patch in record['patches']:
            before, after, name = patch['before'], patch['after'], patch['type']
            if after is None: marks.pop(name, None)
            elif before is None: marks[name] = deepcopy(after)
            else:
                current = marks.setdefault(name, {})
                for key in before.keys() | after.keys():
                    if key in before and key in after and before[key] == after[key]: continue
                    if key in after: current[key] = deepcopy(after[key])
                    else: current.pop(key, None)
    return [{'type': name, **({'attrs': attrs} if attrs else {})} for name, attrs in marks.items()]


def format_patches(before, after):
    old = {m['type']: m.get('attrs') or {} for m in before}
    new = {m['type']: m.get('attrs') or {} for m in after}
    return [{'type': name, 'before': deepcopy(old.get(name)), 'after': deepcopy(new.get(name))}
            for name in sorted(old.keys() | new.keys()) if old.get(name) != new.get(name)]


def native_format_revision(log):
    """Word has one previous property set per run, not a per-author patch log.

    Refuse an overlapping multi-record conversion until it can retain all review
    decisions, rather than reattribute or accept another author's formatting.
    """
    validate_format_log(log)
    pending = [r for r in log['records'] if r['status'] == 'pending']
    for record in pending:
        for patch in record['patches']:
            if patch['type'] in ('link', 'code') or any(value and value.get('styleId') for value in (patch['before'], patch['after'])):
                raise ValueError('This hyperlink, code or named-character-style revision cannot yet be retained in Word. Review it first, or save the Alder document with its complete history.')
    identities = {r['stamp']['id'] for r in pending}
    if len(identities) > 1:
        raise ValueError('Overlapping formatting changes by separate revisions cannot yet be exported to Word without losing review history. Review those changes first, or save the Alder document with its complete history.')
    return (deepcopy(pending[0]['stamp']), format_marks(log, original=True)) if pending else None


def run_marks(properties, *, strict=False):
    """Supported native run properties, shared by normal and prior appearances."""
    from .document_revisions import W
    if properties is None: return []
    supported = {'b', 'bCs', 'i', 'iCs', 'u', 'strike', 'rFonts', 'sz', 'szCs', 'color', 'vertAlign', 'highlight', 'rPrChange', 'lang', 'noProof'}
    if strict and any(child.tag.rsplit('}', 1)[-1] not in supported for child in properties):
        raise ValueError('This Word formatting revision contains properties Alder cannot yet retain. The original file has not been changed.')
    marks = []
    for key, name in (('b', 'strong'), ('i', 'em'), ('u', 'underline'), ('strike', 'strike')):
        found = properties.find(f'{{{W}}}{key}')
        if found is not None and found.get(f'{{{W}}}val') not in ('0', 'false', 'none', 'off'):
            if strict and key == 'u' and found.get(f'{{{W}}}val') not in (None, 'single'):
                raise ValueError('This Word underline revision cannot yet be retained. The original file has not been changed.')
            marks.append({'type': name})
    appearance = {}
    family = properties.find(f'{{{W}}}rFonts'); size = properties.find(f'{{{W}}}sz'); colour = properties.find(f'{{{W}}}color')
    if family is not None:
        value = family.get(f'{{{W}}}ascii') or family.get(f'{{{W}}}hAnsi')
        if value: appearance['fontFamily'] = value
        elif strict: raise ValueError('A theme-font revision cannot yet be retained. The original file has not been changed.')
    if size is not None: appearance['fontSize'] = float(size.get(f'{{{W}}}val')) / 2
    if colour is not None and re.fullmatch(r'[0-9a-fA-F]{6}', colour.get(f'{{{W}}}val', '')):
        appearance['color'] = '#' + colour.get(f'{{{W}}}val')
    if appearance: marks.append({'type': 'text_style', 'attrs': appearance})
    vertical = properties.find(f'{{{W}}}vertAlign')
    if vertical is not None and vertical.get(f'{{{W}}}val') in ('subscript', 'superscript'):
        marks.append({'type': vertical.get(f'{{{W}}}val')})
    highlight = properties.find(f'{{{W}}}highlight')
    if highlight is not None and highlight.get(f'{{{W}}}val') not in ('none', None):
        marks.append({'type': 'highlight', 'attrs': {'color': highlight.get(f'{{{W}}}val')}})
    return marks
