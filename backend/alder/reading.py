"""Conservative mapping of audio word times to the author's unchanged text."""
from difflib import SequenceMatcher
import re


def word_timings(written, spoken, words, mappings=()):
    expected = list(re.finditer(r"\w+(?:['’]\w+)*", spoken, re.UNICODE))
    recognised = [(word, match.group().casefold()) for word in words for match in re.finditer(r"\w+(?:['’]\w+)*", word.get("text", ""), re.UNICODE)]
    result = []
    def original_span(start, end):
        delta = 0
        for mapping in mappings:
            a, b = mapping["spokenStart"], mapping["spokenEnd"]
            if start < b and end > a:
                return mapping["sourceStart"], mapping["sourceEnd"]
            if b <= start:
                delta += (mapping["sourceEnd"] - mapping["sourceStart"]) - (b - a)
        return start + delta, end + delta
    matcher = SequenceMatcher(None, [m.group().casefold() for m in expected], [v for _, v in recognised], autojunk=False)
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            match = expected[block.a + offset]
            word = recognised[block.b + offset][0]
            start, end = original_span(match.start(), match.end())
            if 0 <= start < end <= len(written):
                result.append({"text": written[start:end], "sourceStart": start, "sourceEnd": end,
                    "startSeconds": word["startSeconds"], "endSeconds": word["endSeconds"]})
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
