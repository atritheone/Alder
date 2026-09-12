"""Portable document validation and project templates.

The server stores semantic JSON, not HTML. Unknown project metadata is retained;
document structures and every relationship are checked before acknowledgment.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
import math
import re
from typing import Any
from uuid import uuid4


class ValidationError(ValueError):
    pass


def uid(prefix: str = "") -> str:
    return prefix + uuid4().hex


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def text_document(text: str) -> dict:
    return {"type": "doc", "content": [
        {"type": "paragraph", **({"content": [{"type": "text", "text": line}]} if line else {})}
        for line in text.split("\n")
    ]}


def document_text(document: dict) -> str:
    """Stable, lossless text projection of supported blocks, using LF boundaries."""
    kind = document.get("type", "")
    if kind == "text":
        return document.get("text", "")
    if kind in ("hardBreak", "hard_break"):
        return "\n"
    if kind == "image":
        return ""
    if kind in ("horizontalRule", "horizontal_rule", "pageBreak", "page_break"):
        return ""
    parts = [document_text(child) for child in document.get("content", [])]
    if kind in ("tableRow", "table_row"):
        return "\t".join(parts)
    if kind in ("doc", "blockquote", "bulletList", "bullet_list", "orderedList", "ordered_list",
                "listItem", "list_item", "table", "tableCell", "table_cell", "tableHeader", "table_header"):
        return "\n".join(parts)
    return "".join(parts)


NODE_TYPES = {
    "doc", "paragraph", "heading", "text", "hardBreak", "hard_break", "blockquote",
    "codeBlock", "code_block", "bulletList", "bullet_list", "orderedList", "ordered_list",
    "listItem", "list_item", "horizontalRule", "horizontal_rule", "image", "table",
    "tableRow", "table_row", "tableCell", "table_cell", "tableHeader", "table_header",
    "pageBreak", "page_break", "footnote", "footnoteReference", "crossReference",
}
MARK_TYPES = {"bold", "strong", "italic", "em", "underline", "strike", "s", "code", "link",
              "textStyle", "text_style", "highlight", "subscript", "superscript", "color", "fontFamily", "fontSize"}


def validate_document(document: Any) -> dict:
    if not isinstance(document, dict) or document.get("type") != "doc":
        raise ValidationError("A draft document must have a doc root.")
    count = 0

    def walk(node: Any, depth: int) -> None:
        nonlocal count
        count += 1
        if count > 250_000 or depth > 50:
            raise ValidationError("Document structure is too large or deeply nested.")
        if not isinstance(node, dict) or node.get("type") not in NODE_TYPES:
            raise ValidationError(f"Unsupported document node: {node.get('type') if isinstance(node, dict) else node!r}")
        if node["type"] == "text" and not isinstance(node.get("text"), str):
            raise ValidationError("A text node needs text.")
        children = node.get("content", [])
        if not isinstance(children, list):
            raise ValidationError("Document content must be an array.")
        attrs = node.get("attrs", {}) or {}
        if not isinstance(attrs, dict):
            raise ValidationError("Node attributes must be an object.")
        for key in ("src", "href"):
            value = attrs.get(key)
            if value and (not isinstance(value, str) or re.match(r"\s*(?:javascript|vbscript|data|file):", value, re.I)):
                raise ValidationError("Unsafe document URL.")
        marks = node.get("marks", [])
        if not isinstance(marks, list):
            raise ValidationError("Formatting marks must be an array.")
        for mark in marks:
            if not isinstance(mark, dict) or mark.get("type") not in MARK_TYPES:
                raise ValidationError("Unsupported formatting mark.")
            if mark.get("attrs") is not None and not isinstance(mark["attrs"], dict):
                raise ValidationError("Mark attributes must be an object.")
            href = (mark.get("attrs") or {}).get("href")
            if href and (not isinstance(href, str) or re.match(r"\s*(?:javascript|vbscript|data|file):", href, re.I)):
                raise ValidationError("Unsafe link URL.")
        for child in children:
            walk(child, depth + 1)

    walk(document, 0)
    return document


def _identity(value: Any, description: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", value):
        raise ValidationError(f"Invalid {description} identifier.")
    return value


def validate_project(raw: Any, previous: dict | None = None) -> dict:
    if not isinstance(raw, dict):
        raise ValidationError("Project must be a JSON object.")
    try:
        serial = json.dumps(raw, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError, RecursionError) as exc:
        raise ValidationError("Project must contain finite JSON values.") from exc
    if len(serial.encode("utf-8")) > 40_000_000:
        raise ValidationError("Project exceeds the 40 MB structured-text limit.")
    p = deepcopy(raw)
    _identity(p.get("id"), "project")
    if p.get("schemaVersion", 1) != 1:
        raise ValidationError("This project uses an unsupported schema version. Its source has been preserved.")
    p["schemaVersion"] = 1
    if not isinstance(p.get("name"), str) or not p["name"].strip() or len(p["name"]) > 300:
        raise ValidationError("Project name must contain 1–300 characters.")
    p["language"] = p.get("language") or "en"
    if not isinstance(p["language"], str) or len(p["language"]) > 40:
        raise ValidationError("Invalid language tag.")
    all_ids: set[str] = set()

    def register(item: dict, kind: str) -> str:
        if not isinstance(item, dict):
            raise ValidationError(f"Each {kind} must be an object.")
        identifier = _identity(item.get("id"), kind)
        if identifier in all_ids:
            raise ValidationError(f"Duplicate identifier: {identifier}")
        all_ids.add(identifier)
        return identifier

    for kind in ("tracks", "clips", "placements", "sections", "ideas", "dictionary", "pronunciation", "styles", "assets"):
        if not isinstance(p.setdefault(kind, []), list) or len(p[kind]) > 50_000:
            raise ValidationError(f"{kind} must be an array with at most 50,000 entries.")
    tracks = {register(t, "track") for t in p["tracks"]}
    sections = {register(s, "section") for s in p["sections"]}
    assets = {register(a, "asset") for a in p["assets"]}
    for asset in p["assets"]:
        if asset.get("path") and (not isinstance(asset["path"], str) or not re.fullmatch(r"[A-Fa-f0-9]{64}(?:\.[a-zA-Z0-9]{1,12})?", asset["path"])):
            raise ValidationError("Assets must use controlled content-addressed paths.")
    for kind in ("ideas", "pronunciation", "styles"):
        for item in p[kind]:
            register(item, kind)
    for row in p["dictionary"]:
        if not isinstance(row, dict) or not isinstance(row.get("word"), str) or not row["word"].strip():
            raise ValidationError("Dictionary entries require a word.")
        if row.get("id"):
            register(row, "dictionary entry")
        if not isinstance(row.get("definition", ""), str) or row.get("preferred") is not None and not isinstance(row["preferred"], str):
            raise ValidationError("Dictionary definitions and preferred terms must be text.")
    for sample in p["ideas"]:
        if not isinstance(sample.get("word"), str) or not sample["word"].strip():
            raise ValidationError("An idea sample requires a word or expression.")
        sample.setdefault("category", "Uncategorised")
        sample.setdefault("definition", "")
        sample.setdefault("pos", "")
        sample.setdefault("examples", [])
        sample.setdefault("tags", [])
    for pronunciation in p["pronunciation"]:
        if not isinstance(pronunciation.get("word"), str) or not pronunciation["word"].strip() or not isinstance(pronunciation.get("spoken"), str):
            raise ValidationError("Pronunciations require a source word and a spoken form.")
        if not isinstance(pronunciation.get("regex", False), bool):
            raise ValidationError("Pronunciation match mode must be true or false.")
        if pronunciation.get("regex"):
            import regex
            try:
                regex.compile(pronunciation["word"])
            except regex.error as exc:
                raise ValidationError(f"Invalid pronunciation expression: {exc}") from exc
    for track in p["tracks"]:
        track.setdefault("voiceId", "default")
        track.setdefault("muted", False)
        track.setdefault("solo", False)
        track.setdefault("role", "draft")
        track.setdefault("color", "#94a4ff")
        if not isinstance(track.setdefault("devices", []), list):
            raise ValidationError("Track devices must be an array.")
        for device in track["devices"]:
            register(device, "device")
            if not isinstance(device.get("type"), str):
                raise ValidationError("A device requires a type.")
            device.setdefault("enabled", True)
            if not isinstance(device.setdefault("settings", {}), dict):
                raise ValidationError("Device settings must be an object.")
    old_clips = {c["id"]: c for c in (previous or {}).get("clips", [])}
    clips: set[str] = set()
    slots: set[tuple[str, int]] = set()
    for clip in p["clips"]:
        clips.add(register(clip, "clip"))
        if clip.get("trackId") not in tracks:
            raise ValidationError(f"Draft {clip['id']} refers to a missing collection.")
        slot = clip.setdefault("slot", 0)
        if not isinstance(slot, int) or isinstance(slot, bool) or not 0 <= slot <= 100_000:
            raise ValidationError("Draft slot must be a nonnegative integer.")
        position = clip["trackId"], slot
        if position in slots:
            raise ValidationError("Two drafts cannot occupy the same track slot.")
        slots.add(position)
        clip["document"] = validate_document(clip.get("document"))
        clip["text"] = document_text(clip["document"])
        clip.setdefault("title", "Untitled draft")
        clip.setdefault("tags", [])
        clip.setdefault("language", p["language"])
        clip.setdefault("voiceId", None)
        variants: set[str] = set()
        if not isinstance(clip.setdefault("variants", []), list):
            raise ValidationError("Draft variants must be an array.")
        for variant in clip["variants"]:
            variants.add(register(variant, "variant"))
            variant["document"] = validate_document(variant.get("document"))
            variant["text"] = document_text(variant["document"])
            variant.setdefault("createdAt", now())
        if clip.setdefault("activeVariantId", None) is not None and clip["activeVariantId"] not in variants:
            raise ValidationError("Active variant does not exist in this draft.")
        old = old_clips.get(clip["id"])
        if old:
            changed = any(clip.get(k) != old.get(k) for k in ("document", "activeVariantId", "variants", "voiceId", "language"))
            clip["revision"] = old.get("revision", 1) + int(changed)
        else:
            clip["revision"] = max(1, int(clip.get("revision", 1)))
    for placement in p["placements"]:
        register(placement, "placement")
        if placement.get("clipId") not in clips or placement.get("sectionId") not in sections:
            raise ValidationError("A placement refers to a missing draft or section.")
        if placement.get("variantId"):
            clip = next(c for c in p["clips"] if c["id"] == placement["clipId"])
            if placement["variantId"] not in {v["id"] for v in clip["variants"]}:
                raise ValidationError("Placement variant does not belong to its draft.")
        placement.setdefault("include", True)
        if placement.get("frozenDocument") is not None:
            placement["frozenDocument"] = validate_document(placement["frozenDocument"])
            placement["frozenText"] = document_text(placement["frozenDocument"])
        else:
            placement["frozenDocument"] = None
            placement["frozenText"] = None
    for entry in p["placements"] + p["sections"]:
        order = entry.setdefault("order", 0)
        if not isinstance(order, (int, float)) or isinstance(order, bool) or not math.isfinite(order):
            raise ValidationError("Section and placement order must be a finite number.")
    for section in p["sections"]:
        section.setdefault("title", "Untitled section")
        section.setdefault("role", "chapter")
    if not isinstance(p.setdefault("settings", {}), dict):
        raise ValidationError("Project settings must be an object.")
    defaults = {"author": "", "description": "", "pageSize": "A4", "marginMm": 22,
                "fontFamily": "Sitka Text", "fontSize": 12, "lineHeight": 1.6, "header": "", "footer": True}
    for k, v in defaults.items():
        p["settings"].setdefault(k, v)
    for prop, low, high in (("marginMm", 0, 100), ("fontSize", 6, 96), ("lineHeight", 0.8, 4)):
        value = p["settings"][prop]
        if not isinstance(value, (int, float)) or not low <= value <= high:
            raise ValidationError(f"Invalid document setting: {prop}.")
    for field in ("rules", "customRules", "ignoredRules", "ignoredRuleIds"):
        if not isinstance(p["settings"].get(field, []), list):
            raise ValidationError(f"{field} must be an array.")
    for field in ("ignoredRules", "ignoredRuleIds"):
        if not all(isinstance(value, str) for value in p["settings"].get(field, [])):
            raise ValidationError(f"{field} must contain rule names or identifiers.")
    custom_rules = p["settings"].get("customRules", [])
    if len(custom_rules) > 200:
        raise ValidationError("A project supports up to 200 custom language rules.")
    for custom_rule in custom_rules:
        register(custom_rule, "custom rule")
        match = custom_rule.get("match")
        if not isinstance(match, str) or not match.strip() or len(match) > 3000:
            raise ValidationError("A custom rule needs a nonempty literal match of at most 3,000 characters.")
        for field, default, maximum in (("name", "Custom rule", 200), ("replacement", "", 10000), ("message", "A project language rule matched this wording.", 2000)):
            value = custom_rule.setdefault(field, default)
            if not isinstance(value, str) or len(value) > maximum:
                raise ValidationError(f"Invalid custom rule {field}.")
        for field, default in (("enabled", True), ("caseSensitive", False), ("wholeWord", True)):
            if not isinstance(custom_rule.setdefault(field, default), bool):
                raise ValidationError(f"Custom rule {field} must be true or false.")

    def verify_assets(node):
        attrs = node.get("attrs") or {}
        reference = attrs.get("assetId")
        source = attrs.get("src", "")
        if not reference and isinstance(source, str) and source.startswith("asset:"):
            reference = source[6:]
        if reference and reference not in assets:
            raise ValidationError("A document image refers to a missing project asset.")
        if reference:
            attrs["assetId"] = reference
            attrs["src"] = f"/api/projects/{p['id']}/assets/{reference}"
            node["attrs"] = attrs
        for child in node.get("content", []):
            verify_assets(child)

    for clip in p["clips"]:
        verify_assets(clip["document"])
        for variant in clip["variants"]:
            verify_assets(variant["document"])
    for placement in p["placements"]:
        if placement["frozenDocument"]:
            verify_assets(placement["frozenDocument"])
    if "book" in p:
        book = p["book"]
        if not isinstance(book, dict) or book.get("version") != 1:
            raise ValidationError("Unsupported book format. The original project has been preserved.")
        chapters = book.get("chapters")
        if not isinstance(chapters, list) or not 1 <= len(chapters) <= 10000:
            raise ValidationError("A book requires between 1 and 10,000 chapters.")
        for chapter in chapters:
            register(chapter, "chapter")
            if not isinstance(chapter.get("title"), str) or not chapter["title"].strip() or len(chapter["title"]) > 300:
                raise ValidationError("A chapter requires a title of 1–300 characters.")
            chapter["document"] = validate_document(chapter.get("document"))
            chapter["text"] = document_text(chapter["document"])
            chapter.setdefault("include", True)
            if not isinstance(chapter["include"], bool):
                raise ValidationError("Chapter inclusion must be true or false.")
            if chapter.get("voiceId") is not None and not isinstance(chapter["voiceId"], str):
                raise ValidationError("A chapter voice must be an identifier.")
            verify_assets(chapter["document"])
    p.setdefault("createdAt", now())
    p.setdefault("updatedAt", p["createdAt"])
    return p


def create_project(name: str | None = None, template: str = "demo") -> dict:
    if template not in {"demo", "blank", "essay", "book"}:
        raise ValidationError("Unknown project template.")
    project_id = uid("project_")
    tracks = [
        {"id": uid("track_"), "name": "Ideas", "color": "#96a5ff", "role": "ideas", "devices": []},
        {"id": uid("track_"), "name": "Narrator", "color": "#6589df", "role": "draft", "devices": []},
        {"id": uid("track_"), "name": "Dialogue", "color": "#5fc6b2", "role": "narration", "devices": []},
        {"id": uid("track_"), "name": "Research", "color": "#d6bd77", "role": "reference", "devices": []},
    ]
    sections = [{"id": uid("section_"), "title": "Introduction" if template != "blank" else "Section 1", "role": "introduction", "order": 0}]
    if template == "book":
        sections.extend({"id": uid("section_"), "title": title, "role": role, "order": i}
                        for i, (title, role) in enumerate([( "Chapter One", "chapter"), ("Afterword", "backmatter")], 1))
    clips = []

    def add(track: int, slot: int, title: str, text: str) -> dict:
        clip = {"id": uid("clip_"), "trackId": tracks[track]["id"], "slot": slot, "title": title,
                "document": text_document(text), "variants": [], "activeVariantId": None, "tags": []}
        clips.append(clip)
        return clip

    placements = []
    if template == "demo":
        add(0, 0, "I · a prime idea", "I")
        add(0, 1, "A place to begin", "Every thought begins somewhere. A word becomes a phrase; a phrase becomes a world.")
        first = add(1, 0, "The shape of a thought", "I keep a small collection of beginnings. A sentence overheard on the train. A name without a character. The colour of the sky before rain.\nHere, language is material: something to gather, arrange, listen to, and shape.")
        first["variants"] = [{"id": uid("variant_"), "name": "A quieter opening", "document": text_document("I collect beginnings. A voice on the train, a name without a story, the sky before rain.\nLanguage takes shape when we give it room."), "createdAt": now()}]
        second = add(1, 1, "Room for discovery", "Move these passages into a new order. Try another word. Keep both versions. Read them aloud, and notice what changes.\nAlder is a workshop for language, from the first idea to the finished page.")
        add(2, 0, "Listen to the rhythm", "Some sentences move slowly. Others run. Listen for the pause between them.")
        add(3, 0, "A note on the process", "Begin with a word. Follow its associations. Preserve the alternatives that still interest you.")
        placements = [{"id": uid("placement_"), "clipId": c["id"], "sectionId": sections[0]["id"], "order": i, "include": True}
                      for i, c in enumerate((first, second))]
        tracks[1]["devices"] = [{"id": uid("device_"), "type": "repetition", "enabled": True, "settings": {}},
                                   {"id": uid("device_"), "type": "verbosity", "enabled": True, "settings": {}}]
    else:
        first = add(1, 0, "First passage", "")
        placements = [{"id": uid("placement_"), "clipId": first["id"], "sectionId": sections[0]["id"], "order": 0}]
    return validate_project({"id": project_id, "name": name or {"demo": "Alder · First Light", "blank": "Untitled", "essay": "New essay", "book": "New book"}[template],
                             "revision": 1, "schemaVersion": 1, "createdAt": now(), "updatedAt": now(), "language": "en",
                             "tracks": tracks, "clips": clips, "placements": placements, "sections": sections,
                             "ideas": [], "dictionary": [], "pronunciation": [], "assets": [],
                             "styles": [{"id": uid("style_"), "name": "Body", "fontFamily": "Sitka Text", "fontSize": 12, "lineHeight": 1.6, "spaceAfter": 8},
                                        {"id": uid("style_"), "name": "Heading", "fontFamily": "Sitka Text", "fontSize": 24, "lineHeight": 1.2, "spaceAfter": 14}],
                             "settings": {"description": "A language workstation for ideas, drafts, and finished work."}})
