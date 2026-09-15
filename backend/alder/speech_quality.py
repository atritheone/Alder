"""Versioned input bounds, PCM checks, and conservative acceptance policy."""
from __future__ import annotations
from array import array
import math
import re
import sys
import wave

QUALITY_VERSION = 2


# Common prose in capitals is emphasis, while initialisms and pronunciation
# overrides must keep their authored spelling. This only changes spoken input.
SHORT_EMPHASIS = frozenset('THE AND BUT NOT FOR YOU ARE WAS ALL HOW WHO WHY YES OUT OFF TOO ONE TWO TEN AS AT BY DO GO HE IF IN IS ME MY NO OF ON OR SO TO UP WE AN AM BE'.split())
INITIALISMS = frozenset('NASA NATO HTTP HTTPS HTML JSON XML SQL API ASCII UTF8 USB CPU GPU RAM ROM PDF DOCX UNESCO UNICEF'.split())


def spoken_case(text, mappings):
    if not re.search(r"\b[A-Z]{2,}\b", text):
        return text
    from .language import _speller
    checker = _speller()
    def replace(match):
        word = match.group()
        if any(m['spokenStart'] < match.end() and match.start() < m['spokenEnd'] for m in mappings):
            return word
        if word in INITIALISMS:
            return word
        if word in SHORT_EMPHASIS or (len(word) >= 4 and checker is not None and word.lower() in checker):
            return word.lower()
        return word
    return re.sub(r'\b[A-Z]{2,}\b', replace, text)


def normalize_spoken(text, mappings):
    return spoken_case(text, mappings).replace("`", "'")


def speech_projection(text, entries, voice_id):
    from .speech import pronunciation_projection
    from .speech_comparison import expand_contraction, NUMBER_RANGE, spoken_range
    spoken, mappings = pronunciation_projection(text, entries, voice_id)
    automatic = []
    for match in re.finditer(r"\b[^\W_]+['’][^\W_]+\b", text):
        expanded = expand_contraction(match.group())
        if expanded == match.group() or any(m['sourceStart'] < match.end() and match.start() < m['sourceEnd'] for m in mappings):
            continue
        automatic.append({'word':match.group(), 'spoken':expanded, 'caseSensitive':True})
    for match in NUMBER_RANGE.finditer(text):
        if not any(m['sourceStart'] < match.end() and match.start() < m['sourceEnd'] for m in mappings):
            automatic.append({'word': match.group(), 'spoken': spoken_range(match), 'caseSensitive': True})
    if automatic:
        spoken, mappings = pronunciation_projection(text, [*entries, *automatic], voice_id)
    return normalize_spoken(spoken, mappings), mappings


def projected_sections(text, entries, voice_id, max_chars=220, max_words=40):
    from .speech import split_narration, pronunciation_projection
    pending = split_narration(text, max_chars, max_words)
    _, global_mappings = pronunciation_projection(text, entries, voice_id)
    merged = []
    for part in pending:
        if merged and any(m["sourceStart"] < part["sourceStart"] < m["sourceEnd"] for m in global_mappings):
            previous = merged[-1]
            previous.update(text=text[previous["sourceStart"]:part["sourceEnd"]], sourceEnd=part["sourceEnd"], paragraphEnd=part["paragraphEnd"])
        else:
            merged.append(part)
    pending = merged
    result = []
    while pending:
        part = pending.pop(0)
        spoken, mapping = speech_projection(part["text"], entries, voice_id)
        if not spoken.strip():
            continue
        if len(spoken) <= max_chars and len(spoken.split()) <= max_words:
            result.append({**part, "spokenText": spoken, "pronunciationMap": mapping})
            continue
        words = list(re.finditer(r"\S+", part["text"]))
        # Never split a pronunciation rule and silently change its meaning.
        boundaries = [m.start() for m in words[1:] if not any(x["sourceStart"] < m.start() < x["sourceEnd"] for x in mapping)]
        if not boundaries:
            raise ValueError("A pronunciation replacement is too long. Shorten it to 220 characters and 40 words.")
        middle = min(boundaries, key=lambda x: abs(x - len(part["text"]) / 2))
        children = []
        for a, b in ((0, middle), (middle, len(part["text"]))):
            raw = part["text"][a:b]
            start = a + len(raw) - len(raw.lstrip())
            end = b - (len(raw) - len(raw.rstrip()))
            children.append({"text": part["text"][start:end], "sourceStart": part["sourceStart"] + start,
                             "sourceEnd": part["sourceStart"] + end, "paragraphEnd": part["paragraphEnd"] and b == len(part["text"])})
        pending[0:0] = children
    return result


def inspect_pcm(path, text):
    with wave.open(str(path), "rb") as audio:
        if audio.getsampwidth() != 2 or audio.getnchannels() != 1 or audio.getframerate() != 24000:
            raise ValueError("Expected mono 24 kHz 16-bit speech audio.")
        frames = audio.getnframes()
        raw = audio.readframes(frames)
        if len(raw) != frames * 2 or frames == 0:
            raise ValueError("Speech audio is empty or truncated.")
    samples = array("h", raw)
    if sys.byteorder != "little":
        samples.byteswap()
    peak = max(abs(v) for v in samples) / 32768
    rms = math.sqrt(sum(float(v) * v for v in samples) / len(samples)) / 32768
    clipped = sum(abs(v) >= 32760 for v in samples) / len(samples)
    seconds = frames / 24000
    words = max(1, len(text.split()))
    reasons = []
    if peak < .0001 or rms < .00001:
        reasons.append("silent audio")
    if clipped > .01:
        reasons.append("clipped audio")
    if not max(.12, words * .055) <= seconds <= words * 1.5 + 5:
        reasons.append("implausible speech duration")
    return {"accepted": not reasons, "reasons": reasons, "seconds": seconds, "peak": peak,
            "rms": rms, "clippedFraction": clipped, "version": QUALITY_VERSION}


def valid_timings(words, text, seconds):
    previous = 0.0
    result = []
    for word in words:
        a, b = word.get("startSeconds"), word.get("endSeconds")
        start, end = word.get("sourceStart"), word.get("sourceEnd")
        if (not isinstance(a, (int, float)) or not isinstance(b, (int, float)) or
            not math.isfinite(a) or not math.isfinite(b) or a < previous or not 0 <= a < b <= seconds + .02 or
            not isinstance(start, int) or not isinstance(end, int) or not 0 <= start < end <= len(text)):
            continue
        result.append({**word, "endSeconds": min(b, seconds)})
        previous = b
    return result
