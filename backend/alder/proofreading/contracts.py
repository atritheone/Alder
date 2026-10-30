"""Source-bound corrections shared by deterministic and generative engines."""
from __future__ import annotations

from collections import Counter
from difflib import SequenceMatcher
import hashlib
import json
import re

from ..models import ValidationError

DIALECTS = ("en-AU", "en-GB", "en-US")
MAX_BLOCK = 2400


def fingerprint(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode()).hexdigest()


def u16(text: str, index: int | None = None) -> int:
    return len((text if index is None else text[:index]).encode("utf-16-le")) // 2


def slice16(text: str, start: int, end: int) -> str:
    if type(start) is not int or type(end) is not int or not 0 <= start <= end <= u16(text):
        raise ValueError("Invalid text range")
    return text.encode("utf-16-le")[start * 2:end * 2].decode("utf-16-le")


def configuration(project: dict, supplied: dict | None = None) -> dict:
    supplied = {} if supplied is None else supplied
    if not isinstance(supplied, dict):
        raise ValidationError("Proofreading configuration must be an object.")
    settings = project.get("settings", {})
    fallback=project.get('language','en')
    if fallback not in DIALECTS:fallback='en-GB'
    dialect = supplied.get("dialect", settings.get("proofreadingDialect", fallback))
    if dialect == "en":
        dialect = "en-GB"
    if dialect not in DIALECTS:
        raise ValidationError("Choose Australian, British or US English for proofreading.")
    words = supplied.get("acceptedWords", [d["word"] for d in project.get("dictionary", [])])
    ignored = supplied.get("ignoredRuleIds", settings.get("ignoredRuleIds", []))
    for entries, limit, width in ((words, 5000, 200), (ignored, 1000, 200)):
        if not isinstance(entries, list) or len(entries) > limit or any(
            not isinstance(word, str) or not word.strip() or len(word) > width for word in entries
        ):
            raise ValidationError("Proofreading vocabulary or ignored rules are invalid.")
    style = supplied.get("style", settings.get("proofreadingStyle", False))
    if type(style) is not bool:
        raise ValidationError("The style-check setting must be a boolean.")
    return {"dialect": dialect, "acceptedWords": sorted(set(words)),
            "ignoredRuleIds": sorted(set(ignored)), "style": style}


def language_segments(text, ranges, default, selected=None):
    """Validate UTF-16 language ranges once, then clip without shifting source offsets."""
    if ranges is None:ranges=[]
    if not isinstance(ranges,list):raise ValidationError('Proofreading language ranges must be a list.')
    encoded=text.encode('utf-16-le');length=len(encoded)//2
    low,high=(selected['start'],selected['end']) if selected else (0,length)
    result=[];cursor=0
    def append(start,end,language):
        start=max(start,low);end=min(end,high)
        if end<=start:return
        passage=encoded[start*2:end*2].decode('utf-16-le')
        if result and result[-1]['language']==language and result[-1]['end']==start:
            result[-1]['text']+=passage;result[-1]['end']=end
        else:result.append({'text':passage,'start':start,'end':end,'language':language})
    try:
        for row in ranges:
            if not isinstance(row,dict) or set(row)!={'start','end','language'}:raise ValueError()
            start,end,language=row['start'],row['end'],row['language']
            if type(start) is not int or type(end) is not int or not cursor<=start<end<=length:raise ValueError()
            if not isinstance(language,str) or len(language)>40 or not re.fullmatch(r'[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*',language):raise ValueError()
            # Check both boundaries even when this range is outside selection.
            for at in (start,end):
                if 0<at<length and 0xdc00<=int.from_bytes(encoded[at*2:at*2+2],'little')<=0xdfff:raise ValueError()
            append(cursor,start,default);append(start,end,language);cursor=end
        append(cursor,length,default)
    except (ValueError,UnicodeError) as exc:raise ValidationError('Proofreading languages need ordered, non-overlapping Unicode text ranges.') from exc
    return result


def blocks(text: str):
    """Check every passage, using bounded engine requests without skipping long sentences."""
    cursor = offset = 0
    for match in re.finditer(r"[^\n\t]+", text):
        offset += u16(text[cursor:match.start()])
        paragraph = match.group()
        position = 0
        while position < len(paragraph):
            end = min(len(paragraph), position + MAX_BLOCK)
            if end < len(paragraph):
                window = paragraph[position:end]
                boundaries = list(re.finditer(r"[.!?][\u201d\u2019\"']?\s+", window))
                spaces = list(re.finditer(r"\s+", window)) if not boundaries else []
                if boundaries or spaces:
                    end = position + (boundaries or spaces)[-1].end()
            passage = paragraph[position:end]
            if passage.strip():
                yield {"text": passage, "start": offset,
                       "id": str(match.start() + position), "hash": fingerprint(passage),
                       "eligible": True}
            offset += u16(passage)
            position = end
        cursor = match.end()


def diagnostic(text, start, end, category, rule, message, replacements, engine, edits=None):
    original = slice16(text, start, end)
    alternatives = []
    for replacement in dict.fromkeys(replacements):
        if not isinstance(replacement, str) or len(replacement) > MAX_BLOCK or replacement == original:
            continue
        alternatives.append({"label": f"Replace with {replacement}" if replacement else "Delete",
                             "edits": edits or [{"start": start, "end": end,
                                                 "originalText": original, "replacement": replacement}]})
    result = {"id": fingerprint([rule, start, end, original, alternatives])[:24],
              "type": category, "rule": rule, "ruleId": rule, "start": start, "end": end,
              "originalText": original, "message": message, "alternatives": alternatives,
              "engine": engine, "reviewLevel": "possible-issue" if engine == "model" else "correction"}
    if replacements:
        result["suggestion"] = replacements[0]
    return result


def model_correction(text: str, corrected: str, accepted: list[str]) -> dict | None:
    """Turn one model proposal into an atomic group of small, validated edits."""
    if not isinstance(corrected, str) or text == corrected or len(corrected) > MAX_BLOCK + 200:
        return None
    if any(ch in corrected for ch in "\r\n\t") or not corrected.strip():
        return None
    typography = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'"})
    if text.translate(typography) == corrected.translate(typography):
        return None  # Quote typography alone is optional style, not a grammar error.
    # These conservative guards complement, rather than establish, semantic fidelity.
    protected = r"\b\d+(?:[.,:/-]\d+)*\b|https?://\S+|[$£€¥]|\b(?:pounds|dollars|euros|yen|kilometres|kilometers|metres|meters|kilograms|kg|cm|mm|km|not|never|no|must|may|might|shall|cannot|can't|won't|should|could)\b"
    if Counter(re.findall(protected, text, re.I)) != Counter(re.findall(protected, corrected, re.I)):
        return None
    for word in accepted:
        pattern = r"(?<!\w)" + re.escape(word) + r"(?!\w)"
        if len(re.findall(pattern, text, re.I)) != len(re.findall(pattern, corrected, re.I)):
            return None
    names = re.findall(r"\b[A-Z][a-z]+\b", text)
    sentence_words = {"A", "An", "The", "This", "That", "These", "Those", "He", "She", "It", "We", "You", "They",
                      "There", "Here", "Who", "What", "When", "Where", "Why", "How", "If", "As", "In", "On", "At",
                      "To", "For", "From", "By", "With", "Without", "And", "But", "Or", "So", "Yet", "Not", "No", "Yes"}
    for name in names:
        if name not in sentence_words and text.count(name) != corrected.count(name):
            return None
    matches = SequenceMatcher(None, text, corrected, autojunk=False).get_opcodes()
    edits = [{"start": u16(text, a), "end": u16(text, b), "originalText": text[a:b],
              "replacement": corrected[c:d]} for kind, a, b, c, d in matches if kind != "equal"]
    if not edits or len(edits) > 12:
        return None
    changed = sum(max(e["end"] - e["start"], u16(e["replacement"])) for e in edits)
    if changed > max(16, u16(text) * .30):
        return None
    return diagnostic(text, edits[0]["start"], edits[-1]["end"], "grammar", "model:context",
                      "Possible grammar issue. Review these linked changes in context.",
                      [corrected], "model", edits)


def shift(item: dict, offset: int) -> dict:
    # Caller owns this fresh result, never a cached engine object.
    item["start"] += offset
    item["end"] += offset
    for alternative in item.get("alternatives", []):
        for edit in alternative["edits"]:
            edit["start"] += offset
            edit["end"] += offset
    item["id"] = fingerprint([item["id"], offset])[:24]
    return item
