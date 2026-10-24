"""Cross-check both final formats, write delivery notes, and remove staging duplicates."""
from datetime import datetime
import json
from pathlib import Path

from audiobook_formats import ROOT, sha256


def write_notes(plan, mp3_report, flac_report, output):
    notes = output / "Production notes"
    total = round(mp3_report["total_duration_seconds"])
    duration = f"{total//3600}:{total%3600//60:02d}:{total%60:02d}"
    count = len(plan["tracks"])
    sections = sum(r["sections"] for r in mp3_report["files"])
    short_title = plan.get("short_title", plan["title"].split(":", 1)[0])
    subtitle = plan.get("subtitle", plan["title"].partition(":")[2].strip())
    author = plan.get("author", "Natalie")
    opening = plan.get("opening", plan["tracks"][0]["paragraphs"][0])
    byline = " · ".join(s for s in (subtitle, author) if s)
    rows = []
    for track, audio in zip(plan["tracks"], mp3_report["files"]):
        seconds = round(audio["duration_seconds"])
        title = track.get("metadata_title", track["title"])
        rows.append(f"| {track['track']:02d}. | {title} | {track['group']} | {seconds//60}:{seconds%60:02d} |")
    text = f"""# {short_title}

{byline}

{count} tracks in each format · Total running time: {duration}

- **FLAC/**: lossless, 24-bit, 24 kHz, mono; made directly from the retained PCM masters.
- **MP3/**: 128 kbps, 24 kHz, mono.
- Each folder includes a playlist and the supplied cover. The cover is also embedded in every audio file.

Each file has one second of silence added at the start and end. British spelling is
preserved in the reading script and delivery text. Track numbers run from 1 to {count};
chapter numbers follow the source book. Separate tracks introduce each book part.
Chapter metadata titles begin with “Chapter”; book parts are stored in the grouping field.
Filenames use “01. ”, “02. ” and the same continuous track numbering.

The introduction opens with: “{opening}”.

All {sections} text sections were checked by local speech recognition, with retries and
review of discrepancies. The final audit also checks complete reading-script coverage,
audio decoding, durations, quiet padding, metadata, cover hashes, and file order.
These are automated content and file checks; they do not constitute a human listening review.
The narration uses Chatterbox with the supplied voice reference and retains its watermark.

| Track | Title | Grouping | Duration |
| --- | --- | --- | --- |
{chr(10).join(rows)}

The **Production notes/** folder contains the reading script, quality reports, and checksums.
"""
    (output / "README.md").write_text(text, encoding="utf-8")
    method = f"""# {short_title} audiobook production

Source: the user-supplied AZW3 by {author}. Voice reference and cover art are the
user-supplied MP3 and PNG. Their hashes are recorded in the production plan.
Production date: {plan.get('production_date', 'not separately recorded')}.

Final folder: `{output}`.
Working files and resumable checkpoints: `{ROOT}`.

The sequence contains {count} tracks in source reading order. The introduction is
first, separate short files introduce book parts, each chapter is one file, and
any closing text follows the chapters. Chapter numbers follow the original source;
track numbers are continuous. Chapter metadata titles start with `Chapter`, without
a book prefix. Book names remain in the grouping field and book-start titles.
Both format folders use filename prefixes `01. `, `02. ` and so on.
The introduction begins with: {opening}
The title page and table of contents are not read separately.

Each track has two outputs: 24-bit FLAC and 128 kbps MP3, both mono at 24 kHz.
The FLAC comes directly from retained PCM masters and is not transcoded from MP3.
The synthesis sections are stored as 16-bit PCM; assembly and normalisation use
a 24-bit master and lossless export. MP3 uses ID3v2.3; FLAC uses Vorbis comments.
Both have the exact original PNG embedded as their front cover. Tags identify
{author} as author/album artist and {plan['narrator']} as narrator. Unknown publisher,
copyright, and publication-date fields are not invented. Each file receives one
second of padding at both ends, after loudness normalisation (target -19 LUFS,
true peak -3 dBTP).

Text is extracted in EPUB spine order and split into short sections, preserving
the body words. Each generated section is independently transcribed locally.
Acceptance requires a word match after normalising punctuation, capitalisation,
numerals, and explicitly listed spelling variants. Mismatches trigger retries;
persistent failures are split further, then held for review. Only accepted sections
are assembled. This checks spoken content; it does not rate acting or prosody.
Chatterbox's watermark remains enabled. The source text keeps its British spelling.
American spellings returned by speech recognisers are treated as transcription
variants; they are never substituted into the reading script.

The final audit checks source-input hashes, selected section and subsection coverage,
section order, retained audio hashes where recorded, MP3/FLAC decoding, duration,
clipping, a full second of quiet at both ends, tags, track counts, and the exact
cover hash. All {sections} selected sections passed. The output includes playlists,
checksums, the reading script, and quality reports.

Speech recognisers run locally in a separate QA environment while Chatterbox uses
the NVIDIA GPU. No book text or voice audio is sent to a remote synthesis or
transcription service. The automated checks do not constitute a full human
listening review.
"""
    (notes / "Production method.md").write_text(method, encoding="utf-8")
    (notes / "Production plan.json").write_text(json.dumps(plan, indent=2, ensure_ascii=False), encoding="utf-8")
    for source, target in [("third-pass-review.json", "Additional speech review.json"),
                           ("runtime-provenance.json", "Runtime provenance.json")]:
        if (ROOT / source).is_file():
            (notes / target).write_bytes((ROOT / source).read_bytes())
    (notes / "FLAC SHA256SUMS.txt").write_text("\n".join(f"{r['sha256']}  {r['file']}" for r in flac_report) + "\n", encoding="utf-8")
    return duration


def main():
    plan = json.loads((ROOT / "plan.json").read_text(encoding="utf-8"))
    output = Path(plan["output"]).resolve()
    notes = output / "Production notes"
    mp3_report = json.loads((notes / "Quality report.json").read_text(encoding="utf-8"))
    flac_report = json.loads((notes / "FLAC quality report.json").read_text(encoding="utf-8"))
    total = len(plan["tracks"])
    assert len(mp3_report["files"]) == len(flac_report) == total and total > 0
    assert [t["track"] for t in plan["tracks"]] == list(range(1, total + 1))
    for kind in ("source", "reference", "cover"):
        assert sha256(plan[kind]) == plan[f"{kind}_sha256"], f"Input changed: {kind}"
    duplicates = []
    for track, mp3, flac in zip(plan["tracks"], mp3_report["files"], flac_report):
        assert track["track"] == mp3["track"] == flac["track"]
        assert abs(mp3["duration_seconds"] - flac["seconds"]) < 0.01
        assert mp3["title"] == flac["title"] == track.get("metadata_title", track["title"])
        if track.get("chapter_number") is not None:
            assert mp3["title"].startswith(f"Chapter {track['chapter_number']} - ")
        if track.get("kind") == "book_title":
            assert mp3["title"].startswith("Book ") and track["paragraphs"] == [track["title"]]
        for item, folder, suffix in [(mp3, "MP3", ".mp3"), (flac, "FLAC", ".flac")]:
            file = (output / item["file"]).resolve()
            assert file.parent == output / folder
            assert file.name == f"{track['track']:02d}. {track['title']}{suffix}"
            assert sha256(file) == item["sha256"]
        assert flac["mp3_sha256"] == mp3["sha256"]
        # Only renderer-created duplicates directly within the selected output may
        # be removed, and only after all delivered files pass the final checks.
        duplicate = output / Path(mp3["file"]).name
        if duplicate.exists():
            assert duplicate.resolve().parent == output
            assert sha256(duplicate) == mp3["sha256"]
            duplicates.append(duplicate)
    assert len(list((output / "MP3").glob("*.mp3"))) == total
    assert len(list((output / "FLAC").glob("*.flac"))) == total
    assert set(output.glob("*.mp3")) == set(duplicates)
    short_title = plan.get("short_title", plan["title"].split(":", 1)[0])
    for folder in (output, output / "MP3", output / "FLAC"):
        assert sha256(folder / "Cover.png") == plan["cover_sha256"]
        assert (folder / f"{short_title}.m3u8").is_file()
    duration = write_notes(plan, mp3_report, flac_report, output)
    for duplicate in duplicates:
        duplicate.unlink()
    progress_file = ROOT / "progress.json"
    progress = json.loads(progress_file.read_text(encoding="utf-8")) if progress_file.exists() else {}
    progress.update({"status": "complete", "final_audit": "passed", "finished": datetime.now().isoformat(),
                     "production_date": plan.get("production_date"), "formats": ["FLAC", "MP3"],
                     "tracks_per_format": total, "duration": duration, "pending_in_track": 0,
                     "output": str(output), "tracks": mp3_report["files"]})
    progress_file.write_text(json.dumps(progress, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"output": str(output), "duration": duration, "files": total * 2, "status": "complete"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
