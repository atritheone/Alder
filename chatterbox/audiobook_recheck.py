"""Recheck saved ASR transcripts against the current orthographic rules."""
import json
import os
from pathlib import Path
from audiobook_qa import compare

ROOT = Path(os.environ["LOCALAPPDATA"]) / "chatterbox/audiobooks/her-many-faces"


def update(part):
    before = part["accepted"]
    for item in part["asr"]:
        item.update(compare(part["text"], item["transcript"]))
    part["accepted"] = part["plausible_duration"] and any(x["accepted"] for x in part["asr"])
    if part["accepted"] and not before:
        part["review_note"] = "Accepted after review of an orthographic transcription difference; original audio unchanged."
    return part["accepted"] != before


for path in sorted(ROOT.glob("track-*/*.json")):
    if path.name == "packaged.json":
        continue
    data = json.loads(path.read_text(encoding="utf-8"))
    if "parts" in data:
        changed = any([update(p) for p in data["parts"]])
        data["accepted"] = all(p["accepted"] for p in data["parts"])
    elif "asr" in data:
        changed = update(data)
    else:
        continue
    if changed:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)
        if path.name.endswith("-selected.json"):
            print(path.parent.name, path.name, "resolved" if data["accepted"] else "review")
