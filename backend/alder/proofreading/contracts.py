"""Source-bound corrections shared by deterministic and generative engines."""
from __future__ import annotations

from collections import Counter
from difflib import SequenceMatcher
import hashlib
import json
import re

from ..models import ValidationError

DIALECTS = ("en-AU", "en-GB", "en-US")
MAX_TEXT = 1_000_000
MAX_BLOCK = 2400
MAX_FINDINGS = 2000


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
    dialect = supplied.get("dialect", settings.get("proofreadingDialect", project.get("language", "en")))
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


def blocks(text: str):
    """Keep structural boundaries and split long paragraphs only at sentence endings."""
    for match in re.finditer(r"[^\n\t]+", text):
        paragraph = match.group()
        position = 0
        while position < len(paragraph):
            end = len(paragraph)
            if end - position > MAX_BLOCK:
                boundaries = list(re.finditer(r'[.!?][\u201d\u2019"\']?\s+', paragraph[position:position + MAX_BLOCK]))
                if boundaries:
                    end = position + boundaries[-1].end()
                else:
                    # A single oversized sentence remains visible as unchecked coverage.
                    boundary = re.search(r'[.!?][\u201d\u2019"\']?\s+', paragraph[position:])
                    end = position + boundary.end() if boundary else len(paragraph)
            passage = paragraph[position:end]
            if passage.strip():
                yield {"text": passage, "start": u16(text, match.start() + position),
                       "id": str(match.start() + position), "hash": fingerprint(passage),
                       "eligible": len(passage) <= MAX_BLOCK}
            position = end


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
