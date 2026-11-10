"""Sentence revisions have a separate contract from minimal proofreading edits."""
import re
from collections import Counter
from bisect import bisect_right

from .contracts import diagnostic, fingerprint, u16, slice16, blocks, DIALECTS

REVISION_PROMPT_VERSION = "sentence-revision-2"


def passages(text, checked_text, offset, segments, config, selected):
    """Keep inline fields inside their sentence, as protected literal phrases."""
    contexts = list(blocks(text))
    context_starts = [block['start'] for block in contexts]
    segment_ends = [segment['end'] for segment in segments]

    def overlaps(start, end):
        index = bisect_right(segment_ends, start)
        while index < len(segments) and segments[index]['start'] < end:
            yield segments[index]
            index += 1

    for block in blocks(checked_text):
        origin = offset + block['start']
        masked = bytearray(block['text'].encode('utf-16-le'))
        for segment in overlaps(origin, origin + u16(block['text'])):
            if segment['language'] == 'zxx':
                left = max(origin, segment['start']) - origin
                right = min(origin + len(masked)//2, segment['end']) - origin
                masked[left*2:right*2] = b'x\x00' * (right-left)
        targets = [{'start':0,'end':len(masked)//2}] if selected else sentences(masked.decode('utf-16-le'))
        for target in targets:
            start, end = origin + target['start'], origin + target['end']
            rows = list(overlaps(start, end))
            tags = {row['language'] for row in rows if row['language'] != 'zxx'}
            language = next(iter(tags)) if len(tags) == 1 else 'und' if tags else 'zxx'
            protected = [slice16(text,max(start,row['start']),min(end,row['end'])) for row in rows if row['language'] == 'zxx']
            context_block = contexts[max(0,bisect_right(context_starts,start)-1)]
            context = context_block['text']
            local = len(slice16(context,0,start-context_block['start']))
            window = max(0,local-600)
            yield {'text':slice16(text,start,end),'start':start,'language':language,
                   'eligible':language != 'zxx','protected':bool(protected),
                   'configuration':{**config,'dialect':language if language in DIALECTS else config['dialect'],
                                    'context':context[window:window+1800],
                                    'acceptedWords':sorted(set(config['acceptedWords'] + protected)) if protected else config['acceptedWords']}}


def sentences(text):
    """Preserve source offsets; don't split decimals, initials or common titles."""
    start = 0
    boundary = re.compile(r'[.!?][\"\u201d\u2019\')\]]*(?:\s+|$)')
    for match in boundary.finditer(text):
        prefix = text[start:match.start() + 1]
        if re.search(r'\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)\.$|\b[A-Z]\.$', prefix):
            continue
        end = match.end()
        left = start + len(text[start:end]) - len(text[start:end].lstrip())
        right = end - len(text[start:end]) + len(text[start:end].rstrip())
        if right > left:
            yield {"text": text[left:right], "start": u16(text, left), "end": u16(text, right)}
        start = end
    if text[start:].strip():
        left = start + len(text[start:]) - len(text[start:].lstrip())
        right = len(text.rstrip())
        yield {"text": text[left:right], "start": u16(text, left), "end": u16(text, right)}


def revision(text, corrected, accepted):
    """Allow structural changes, while preserving explicit protected facts.

    These checks are guardrails, not a proof of semantic equivalence. Every
    revision is a reviewable proposal, never an automatic manuscript mutation.
    """
    if not isinstance(corrected, str) or corrected == text or not corrected.strip():
        return None
    typography = str.maketrans({'“':'"', '”':'"', '‘':"'", '’':"'"})
    if ' '.join(text.translate(typography).split()) == ' '.join(corrected.translate(typography).split()):
        return None
    if len(corrected) > 2400 or any(c in corrected for c in '\r\n\t'):
        return None
    if len(corrected) > max(120, len(text) * 2):
        return None
    # Ordered values prevent the old unordered-count guard accepting swapped amounts.
    facts = r'https?://\S+|[$£€¥]?\d+(?:[.,:/-]\d+)*(?:\s*%)?'
    if re.findall(facts, text) != re.findall(facts, corrected):
        return None
    modality = r"\b(?:not|never|no|must|may|might|shall|cannot|can't|won't|should|could)\b"
    def negative_forms(value):
        return re.sub(r'\bno one\b', 'nobody', value, flags=re.I).casefold()
    if Counter(re.findall(modality, negative_forms(text), re.I)) != Counter(re.findall(modality, negative_forms(corrected), re.I)):
        return None
    for word in accepted:
        pattern = r'(?<!\w)' + re.escape(word) + r'(?!\w)'
        if len(re.findall(pattern, text, re.I)) != len(re.findall(pattern, corrected, re.I)):
            return None
    # Protect likely proper names, without treating sentence-initial words as names.
    common = {'Due', 'Having', 'During', 'Neither', 'Each', 'Nobody', 'No', 'The', 'Their', 'They', 'Its', 'It', 'Although', 'Because', 'After', 'Before',
              'When', 'While', 'If', 'This', 'That', 'These', 'Those', 'There', 'Here',
              'He', 'She', 'We', 'You', 'I', 'A', 'An', 'In', 'On', 'At', 'For', 'To',
              'However', 'Therefore', 'Despite', 'Since', 'As', 'By', 'With', 'Without'}
    names = {word for word in re.findall(r'\b[^\W\d_]+\b', text) if word[0].isupper()} - common
    for name in names:
        if len(re.findall(r'\b' + re.escape(name) + r'\b', text)) != len(re.findall(r'\b' + re.escape(name) + r'\b', corrected)):
            return None
    # Role reversal can preserve every name and number count. Keep named
    # participants in order; some valid passive rewrites are withheld by design.
    words = r'\b[^\W\d_]+\b'
    if [word for word in re.findall(words,text) if word in names] != [word for word in re.findall(words,corrected) if word in names]:
        return None
    item = diagnostic(text, 0, u16(text), 'clarity', 'model:sentence-revision',
                      'Consider this sentence structure and clarity revision.', [corrected], 'model')
    item.update(kind='sentence-revision', replacementText=corrected,
                revisionId=fingerprint([text, corrected, REVISION_PROMPT_VERSION])[:24])
    return item
