"""Audit coverage, encoded audio, padding, order, metadata, and cover art."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import numpy as np
from mutagen.mp3 import MP3

ROOT = Path(os.environ["LOCALAPPDATA"]) / "chatterbox/audiobooks/her-many-faces"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tracks", nargs="*", type=int)
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    plan = json.loads((ROOT / "plan.json").read_text(encoding="utf-8"))
    ffmpeg = next((ROOT.parents[1] / "ffmpeg").glob("*/bin/ffmpeg.exe"))
    output = Path(plan["output"])
    audio_dir = output / "MP3" if (output / "MP3").is_dir() else output
    report = []
    for track in plan["tracks"]:
        if args.tracks and track["track"] not in args.tracks:
            continue
        directory = ROOT / f"track-{track['track']:02d}"
        info = json.loads((directory / "packaged.json").read_text(encoding="utf-8"))
        file = audio_dir / info["file"]
        selected = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(directory.glob("*-selected.json"))]
        assert selected and all(s["accepted"] for s in selected), f"Unverified sections in {file}"
        assert " ".join(s["text"] for s in selected).split() == " ".join(track["paragraphs"]).split(), f"Text coverage failed: {file}"
        assert all(part["accepted"] for s in selected for part in s["parts"]), f"Unverified subsection: {file}"
        assert hashlib.sha256(file.read_bytes()).hexdigest() == info["sha256"]
        audio = MP3(file)
        tags = audio.tags
        expected = {"TIT2": track.get("metadata_title", track["title"]), "TALB": plan["title"], "TPE1": "Natalie", "TPE2": "Natalie", "TCOM": "Natalie",
                    "TPE3": plan["narrator"], "TRCK": f"{track['track']}/23", "TPOS": "1/1", "TLAN": "eng", "TCON": "Audiobook"}
        for key, value in expected.items():
            assert str(tags[key]) == value, (file, key, str(tags[key]), value)
        cover = tags.getall("APIC")
        assert len(cover) == 1 and cover[0].type == 3 and cover[0].mime == "image/png"
        assert hashlib.sha256(cover[0].data).hexdigest() == plan["cover_sha256"]
        decoded = subprocess.run([str(ffmpeg), "-v", "error", "-i", str(file), "-map", "0:a:0", "-f", "f32le", "-ac", "1", "-ar", "24000", "pipe:1"], capture_output=True, check=True)
        assert not decoded.stderr, decoded.stderr
        samples = np.frombuffer(decoded.stdout, dtype="<f4")
        assert np.isfinite(samples).all() and np.max(np.abs(samples)) < 0.99
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
        assert len(report) == 23
        assert sorted(p.relative_to(output).as_posix() for p in audio_dir.glob("*.mp3")) == sorted(r["file"] for r in report)
        notes = output / "Production notes"
        notes.mkdir(exist_ok=True)
        (notes / "Quality report.json").write_text(json.dumps({"source_sha256": plan["source_sha256"],
            "reference_sha256": plan["reference_sha256"], "files": report,
            "total_duration_seconds": sum(r["duration_seconds"] for r in report),
            "total_words": sum(r["words"] for r in report)}, ensure_ascii=False, indent=2), encoding="utf-8")
        (notes / "Reading script.txt").write_text("\n\n".join(f"{t['track']:02d} - {t['title']}\n\n" + "\n\n".join(t["paragraphs"]) for t in plan["tracks"]), encoding="utf-8")
        (output / "Her Many Faces.m3u8").write_text("#EXTM3U\n" + "\n".join(f"#EXTINF:{r['duration_seconds']:.0f},{r['title']}\n{r['file']}" for r in report) + "\n", encoding="utf-8")
        (notes / "SHA256SUMS.txt").write_text("\n".join(f"{r['sha256']}  {r['file']}" for r in report) + "\n", encoding="utf-8")
        shutil.copyfile(plan["cover"], output / "Cover.png")
        print(f"COMPLETE: {len(report)} files, {sum(r['duration_seconds'] for r in report)/3600:.3f} hours")


if __name__ == "__main__":
    main()
