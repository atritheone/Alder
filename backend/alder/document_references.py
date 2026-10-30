"""Explicitly refreshed text references, with cycle detection and lossless failures."""
import hashlib
import copy
import re
from .models import document_text


def reference_values(documents):
    targets = {}
    heading_counts = [0] * 6
    def put(identifier, pieces):
        if identifier:
            targets[identifier] = None if identifier in targets else pieces
    for document in documents:
        tape, starts, ends = [], {}, {}
        def collect(node):
            if node['type'] == 'table_of_contents': return
            if any(mark.get('type') == 'revision_deletion' for mark in node.get('marks', [])): return
            kind, attrs, at = node['type'], node.get('attrs') or {}, len(tape)
            if kind == 'text': tape.append(node.get('text', ''))
            elif kind == 'document_note':
                number=attrs.get('_noteLabel','1')
                put(attrs.get('blockId'),[number]);put((attrs.get('blockId'),'number'),[number])
            elif kind == 'cross_reference': tape.append(document_text(node) if attrs.get('referenceFormat') == 'page' else ('ref', attrs['targetId'], attrs.get('referenceFormat', 'text')))
            elif kind == 'bookmark': starts[attrs.get('blockId')] = (at, bool(attrs.get('range')))
            elif kind == 'bookmark_end': ends.setdefault(attrs['targetId'], []).append(at)
            else:
                heading_number = None
                if kind == 'heading' and attrs.get('headingNumbered'):
                    level = max(1, min(6, int(attrs.get('level', 1)))) - 1
                    heading_counts[level] = attrs.get('headingStart') or heading_counts[level] + 1
                    heading_counts[level + 1:] = [0] * (5 - level)
                    heading_number = '.'.join(str(value or 1) for value in heading_counts[:level + 1])
                sequence_ranges = []
                for child in node.get('content', []):
                    start = len(tape); collect(child)
                    if attrs.get('captionLabel') and child['type'] == 'sequence' and child['attrs']['sequenceName'] == attrs['captionLabel']:
                        sequence_ranges.append((start, len(tape)))
                if len(sequence_ranges) == 1 and attrs.get('blockId'):
                    start, end = sequence_ranges[0]
                    put((attrs['blockId'], 'labelNumber'), tape[at:end])
                    put((attrs['blockId'], 'number'), tape[start:end])
                if kind == 'heading' or attrs.get('captionLabel'): put(attrs.get('blockId'), tape[at:])
                if heading_number and attrs.get('blockId'): put((attrs['blockId'], 'number'), [heading_number])
                if kind in ('paragraph', 'heading', 'hard_break', 'hardBreak'): tape.append(' ')
        collect(document)
        for identifier, (at, is_range) in starts.items():
            closing = ends.get(identifier, [])
            put(identifier, tape[at:closing[0]] if is_range and len(closing) == 1 and closing[0] >= at else None)
    values, visiting = {}, set()
    def resolve(identifier, depth=0):
        if identifier in values: return values[identifier]
        if isinstance(identifier, tuple) and targets.get(identifier[0]) is None: return None
        if targets.get(identifier) is None or identifier in visiting or depth > 50: return None
        visiting.add(identifier)
        pieces = [resolve(piece[1] if piece[2] == 'text' else (piece[1],piece[2]), depth+1) if isinstance(piece, tuple) else piece for piece in targets[identifier]]
        visiting.remove(identifier)
        value = None if None in pieces else re.sub(r'\s+', ' ', ''.join(pieces)).strip()
        values[identifier] = value if value and len(value) <= 10000 else None
        return values[identifier]
    for identifier in targets: resolve(identifier)
    return values


def publication_references(sections, warnings):
    documents = [{'type':'doc', 'content':section['blocks']} for section in sections]
    from .document_captions import number_captions
    number_captions(documents)
    values = reference_values(documents)
    referenced = set()
    heading_ids = set()
    note_ids = set()
    def collect_headings(node):
        if node['type'] == 'heading': heading_ids.add(node.get('attrs', {}).get('blockId'))
        if node['type'] == 'document_note':note_ids.add(node.get('attrs',{}).get('blockId'))
        for child in node.get('content', []): collect_headings(child)
    for document in documents: collect_headings(document)
    def formatted_target(identifier, format):
        return identifier if format == 'text' else 'caption_' + hashlib.sha256((identifier+':'+format).encode()).hexdigest()[:32]
    def refresh(node):
        if node['type'] == 'cross_reference':
            attrs = node['attrs']; target = attrs['targetId']; format = attrs.get('referenceFormat', 'text'); referenced.add((target,format))
            value = (document_text(node) or '—') if format == 'page' and target in values else values.get(target if format == 'text' else (target,format))
            # Export ranges are real Word bookmark ranges. HTML keeps their
            # corresponding range too, so later numbering remains live.
            if target in note_ids:
                attrs['targetId']='note_reference_'+hashlib.sha256(target.encode()).hexdigest()[:32]
                attrs['_noteReference']=True
            elif format not in ('text','page') and not (target in heading_ids and format == 'number'):
                attrs['targetId'] = formatted_target(target, format)
                attrs['referenceFormat'] = 'text'
            attrs['unresolved'] = not bool(value)
            if value: node['content'] = [{'type':'text', 'text':value}]
            else:
                if not document_text(node): node['content'] = [{'type':'text', 'text':'[Reference unavailable]'}]
                message = 'A cross-reference has a missing, excluded, empty or circular target. Its last displayed wording is retained.'
                if message not in warnings: warnings.append(message)
        for child in node.get('content', []): refresh(child)
    for document in documents: refresh(document)
    # Word REF fields target bookmark ranges. Add named heading ranges only on
    # the detached publication; the editable document keeps its heading identity.
    used = set()
    def names(node):
        if node['type'] == 'bookmark': used.add(node['attrs']['name'].lower())
        for child in node.get('content', []): names(child)
    for document in documents: names(document)
    def anchor(node):
        attrs = node.get('attrs') or {}
        identifier = attrs.get('blockId')
        def markers(format):
            prefix = {'text':'AlderHeading_', 'labelNumber':'AlderLabel_', 'number':'AlderNumber_'}[format]
            target = formatted_target(identifier,format)
            name = prefix + hashlib.sha256(identifier.encode()).hexdigest()[:24]
            base = name; suffix = 1
            while name.lower() in used:
                suffix += 1; name = base[:35] + '_' + str(suffix)
            used.add(name.lower())
            return ({'type':'bookmark', 'attrs':{'blockId':target, 'name':name, 'range':True}},
                    {'type':'bookmark_end', 'attrs':{'targetId':target, 'name':name}})
        if (node['type'] == 'heading' or attrs.get('captionLabel')) and identifier:
            content = node.get('content', [])
            sequences = [i for i,child in enumerate(content) if child['type'] == 'sequence' and child['attrs']['sequenceName'] == attrs.get('captionLabel')]
            if len(sequences) == 1:
                position = sequences[0]
                before, after = [], []
                if (identifier,'labelNumber') in referenced:
                    start,end = markers('labelNumber'); before.append(start); after.insert(0,end)
                if (identifier,'number') in referenced:
                    start,end = markers('number'); content = [*content[:position],start,content[position],end,*content[position+1:]]
                    position += 2
                content = [*before,*content[:position+1],*after,*content[position+1:]]
            if (identifier,'text') in referenced or (identifier,'page') in referenced or (node['type'] == 'heading' and (identifier,'number') in referenced):
                start,end = markers('text');content = [start,*content,end]
            node['content'] = content
        content=[]
        for child in node.get('content', []):
            anchor(child)
            if child['type']=='document_note' and any((child['attrs']['blockId'],format) in referenced for format in ('number','page','text')):
                original=child['attrs']['blockId'];target='note_reference_'+hashlib.sha256(original.encode()).hexdigest()[:32];name='AlderNote_'+hashlib.sha256(original.encode()).hexdigest()[:24]
                content.extend([{'type':'bookmark','attrs':{'blockId':target,'name':name,'range':True}},child,{'type':'bookmark_end','attrs':{'targetId':target,'name':name}}])
            else:content.append(child)
        if 'content' in node:node['content']=content
    for document in documents: anchor(document)
    for section in sections: section['text'] = document_text({'type':'doc', 'content':section['blocks']})


def normalise_docx_fields(element, warnings):
    """Unify paired Word fields with fldSimple, retaining cached text on failure."""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    for child in list(element):
        if child.tag != qn('w:r'): normalise_docx_fields(child, warnings)
    children = list(element); output = []; stack = []
    malformed = False
    for child in children:
        marker = child.find(qn('w:fldChar')) if child.tag == qn('w:r') else None
        kind = marker.get(qn('w:fldCharType')) if marker is not None else None
        if kind == 'begin': stack.append({'instruction':'', 'result':[], 'separated':False})
        elif kind == 'separate' and stack: stack[-1]['separated'] = True
        elif kind == 'end' and stack:
            item = stack.pop(); field = OxmlElement('w:fldSimple'); field.set(qn('w:instr'), item['instruction'])
            for node in item['result']: field.append(copy.deepcopy(node))
            if stack:
                if stack[-1]['separated']: stack[-1]['result'].append(field)
            else: output.append(field)
        elif kind: malformed = True
        elif stack:
            item = stack[-1]
            if item['separated']: item['result'].append(child)
            else: item['instruction'] += ''.join(node.text or '' for node in child.iter(qn('w:instrText')))
        else: output.append(child)
    if stack or malformed:
        message = 'An incomplete Word field was imported as its available displayed text.'
        if message not in warnings: warnings.append(message)
        return
    if output != children:
        for child in list(element): element.remove(child)
        for child in output: element.append(child)
