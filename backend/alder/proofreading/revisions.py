"""Sentence revisions have a separate contract from minimal proofreading edits."""
import re
from collections import Counter
from bisect import bisect_right

from .contracts import diagnostic, fingerprint, u16, slice16, blocks, DIALECTS
from .roles import reverses_named_roles
from .invariants import negative_forms,repaired_non_names,narrows_explicit_plural,changes_known_negation_scope,changes_known_past_to_present,currency_symbols,CONTRACTION_REPAIRS,INITIAL_REPAIRS,control_literals

REVISION_PROMPT_VERSION = "sentence-revision-4"

CAPITALIZED_FUNCTION_WORDS = {'Due', 'Having', 'During', 'Neither', 'Each', 'Nobody', 'No', 'The', 'Their', 'They', 'Its', 'It', 'Although', 'Because', 'After', 'Before',
    'When', 'While', 'If', 'This', 'That', 'These', 'Those', 'There', 'Here',
    'He', 'She', 'We', 'You', 'I', 'A', 'An', 'In', 'On', 'At', 'For', 'To',
    'However', 'Therefore', 'Despite', 'Since', 'As', 'By', 'With', 'Without'}
REPORTING_VERBS = r'(?:say|says|said|ask|asks|asked|cry|cries|cried|reply|replies|replied|answer|answers|answered|whisper|whispers|whispered|shout|shouts|shouted|mutter|mutters|muttered|add|adds|added|remark|remarks|remarked|exclaim|exclaims|exclaimed)\b'


def reporting_clause(text):
    """Recognize narrow speech tags, not arbitrary following narration."""
    if re.match(REPORTING_VERBS,text,re.I):return True
    match=re.match(r'(?P<subject>(?:[^\W\d_][\w’\'-]*\.?\s+){1,6}?)'+REPORTING_VERBS,text,re.I)
    if not match:return False
    words=match['subject'].split()
    if words[-1].casefold() in {'quietly','softly','loudly','calmly','firmly','gently','angrily','dryly','sadly'}:
        words=words[:-1]
    if not words:return False
    pronouns={'he','she','they','i','we','you','it'}
    if len(words)==1 and words[0].casefold() in pronouns:
        return words[0] in {'he','she','they','I','we','you','it'}
    if all(word[0].isupper() and word.casefold() not in pronouns for word in words):return True
    return (2<=len(words)<=4 and words[0] in {'the','a','an','his','her','their','our','my'}
      and all(word.islower() and word not in pronouns|{'and','but','that','if','when','while','after','before','because'} for word in words[1:]))


def protected_names(text, corrected):
    return {word for word in re.findall(r'\b[^\W\d_]+\b', text) if word[0].isupper()} - CAPITALIZED_FUNCTION_WORDS - repaired_non_names(text, corrected)


def unchanged_internal_names(text, corrected):
    """Align the spelling audit with existing protection of unchanged names.

    An unfamiliar sentence-initial word remains auditable: capitalization alone
    there cannot distinguish a misspelling from a name. This is no general NER.
    """
    if not isinstance(corrected, str):
        return set()
    names = protected_names(text, corrected)
    result = set()
    for match in re.finditer(r'\b[^\W\d_]+\b', text):
        word = match.group()
        if word.casefold() in CONTRACTION_REPAIRS or word.casefold() in INITIAL_REPAIRS:
            continue
        before = text[:match.start()].rstrip(' \t\"“”‘’([{—–')
        after_title = re.search(r'\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St)\.$', before, re.I)
        speech_tag = re.search(r'[.!?][\"”’\']\s*$',text[:match.start()]) and reporting_clause(text[match.start():])
        if word in names and before and (before[-1] not in '.!?…' or after_title or speech_tag) and re.search(r'[^\W\d_]', before) and re.search(r'\b' + re.escape(word) + r'\b', corrected):
            result.add(word)
    return result


def introduces_internal_names(source,target):
    """Reject new internal named terms, including copied context attributions.

    Case repairs of existing words and the narrow allowed lexical repairs remain
    possible. This conservative check is not general entity/meaning verification.
    """
    words=r'\b[^\W\d_]+\b'
    known={word.casefold() for word in re.findall(words,source)}
    for token in repaired_non_names(source,target):
        for replacement in CONTRACTION_REPAIRS.get(token.casefold(),())+INITIAL_REPAIRS.get(token.casefold(),()):
            known.update(word.casefold() for word in re.findall(words,replacement))
    return any(name.casefold() not in known for name in unchanged_internal_names(target,target))


def spelling_issues(text, findings, accepted):
    """Exclude protected terms/fields; retain contextual alternatives, not blind top-one edits."""
    protected = []
    for term in accepted:
        if not term:
            continue
        for match in re.finditer(r'(?<!\w)' + re.escape(term) + r'(?!\w)', text, re.I):
            protected.append((u16(text, match.start()), u16(text, match.end())))
    return [item for item in findings if item['type'] == 'spelling' and not any(
        start <= item['start'] and end >= item['end'] for start, end in protected)]


def complete_spelling(corrected, config, check_rules, check_model, cancelled, *, allow_repair=True):
    """Audit the entire proposal, make at most one contextual repair, then audit again.

    None means an incomplete proposal is withheld. Facts/formatting are still
    validated against the original source by revision(), after this operation.
    """
    if not isinstance(corrected, str) or not corrected.strip() or len(corrected) > 2400 or any(c in corrected for c in '\r\n\t'):
        return None
    if cancelled():
        raise InterruptedError()
    issues = spelling_issues(corrected, check_rules(corrected, config), config['acceptedWords'])
    if cancelled():
        raise InterruptedError()
    if not issues:
        return corrected
    if not allow_repair:
        return None
    hints = [{'word': item['originalText'][:64], 'suggestions': [
        alternative['edits'][0]['replacement'][:64] for alternative in item.get('alternatives', [])[:3]
        if len(alternative['edits']) == 1]} for item in issues[:12]]
    repaired = check_model(corrected, {**config, 'spellingRepair': True,
                          'spellingIssues': hints, 'revisionMode': 'improve'}, cancelled)
    if cancelled():
        raise InterruptedError()
    if not isinstance(repaired, str) or not repaired.strip() or len(repaired) > 2400 or any(c in repaired for c in '\r\n\t'):
        return None
    return None if spelling_issues(repaired, check_rules(repaired, config), config['acceptedWords']) else repaired


def passages(text, checked_text, offset, segments, config, selected):
    """Keep inline fields inside their sentence, as protected literal phrases."""
    # Slice the immutable source once encoded. Encoding the entire manuscript
    # for every sentence made preparation quadratic on long documents.
    encoded = text.encode('utf-16-le')
    def source_slice(start, end):
        return encoded[start * 2:end * 2].decode('utf-16-le')
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
            protected = [source_slice(max(start,row['start']),min(end,row['end'])) for row in rows if row['language'] == 'zxx']
            target_text=source_slice(start,end)
            literals=control_literals(target_text)
            context_block = contexts[max(0,bisect_right(context_starts,start)-1)]
            context = context_block['text']
            local = len(slice16(context,0,start-context_block['start']))
            window = max(0,local-600)
            yield {'text':target_text,'start':start,'language':language,
                   'eligible':language != 'zxx','protected':bool(protected),
                   'configuration':{**config,'dialect':language if language in DIALECTS else config['dialect'],
                                    'context':context[window:window+1800],
                                    'acceptedWords':sorted(set(config['acceptedWords'] + protected + literals)) if protected or literals else config['acceptedWords']}}


def sentences(text):
    """Preserve offsets, titles and quoted utterances with their speech tags."""
    start = 0
    boundary = re.compile(r'[.!?][\"\u201d\u2019\')\]]*(?:\s+|$)')
    for match in boundary.finditer(text):
        prefix = text[start:match.start() + 1]
        if re.search(r'\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)\.$|\b[A-Z]\.$', prefix):
            continue
        if any(quote in match.group().rstrip()[1:] for quote in '\"”’\'') and reporting_clause(text[match.end():]):
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


def revision_rejection(text, corrected, accepted, *, lexical_repairs=False):
    """Explain the existing guard decision without retaining manuscript text."""
    if not isinstance(corrected, str) or corrected == text or not corrected.strip():
        return 'empty-or-unchanged'
    typography = str.maketrans({'“':'"', '”':'"', '‘':"'", '’':"'"})
    if ' '.join(text.translate(typography).split()) == ' '.join(corrected.translate(typography).split()):
        return 'typography-only'
    if len(corrected) > 2400 or any(c in corrected for c in '\r\n\t'):
        return 'invalid-shape'
    if len(corrected) > max(120, len(text) * 2):
        return 'excessive-expansion'
    if control_literals(text)!=control_literals(corrected):
        return 'control-literals'
    if introduces_internal_names(text,corrected):
        return 'introduced-name'
    # Ordered values prevent the old unordered-count guard accepting swapped amounts.
    facts = r'https?://\S+|[-+−]?[$£€¥]?[-+−]?\d+(?:[.,:/-]\d+)*(?:\s*%)?'
    if re.findall(facts, text) != re.findall(facts, corrected):
        return 'ordered-values'
    if currency_symbols(text)!=currency_symbols(corrected):
        return 'currency'
    # Numeric equality alone cannot preserve measurements or currencies.
    number_words=r'(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)'
    measured_number=rf'(?:(?:minus|negative)\s+)?(?:\d+(?:[.,]\d+)*|{number_words}(?:[\s-]+(?:and\s+)?{number_words})*)'
    units = rf'\b(?P<value>{measured_number})\s*(?P<unit>(?:(?:US|Australian|British)\s+)?(?:dollars?|euros?|pounds?|yen)|USD|EUR|GBP|AUD|kilograms?|kg|grams?|kilometres?|kilometers?|metres?|meters?|centimetres?|centimeters?|millimetres?|millimeters?|mm|cm|km|miles?|lbs?|ounces?|oz|feet|inches|litres?|liters?|hours?|minutes?|seconds?)\b'
    def measured_units(value):
        aliases={'metres':'meter','metre':'meter','meters':'meter','kilometres':'kilometer',
                 'kilometre':'kilometer','kilometers':'kilometer','centimetres':'centimeter',
                 'centimetre':'centimeter','centimeters':'centimeter','millimetres':'millimeter',
                 'millimetre':'millimeter','millimeters':'millimeter','litres':'liter','litre':'liter','liters':'liter'}
        return [(' '.join(amount.casefold().replace('-',' ').split()),aliases.get(unit.casefold(),unit.casefold().removesuffix('s')))
                for amount,unit in re.findall(units,value,re.I)]
    if measured_units(text) != measured_units(corrected):
        return 'measured-units'
    modality = r"\b(?:not|never|no|nobody|nothing|nowhere|neither|none|must|may|might|shall|should|could|cannot|willnot|wouldnot)\b"
    from .lexical_repairs import changes_known_direction
    if changes_known_direction(text,corrected):return 'scalar-direction'
    source_modality,target_modality=negative_forms(text),negative_forms(corrected)
    if lexical_repairs:
        from .lexical_repairs import modality_source
        source_modality=modality_source(source_modality,target_modality)
    if Counter(re.findall(modality, source_modality, re.I)) != Counter(re.findall(modality, target_modality, re.I)):
        return 'modality-or-negation'
    for word in accepted:
        pattern = r'(?<!\w)' + re.escape(word) + r'(?!\w)'
        if len(re.findall(pattern, text, re.I)) != len(re.findall(pattern, corrected, re.I)):
            return 'accepted-terms'
    # Protect likely proper names, without treating sentence-initial words as names.
    names = protected_names(text, corrected)
    if lexical_repairs:
        from .lexical_repairs import repaired_names
        names-=repaired_names(text,corrected)
    for name in names:
        if len(re.findall(r'\b' + re.escape(name) + r'\b', text)) != len(re.findall(r'\b' + re.escape(name) + r'\b', corrected)):
            return 'protected-name'
    # Role reversal can preserve every name and number count. Keep named
    # participants in order; some valid passive rewrites are withheld by design.
    words = r'\b[^\W\d_]+\b'
    if [word for word in re.findall(words,text) if word in names] != [word for word in re.findall(words,corrected) if word in names]:
        return 'name-order'
    if reverses_named_roles(text,corrected,names):
        return 'named-roles'
    if narrows_explicit_plural(text,corrected) or changes_known_negation_scope(text,corrected) or changes_known_past_to_present(text,corrected):
        return 'plurality-scope-or-event-time'
    return None


def revision(text, corrected, accepted, *, lexical_repairs=False):
    """Offer a whole-sentence edit using conservative, non-semantic-proof guards."""
    if revision_rejection(text, corrected, accepted,lexical_repairs=lexical_repairs) is not None:
        return None
    item = diagnostic(text, 0, u16(text), 'clarity', 'model:sentence-revision',
                      'Consider this sentence structure and clarity revision.', [corrected], 'model')
    item.update(kind='sentence-revision', replacementText=corrected,
                revisionId=fingerprint([text, corrected, REVISION_PROMPT_VERSION])[:24])
    return item
