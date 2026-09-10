"""Make FLAC directly from lossless masters and organize both delivery formats."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
from mutagen.flac import FLAC, Picture
import numpy as np

ROOT = Path(os.environ["LOCALAPPDATA"]) / "chatterbox/audiobooks/her-many-faces"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ready-only", action="store_true")
    args = parser.parse_args()
    plan = json.loads((ROOT / "plan.json").read_text(encoding="utf-8"))
    output = Path(plan["output"])
    flac_dir, mp3_dir = output / "FLAC", output / "MP3"
    flac_dir.mkdir(exist_ok=True)
    mp3_dir.mkdir(exist_ok=True)
    ffmpeg = str(next((ROOT.parents[1] / "ffmpeg").glob("*/bin/ffmpeg.exe")))
    cover = Path(plan["cover"]).read_bytes()
    report = []
    for track in plan["tracks"]:
        directory = ROOT / f"track-{track['track']:02d}"
        packaged = directory / "packaged.json"
        if not packaged.exists():
            if args.ready_only:
                continue
            raise RuntimeError(f"Track {track['track']} not ready")
        metadata = json.loads(packaged.read_text(encoding="utf-8"))
        mp3 = mp3_dir / metadata["file"]
        if not mp3.exists() or hashlib.sha256(mp3.read_bytes()).hexdigest() != metadata["sha256"]:
            shutil.copyfile(output / metadata["file"], mp3)
        filename = Path(metadata["file"]).with_suffix(".flac").name
        flac = flac_dir / filename
        flac_checkpoint = directory / "flac.json"
        if flac.exists() and flac_checkpoint.exists():
            cached = json.loads(flac_checkpoint.read_text(encoding="utf-8"))
            if hashlib.sha256(flac.read_bytes()).hexdigest() == cached["sha256"] and cached["mp3_sha256"] == metadata["sha256"]:
                report.append(cached)
                continue
        measured = metadata["loudness_input"]
        filt = ("loudnorm=I=-19:TP=-3:LRA=11:linear=true:"
                f"measured_I={measured['input_i']}:measured_TP={measured['input_tp']}:"
                f"measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}:offset={measured['target_offset']},"
                "adelay=1000,apad=pad_dur=1")
        staged = directory / "delivery.flac"
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(directory / "assembled.wav"),
            "-af", filt, "-ar", "24000", "-ac", "1", "-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24",
            "-compression_level", "8", "-map_metadata", "-1", str(staged)], check=True)
        audio = FLAC(staged)
        fields = {"TITLE": track.get("metadata_title", track["title"]), "ALBUM": plan["title"], "ARTIST": "Natalie", "ALBUMARTIST": "Natalie",
                  "COMPOSER": "Natalie", "AUTHOR": "Natalie", "PERFORMER": plan["narrator"], "NARRATOR": plan["narrator"],
                  "TRACKNUMBER": str(track["track"]), "TRACKTOTAL": "23", "TOTALTRACKS": "23", "DISCNUMBER": "1",
                  "DISCTOTAL": "1", "TOTALDISCS": "1", "GENRE": "Audiobook", "LANGUAGE": "eng", "GROUPING": track["group"],
                  "BOOK_PART": track["group"], "DESCRIPTION": plan["description"], "ENCODER": "Chatterbox Turbo / FFmpeg FLAC",
                  "SOURCE_SHA256": plan["source_sha256"]}
        if track["chapter_number"] is not None:
            fields["CHAPTER_NUMBER_WITHIN_BOOK"] = str(track["chapter_number"])
        for key, value in fields.items():
            audio[key] = value
        picture = Picture()
        picture.type, picture.mime, picture.desc = 3, "image/png", "Front cover"
        picture.width, picture.height = struct.unpack(">II", cover[16:24])
        picture.depth = 32 if cover[25] == 6 else 24
        picture.data = cover
        audio.clear_pictures()
        audio.add_picture(picture)
        audio.save()
        assert audio.info.channels == 1 and audio.info.sample_rate == 24000 and audio.info.bits_per_sample == 24
        decoded = subprocess.run([ffmpeg, "-v", "error", "-i", str(staged), "-f", "f32le", "pipe:1"], capture_output=True, check=True)
        assert not decoded.stderr
        samples = np.frombuffer(decoded.stdout, dtype="<f4")
        assert np.isfinite(samples).all() and np.max(np.abs(samples)) < 0.99
        first_peak, last_peak = float(np.max(np.abs(samples[:24000]))), float(np.max(np.abs(samples[-24000:])))
        assert first_peak < 0.0032 and last_peak < 0.0032
        assert len(audio.pictures) == 1 and hashlib.sha256(audio.pictures[0].data).hexdigest() == plan["cover_sha256"]
        shutil.copyfile(staged, flac)
        result = {"track": track["track"], "file": str(flac.relative_to(output)), "seconds": len(samples)/24000,
                  "sha256": hashlib.sha256(flac.read_bytes()).hexdigest(), "mp3_sha256": metadata["sha256"],
                  "bits_per_sample": audio.info.bits_per_sample, "sample_rate": audio.info.sample_rate,
                  "leading_1s_peak": first_peak, "trailing_1s_peak": last_peak,
                  "encoded_from": "lossless PCM assembled master; no lossy intermediate"}
        flac_checkpoint.write_text(json.dumps(result, indent=2), encoding="utf-8")
        report.append(result)
        print(f"FLAC PASS {track['track']:02d}: {len(samples)/24000:.2f}s", flush=True)
    if not args.ready_only:
        assert len(report) == 23
        for track, result in zip(plan["tracks"], report):
            assert track["track"] == result["track"]
            tagged = FLAC(output / result["file"])
            for key, value in {"TITLE": track["metadata_title"], "ALBUM": plan["title"], "ARTIST": "Natalie",
                               "ALBUMARTIST": "Natalie", "AUTHOR": "Natalie", "NARRATOR": plan["narrator"],
                               "TRACKNUMBER": str(track["track"]), "TRACKTOTAL": "23", "GROUPING": track["group"]}.items():
                assert tagged[key] == [value], (track["track"], key, tagged[key])
            result["title"] = track["metadata_title"]
        notes = output / "Production notes"
        notes.mkdir(exist_ok=True)
        (notes / "FLAC quality report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        for folder, suffix in [(mp3_dir, ".mp3"), (flac_dir, ".flac")]:
            shutil.copyfile(plan["cover"], folder / "Cover.png")
            playlist = ["#EXTM3U"]
            for track in plan["tracks"]:
                name = f"{track['track']:02d}. {track['title']}{suffix}"
                assert (folder / name).is_file()
                playlist.append(name)
            (folder / "Her Many Faces.m3u8").write_text("\n".join(playlist)+"\n", encoding="utf-8")
        print("BOTH FORMATS COMPLETE: 23 FLAC + 23 MP3")


if __name__ == "__main__":
    main()
