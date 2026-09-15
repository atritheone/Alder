"""Versioned input bounds, PCM checks, and conservative acceptance policy."""
from __future__ import annotations
from array import array
import math
import re
import sys
import wave

QUALITY_VERSION = 2


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
        spoken, mapping = pronunciation_projection(part["text"], entries, voice_id)
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
