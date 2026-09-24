"""Map audio word times to unchanged source text, retaining uncertain spans."""
from difflib import SequenceMatcher
import re

TIMING_VERSION = 4


def word_timings(written, spoken, words, mappings=(), seconds=None):
    from .speech_comparison import canonical_tokens
    import math

    expected = [(match, token) for match in re.finditer(r"\w+(?:['’]\w+)*", spoken, re.UNICODE)
                for token in canonical_tokens(match.group())]
    recognised = []
    for word in words:
        tokens = canonical_tokens(word.get("text", ""))
        a, b = word.get("startSeconds"), word.get("endSeconds")
        if not tokens or not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
            continue
        if not math.isfinite(a) or not math.isfinite(b) or not 0 <= a < b:
            continue
        # A recogniser/native event can contain several canonical words. Give
        # each its own interval instead of dropping overlapping later words.
        for i, token in enumerate(tokens):
            recognised.append((token, a + (b-a)*i/len(tokens), b if i == len(tokens)-1 else a + (b-a)*(i+1)/len(tokens), len(tokens) > 1))
    recognised.sort(key=lambda item: item[1])
    slots = [None] * len(expected)

    def distribute(first, last, a, b):
        if b <= a or first == last:
            return
        weights = [max(1, len(expected[i][1])) for i in range(first, last)]
        total, used = sum(weights), 0
        for i, weight in zip(range(first, last), weights):
            slots[i] = [a + (b-a)*used/total, b if i == last-1 else a + (b-a)*(used+weight)/total, True]
            used += weight

    matcher = SequenceMatcher(None, [token for _, token in expected],
                              [token for token, *_ in recognised], autojunk=False)
    for kind, a, b, c, d in matcher.get_opcodes():
        if kind == "equal":
            for i, j in zip(range(a, b), range(c, d)):
                _, start, end, estimated = recognised[j]
                slots[i] = [start, end, estimated]
        elif kind == "replace":
            distribute(a, b, recognised[c][1], recognised[d-1][2])

    # Missing ASR words retain a source highlight between their timed neighbours.
    # These bounds are explicitly estimates, not evidence of correct wording.
    duration = seconds if isinstance(seconds, (int, float)) and math.isfinite(seconds) and seconds > 0 else (recognised[-1][2] if recognised else 0)
    i = 0
    while i < len(slots):
        if slots[i] is not None:
            i += 1
            continue
        end = i + 1
        while end < len(slots) and slots[end] is None:
            end += 1
        a = slots[i-1][1] if i else 0
        b = slots[end][0] if end < len(slots) else duration
        if b <= a and end < len(slots):
            b = a + max(0, slots[end][1] - a) * .5
            slots[end][0] = b
            slots[end][2] = True
        elif b <= a and i:
            a = slots[i-1][0] + (slots[i-1][1] - slots[i-1][0]) * .5
            slots[i-1][1] = a
            slots[i-1][2] = True
        distribute(i, end, a, b)
        i = end

    def original_span(start, end):
        delta = 0
        for mapping in mappings:
            a, b = mapping["spokenStart"], mapping["spokenEnd"]
            if start < b and end > a:
                return mapping["sourceStart"], mapping["sourceEnd"]
            if b <= start:
                delta += (mapping["sourceEnd"] - mapping["sourceStart"]) - (b - a)
        return start + delta, end + delta

    spans = []
    for (match, _), slot in zip(expected, slots):
        if slot is None:
            continue
        start, end = original_span(match.start(), match.end())
        if not 0 <= start < end <= len(written):
            continue
        a, b, estimated = slot
        previous = spans[-1] if spans else None
        if previous and (previous["sourceStart"], previous["sourceEnd"]) == (start, end):
            previous["endSeconds"] = max(previous["endSeconds"], b)
            previous["estimated"] |= estimated
        elif previous and previous["sourceEnd"] <= start and not re.search(r"\s", written[previous["sourceStart"]:end]) and a <= previous["endSeconds"] + .001:
            previous.update(sourceEnd=end, text=written[previous["sourceStart"]:end], endSeconds=b,
                            estimated=previous["estimated"] or estimated)
        else:
            spans.append(dict(text=written[start:end], sourceStart=start, sourceEnd=end,
                              startSeconds=a, endSeconds=b, estimated=estimated))
    result = []
    for span in spans:
        # A pronunciation replacement may cover a phrase. Highlight its authored
        # words individually, never a whole sentence as one word.
        tokens = list(re.finditer(r"\S+", span["text"]))
        for i, token in enumerate(tokens):
            a, b = span["startSeconds"], span["endSeconds"]
            start = span["sourceStart"] + token.start()
            result.append(dict(text=token.group(), sourceStart=start, sourceEnd=start + len(token.group()),
                               startSeconds=a + (b-a)*i/len(tokens), endSeconds=b if i == len(tokens)-1 else a + (b-a)*(i+1)/len(tokens),
                               estimated=span["estimated"] or len(tokens) > 1))
    return result


def subtitles(job, format="srt"):
    if format not in {"srt", "lrc"}:
        raise ValueError("Choose SRT or LRC subtitles.")
    lines = []
    def stamp(seconds):
        ms = round(max(0, seconds) * 1000)
        if format == "lrc":
            return f"[{ms // 60000:02}:{ms // 1000 % 60:02}.{ms % 1000 // 10:02}]"
        return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"
    for chunk in job["chunks"]:
        start = chunk.get("startSeconds", 0)
        text = chunk["text"].strip()
        if not text:
            continue
        if format == "lrc":
            lines.append(stamp(start) + text.replace("\n", " "))
        else:
            lines.append(f"{len(lines)+1}\n{stamp(start)} --> {stamp(start + chunk.get('seconds', 0))}\n{text}\n")
    return "\n".join(lines)
