"""Prefer whole sentences; split oversized sentences only at clause punctuation."""
import re

BOUNDARY_VERSION = "sentences-then-punctuation-v2"
SAFE_MAX_CHARS = 240
SAFE_MAX_WORDS = 45
ABBREVIATIONS = {
    'mr.', 'mrs.', 'ms.', 'dr.', 'rev.', 'st.', 'prof.', 'vs.', 'etc.',
    'e.g.', 'i.e.', 'a.m.', 'p.m.', 'jr.', 'sr.', 'gen.', 'capt.', 'col.',
    'lt.', 'hon.', 'messrs.', 'no.', 'nos.', 'vol.', 'vols.', 'pp.', 'fig.',
    'dept.', 'inc.', 'ltd.', 'approx.', 'cf.', 'viz.',
}


class SentenceTooLongError(ValueError):
    def __init__(self, sentences):
        self.sentences = sentences
        first = sentences[0]
        super().__init__(
            f'{len(sentences)} passage(s) cannot be divided at sentence or clause punctuation within '
            f'{SAFE_MAX_CHARS} characters / {SAFE_MAX_WORDS} words. '
            f'The first has {len(first)} characters / {len(first.split())} words: '
            f'{first!r}. No arbitrary word cut, rewriting or oversized synthesis was used. '
            'Review the flagged passages before recording.')


def _enclosed(text):
    """Do not cut within quotations or parenthetical expressions."""
    stack = []
    pairs = {')': '(', ']': '[', '}': '{', '”': '“', '’': '‘'}
    for i, char in enumerate(text):
        if char in "'’" and i and text[i-1].isalnum():
            if i+1 < len(text) and text[i+1].isalnum():
                continue
            if char == '’' and (not stack or stack[-1] != '‘'):
                continue
        if char in '([{“‘':
            stack.append(char)
        elif char in pairs and stack and stack[-1] == pairs[char]:
            stack.pop()
        elif char in '\"\'':
            if stack and stack[-1] == char:
                stack.pop()
            elif char == '"' or not i or not text[i-1].isalnum():
                stack.append(char)
    return bool(stack)


def sentence_ends(text: str) -> set[int]:
    """Exclusive word offsets of conservative sentence boundaries.

    Always include the final input boundary, for headings/unpunctuated text.
    Ambiguous punctuation remains with its context, possibly requiring review.
    """
    tokens = text.split()
    ends = {len(tokens)} if tokens else set()
    for j, token in enumerate(tokens[:-1], 1):
        word = token.rstrip('\"”’\')]}')
        if not re.search(r'[.!?]$', word):
            continue
        if word.lower() in ABBREVIATIONS or word.endswith('...'):
            continue
        if re.fullmatch(r'(?:[A-Za-z]\.)+|(?:[A-Za-z]+\.){2,}|\d+\.|[ivxlcdmIVXLCDM]+\.', word):
            continue
        following = tokens[j].lstrip('\"“‘\'([{')
        if following and following[0].islower():
            continue  # Including: “Stop!” she said.
        if any(c in token for c in '\"”’') and re.match(
            r'^(?:\S+\s+){1,3}(?:said|asked|replied|whispered|shouted|cried|answered)\b',
            ' '.join(tokens[j:j+5]), re.IGNORECASE
        ):
            continue
        if _enclosed(' '.join(tokens[:j])):
            continue
        ends.add(j)
    return ends


def sentence_sections(text: str) -> list[str]:
    tokens = text.split()
    output = []
    start = 0
    for end in sorted(sentence_ends(text)):
        output.append(' '.join(tokens[start:end]))
        start = end
    return output


def overlong_sentences(text: str) -> list[str]:
    return [s for s in sentence_sections(text)
            if len(s) > SAFE_MAX_CHARS or len(s.split()) > SAFE_MAX_WORDS]


def ends_at_clause_punctuation(text: str) -> bool:
    # Only punctuation at a word boundary: never decimal/thousands separators,
    # times, hyphenated words or internal punctuation in romanised names.
    tail = text.rstrip().rstrip('\"”’\')]}')
    return bool(re.search(r'[,;:—–]$', tail) or re.search(r'\s-$', tail))


def _punctuation_pieces(sentence: str) -> list[str]:
    tokens = sentence.split()
    if len(sentence) <= SAFE_MAX_CHARS and len(tokens) <= SAFE_MAX_WORDS:
        return [sentence]
    cuts = [i for i, token in enumerate(tokens[:-1], 1)
            if ends_at_clause_punctuation(' '.join(tokens[:i]))]
    cuts.append(len(tokens))
    pieces = []
    start = 0
    while start < len(tokens):
        fitting = [end for end in cuts if start < end <= start + SAFE_MAX_WORDS
                   and len(' '.join(tokens[start:end])) <= SAFE_MAX_CHARS]
        if not fitting:
            raise SentenceTooLongError([sentence])
        end = max(fitting)
        pieces.append(' '.join(tokens[start:end]))
        start = end
    return pieces


def unsafe_passages(text: str) -> list[str]:
    findings = []
    for sentence in overlong_sentences(text):
        try:
            _punctuation_pieces(sentence)
        except SentenceTooLongError:
            findings.append(sentence)
    return findings


def section_ends(text: str) -> set[int]:
    allowed = set()
    offset = 0
    for sentence in sentence_sections(text):
        tokens = sentence.split()
        if len(sentence) > SAFE_MAX_CHARS or len(tokens) > SAFE_MAX_WORDS:
            allowed.update(offset+i for i in range(1,len(tokens))
                           if ends_at_clause_punctuation(' '.join(tokens[:i])))
        offset += len(tokens)
        allowed.add(offset)
    return allowed


def preflight_tracks(tracks: list[dict]) -> list[dict]:
    """Collect passages lacking a safe punctuation split before recording."""
    findings = []
    for track in tracks:
        paragraphs = track.get('paragraphs')
        if paragraphs is None:
            paragraphs = [block['text'] for block in track['blocks']]
        for index, paragraph in enumerate(paragraphs):
            for sentence in unsafe_passages(paragraph):
                findings.append({'track': track['track'], 'paragraph': index,
                                 'text': sentence, 'characters': len(sentence),
                                 'words': len(sentence.split()), 'reason': 'no_punctuation_split_within_safe_limit'})
    return findings


def validate_section_breaks(text: str, sections: list[str]) -> None:
    """Reject missing text, arbitrary word cuts and unnecessary clause cuts."""
    if ' '.join(sections).split() != text.split():
        raise ValueError('Narration sections do not preserve the complete source text.')
    allowed = section_ends(text)
    offset = 0
    for section in sections[:-1]:
        offset += len(section.split())
        if offset not in allowed:
            raise ValueError(
                f'Legacy or repair section ends mid-sentence at an unauthorised boundary (word {offset}). '
                'Use sentence boundaries, or clause punctuation for an oversized sentence.')
    if any(len(s)>SAFE_MAX_CHARS or len(s.split())>SAFE_MAX_WORDS for s in sections):
        raise SentenceTooLongError(sections)


def split_narration(text: str, max_chars: int = 240, max_words: int = 45) -> list[str]:
    """Pack whole sentences near the requested targets, within 240 chars/45 words.

    Smaller repair targets do not split sentences that already fit the safety
    cap. Oversized sentences split at commas, colons, semicolons or dashes.
    If no such cut fits the cap, stop before synthesis rather than cut a word run.
    """
    if max_chars < 1 or max_words < 1:
        raise ValueError('Section targets must be positive.')
    max_chars = min(max_chars, SAFE_MAX_CHARS)
    max_words = min(max_words, SAFE_MAX_WORDS)
    oversized = unsafe_passages(text)
    if oversized:
        raise SentenceTooLongError(oversized)
    ends = section_ends(text)
    paragraph_ends = set()
    offset = 0
    for paragraph in re.split(r'\n\s*\n', text.strip()):
        offset += len(paragraph.split())
        if offset in ends:
            paragraph_ends.add(offset)
    chunks = []
    current = ''
    offset = 0
    pieces = [piece for sentence in sentence_sections(text) for piece in _punctuation_pieces(sentence)]
    for sentence in pieces:
        candidate = f'{current} {sentence}'.strip()
        if current and (len(candidate) > max_chars or len(candidate.split()) > max_words):
            chunks.append(current)
            current = ''
        current = f'{current} {sentence}'.strip()
        offset += len(sentence.split())
        if offset in paragraph_ends or len(current) >= max_chars or len(current.split()) >= max_words:
            chunks.append(current)
            current = ''
    if current:
        chunks.append(current)
    validate_section_breaks(text, chunks)
    return chunks
