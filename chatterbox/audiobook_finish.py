"""Cross-check both final formats, write delivery notes, and remove staging duplicates."""
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil

ROOT = Path(os.environ["LOCALAPPDATA"]) / "chatterbox/audiobooks/her-many-faces"
plan = json.loads((ROOT / "plan.json").read_text(encoding="utf-8"))
output = Path(plan["output"]).resolve()
notes = output / "Production notes"
mp3_report = json.loads((notes / "Quality report.json").read_text(encoding="utf-8"))
flac_report = json.loads((notes / "FLAC quality report.json").read_text(encoding="utf-8"))
assert len(mp3_report["files"]) == len(flac_report) == len(plan["tracks"]) == 23
for kind, field in [("source", "source_sha256"), ("reference", "reference_sha256"), ("cover", "cover_sha256")]:
    assert hashlib.sha256(Path(plan[kind]).read_bytes()).hexdigest() == plan[field], f"Input changed: {kind}"
for track, mp3, flac in zip(plan["tracks"], mp3_report["files"], flac_report):
    assert track["track"] == mp3["track"] == flac["track"]
    assert abs(mp3["duration_seconds"] - flac["seconds"]) < 0.01
    assert mp3["title"] == flac["title"] == track["metadata_title"]
    if track["chapter_number"] is not None:
        assert track["metadata_title"].startswith("Chapter ") and not track["metadata_title"].startswith("Book ")
    for item in [mp3, flac]:
        file = output / item["file"]
        assert file.name.startswith(f"{track['track']:02d}. ")
        assert hashlib.sha256(file.read_bytes()).hexdigest() == item["sha256"]
    # These are renderer-created staging duplicates. Remove only after verifying
    # the delivered copy is byte-identical, and only within this named output root.
    duplicate = output / Path(mp3["file"]).name
    if duplicate.exists():
        assert duplicate.resolve().parent == output
        assert hashlib.sha256(duplicate.read_bytes()).hexdigest() == mp3["sha256"]
        duplicate.unlink()
assert not list(output.glob("*.mp3"))
assert len(list((output / "MP3").glob("*.mp3"))) == 23
assert len(list((output / "FLAC").glob("*.flac"))) == 23
total = round(mp3_report["total_duration_seconds"])
duration = f"{total//3600}:{total%3600//60:02d}:{total%60:02d}"
rows = []
for track, audio in zip(plan["tracks"], mp3_report["files"]):
    seconds = round(audio["duration_seconds"])
    rows.append(f"| {track['track']:02d}. | {track['metadata_title']} | {track['group']} | {seconds//60}:{seconds%60:02d} |")
text = f"""# Her Many Faces

Of The Goddess’s Secret and Interior Life · Natalie

23 tracks in each format · Total running time: {duration}

- **FLAC/**: lossless, 24-bit, 24 kHz, mono; made directly from the retained PCM masters.
- **MP3/**: 128 kbps, 24 kHz, mono.
- Each folder includes a playlist and the supplied cover. The cover is also embedded in every audio file.

Each file has one second of silence added at the start and end. British spelling is
preserved in the reading script and delivery text. Track numbers run from 1 to 23;
chapter numbers follow the original book and restart in each of its three parts.
Chapter metadata titles begin with “Chapter”; the book name is stored in the grouping field.

The introduction opens with: “Her Many Faces: Of The Goddess’s Secret and Interior Life by Natalie”.

All 905 text sections were checked by local speech recognition, with retries and
review of discrepancies. The final audit also checks complete source-text coverage,
audio decoding, durations, quiet padding, metadata, cover hashes, and file order.
These are automated content and file checks; they do not constitute a human listening review.
The narration uses Chatterbox with the supplied voice reference and retains its watermark.

| Track | Title | Grouping | Duration |
| --- | --- | --- | --- |
{chr(10).join(rows)}

The **Production notes/** folder contains the reading script, quality reports, and checksums.
"""
(output / "README.md").write_text(text, encoding="utf-8")
shutil.copyfile(Path(__file__).parent / "AUDIOBOOK-PRODUCTION.md", notes / "Production method.md")
(notes / "FLAC SHA256SUMS.txt").write_text("\n".join(f"{r['sha256']}  {r['file']}" for r in flac_report) + "\n", encoding="utf-8")
progress = json.loads((ROOT / "progress.json").read_text(encoding="utf-8"))
progress.update({"status": "complete", "final_audit": "passed", "finished": datetime.now().isoformat(),
                 "formats": ["FLAC", "MP3"], "tracks_per_format": 23, "duration": duration,
                 "pending_in_track": 0, "output": str(output), "tracks": mp3_report["files"]})
(ROOT / "progress.json").write_text(json.dumps(progress, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps({"output": str(output), "duration": duration, "files": 46, "status": "complete"}, ensure_ascii=False))
