"""Audit coverage, encoded audio, padding, order, metadata, and cover art."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from zipfile import ZipFile
import xml.etree.ElementTree as ET
import numpy as np
from mutagen.mp3 import MP3
from audiobook_formats import DATA, ROOT, sha256
from audiobook_qa import compare


def check_extraction(plan):
    if not plan.get("extraction_audit"):
        return None  # Older plans predate the independent source-extraction report.
    audit_path = Path(plan["extraction_audit"])
    assert sha256(audit_path) == plan["extraction_audit_sha256"], "Extraction audit changed"
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    assert audit["status"] == "passed" and audit["toc_and_spine_agree"]
    assert audit["all_body_paragraphs_exactly_preserved"] and audit["independent_xml_parser_body_comparison"] == "passed"
    assert sha256(ROOT / "source.epub") == audit["epub_sha256"], "Converted source changed"
    assert len(audit["included_sections"]) == len(plan["tracks"])
    all_body = []
    included_files = []
    with ZipFile(ROOT / "source.epub") as archive:
        for track, section in zip(plan["tracks"], audit["included_sections"]):
            assert track["track"] == section["track"] and track["sources"] == section["sources"]
            assert track["source_section_id"] == section["section_id"]
            body = track["source_body"]
            digest = hashlib.sha256("\n\n".join(body).encode("utf-8")).hexdigest()
            assert digest == track["source_body_sha256"] == section["body_sha256"]
            assert len(body) == section["body_paragraphs"]
            prefix = 2 if track.get("kind") == "introduction" else 1
            assert track["paragraphs"][prefix:] == body, f"Narration omits or changes body: {track['title']}"
            from_epub = []
            for source in track["sources"]:
                document = ET.fromstring(archive.read(source))
                for p in document.findall(".//{http://www.w3.org/1999/xhtml}p"):
                    if set(p.attrib.get("class", "").split()) & {"first", "prose"}:
                        from_epub.append(" ".join("".join(p.itertext()).split()))
            assert from_epub == body, f"Source-body mismatch: {track['title']}"
            all_body.extend(body)
            included_files.extend(track["sources"])
    excluded_files = [item["source"] for item in audit["excluded_navigation_or_cover"]]
    assert len(included_files) == len(set(included_files))
    assert not set(included_files) & set(excluded_files)
    assert included_files == [f for f in audit["spine_files"] if f not in excluded_files]
    assert set(audit["spine_files"]) == set(included_files + excluded_files)
    digest = hashlib.sha256("\n\n".join(all_body).encode("utf-8")).hexdigest()
    assert digest == plan["source_body_sha256"] == audit["source_body_sha256"]
    assert len(all_body) == audit["source_body_paragraphs"]
    assert sum(len(p.split()) for p in all_body) == audit["source_body_words"]
    return audit


def check_selection(track, directory):
    selected = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(directory.glob("*-selected.json"))]
    assert selected and all(s["accepted"] for s in selected), f"Unverified sections in {directory}"
    assert " ".join(s["text"] for s in selected).split() == " ".join(track["paragraphs"]).split(), f"Text coverage failed: {directory}"
    for section in selected:
        assert section["parts"] and all(p["accepted"] for p in section["parts"]), f"Unverified subsection: {directory}"
        assert " ".join(p["text"] for p in section["parts"]).split() == section["text"].split(), f"Subsection text coverage failed: {directory}"
        for part in section["parts"]:
            assert part["plausible_duration"], f"Implausible speech duration: {part['file']}"
            assert any(compare(part["text"], result["transcript"])["accepted"] for result in part["asr"]), f"No matching independent transcript: {part['file']}"
            assert Path(part["file"]).is_file(), f"Selected audio is missing: {part['file']}"
            if part.get("sha256"):
                assert sha256(part["file"]) == part["sha256"], f"Selected audio changed: {part['file']}"
    return selected


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tracks", nargs="*", type=int)
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    plan = json.loads((ROOT / "plan.json").read_text(encoding="utf-8"))
    ffmpeg = next((DATA / "ffmpeg").glob("*/bin/ffmpeg.exe"))
    output = Path(plan["output"])
    total = len(plan["tracks"])
    assert total > 0 and [t["track"] for t in plan["tracks"]] == list(range(1, total + 1))
    assert plan["tracks"][0]["paragraphs"][0] == plan.get("opening", plan["tracks"][0]["paragraphs"][0])
    for kind in ("source", "reference", "cover"):
        assert sha256(plan[kind]) == plan[f"{kind}_sha256"], f"Input changed: {kind}"
    extraction = check_extraction(plan)
    audio_dir = output / "MP3" if (output / "MP3").is_dir() else output
    report = []
    for track in plan["tracks"]:
        if args.tracks and track["track"] not in args.tracks:
            continue
        directory = ROOT / f"track-{track['track']:02d}"
        info = json.loads((directory / "packaged.json").read_text(encoding="utf-8"))
        assert info["file"] == f"{track['track']:02d}. {track['title']}.mp3"
        file = audio_dir / info["file"]
        selected = check_selection(track, directory)
        assert info["sections"] == len(selected) and info["all_sections_asr_matched"] is True
        assert sha256(file) == info["sha256"]
        audio = MP3(file)
        assert audio.info.channels == 1 and audio.info.sample_rate == 24000 and audio.info.bitrate == 128000
        tags = audio.tags
        assert tags.version == (2, 3, 0), (file, tags.version)
        author = plan.get("author", "Natalie")
        expected = {"TIT2": track.get("metadata_title", track["title"]), "TALB": plan["title"], "TPE1": author, "TPE2": author, "TCOM": author,
                    "TPE3": plan["narrator"], "TRCK": f"{track['track']}/{total}", "TPOS": "1/1",
                    "TLAN": plan.get("language", "eng"), "TCON": "Audiobook", "TIT1": track["group"],
                    "TXXX:AUTHOR": author, "TXXX:NARRATOR": plan["narrator"], "TXXX:BOOK_PART": track["group"],
                    "TXXX:SOURCE_SHA256": plan["source_sha256"]}
        if plan.get("production_date"):
            expected["TXXX:PRODUCTION_DATE"] = plan["production_date"]
        if track.get("chapter_number") is not None:
            expected["TXXX:CHAPTER_NUMBER_WITHIN_BOOK"] = str(track["chapter_number"])
            assert expected["TIT2"].startswith(f"Chapter {track['chapter_number']} - ")
        for key, value in expected.items():
            assert str(tags[key]) == value, (file, key, str(tags[key]), value)
        assert str(tags["COMM::eng"]) == plan["description"]
        cover = tags.getall("APIC")
        assert len(cover) == 1 and cover[0].type == 3 and cover[0].mime == "image/png"
        assert hashlib.sha256(cover[0].data).hexdigest() == plan["cover_sha256"]
        decoded = subprocess.run([str(ffmpeg), "-v", "error", "-i", str(file), "-map", "0:a:0", "-f", "f32le", "-ac", "1", "-ar", "24000", "pipe:1"], capture_output=True, check=True)
        assert not decoded.stderr, decoded.stderr
        samples = np.frombuffer(decoded.stdout, dtype="<f4")
        assert len(samples) >= 48000 and np.isfinite(samples).all() and np.max(np.abs(samples)) < 0.99
        # MP3 can smear a boundary by a few milliseconds. Verify the requested
        # full-second intervals stay below -50 dBFS, including lossy codec ringing.
        leading_peak = float(np.max(np.abs(samples[:24000])))
        trailing_peak = float(np.max(np.abs(samples[-24000:])))
        assert leading_peak < 0.0032 and trailing_peak < 0.0032, (file, leading_peak, trailing_peak)
        item = {"track": track["track"], "title": track.get("metadata_title", track["title"]), "file": file.relative_to(output).as_posix(), "duration_seconds": len(samples) / 24000,
                "words": sum(len(p.split()) for p in track["paragraphs"]), "sections": len(selected),
                "verified_fragments": sum(len(s["parts"]) for s in selected), "coverage": "complete",
                "speech_verification": "word match after orthographic normalisation; original British wording preserved",
                "leading_1s_peak": leading_peak, "trailing_1s_peak": trailing_peak,
                "peak_dbfs": float(20 * np.log10(max(float(np.max(np.abs(samples))), 1e-12))),
                "metadata": "passed", "embedded_cover_sha256": plan["cover_sha256"], "sha256": info["sha256"]}
        report.append(item)
        print(f"PASS {track['track']:02d}: {len(samples) / 24000:.2f}s; padding, coverage, metadata, cover, decoding", flush=True)
    if not args.tracks:
        assert len(report) == total
        assert sorted(p.relative_to(output).as_posix() for p in audio_dir.glob("*.mp3")) == sorted(r["file"] for r in report)
        notes = output / "Production notes"
        notes.mkdir(exist_ok=True)
        if extraction is not None:
            shutil.copyfile(plan["extraction_audit"], notes / "Source extraction audit.json")
        (notes / "Quality report.json").write_text(json.dumps({"source_sha256": plan["source_sha256"],
            "reference_sha256": plan["reference_sha256"], "files": report,
            "total_duration_seconds": sum(r["duration_seconds"] for r in report),
            "total_words": sum(r["words"] for r in report), "total_sections": sum(r["sections"] for r in report),
            "production_date": plan.get("production_date"),
            "source_extraction": "passed" if extraction is not None else "legacy plan; not independently re-extracted",
            "source_body_sha256": plan.get("source_body_sha256")}, ensure_ascii=False, indent=2), encoding="utf-8")
        (notes / "Reading script.txt").write_text("\n\n".join(f"{t['track']:02d}. {t['title']}\n\n" + "\n\n".join(t["paragraphs"]) for t in plan["tracks"]), encoding="utf-8")
        playlist = plan.get("short_title", plan["title"].split(":", 1)[0]) + ".m3u8"
        (output / playlist).write_text("#EXTM3U\n" + "\n".join(f"#EXTINF:{r['duration_seconds']:.0f},{r['title']}\n{r['file']}" for r in report) + "\n", encoding="utf-8")
        (notes / "SHA256SUMS.txt").write_text("\n".join(f"{r['sha256']}  {r['file']}" for r in report) + "\n", encoding="utf-8")
        shutil.copyfile(plan["cover"], output / "Cover.png")
        print(f"COMPLETE: {len(report)} files, {sum(r['duration_seconds'] for r in report)/3600:.3f} hours")


if __name__ == "__main__":
    main()
