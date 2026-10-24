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

DATA = Path(os.environ["LOCALAPPDATA"]) / "chatterbox"
ROOT = Path(os.environ.get("CHATTERBOX_AUDIOBOOK_ROOT", str(DATA / "audiobooks/her-many-faces")))


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def flac_fields(plan, track):
    author = plan.get("author", "Natalie")
    total = str(len(plan["tracks"]))
    fields = {"TITLE": track.get("metadata_title", track["title"]), "ALBUM": plan["title"],
              "ARTIST": author, "ALBUMARTIST": author, "COMPOSER": author, "AUTHOR": author,
              "PERFORMER": plan["narrator"], "NARRATOR": plan["narrator"],
              "TRACKNUMBER": str(track["track"]), "TRACKTOTAL": total, "TOTALTRACKS": total,
              "DISCNUMBER": "1", "DISCTOTAL": "1", "TOTALDISCS": "1", "GENRE": "Audiobook",
              "LANGUAGE": plan.get("language", "eng"), "GROUPING": track["group"],
              "BOOK_PART": track["group"], "DESCRIPTION": plan["description"],
              "ENCODER": "Chatterbox Turbo / FFmpeg FLAC", "SOURCE_SHA256": plan["source_sha256"]}
    if track.get("chapter_number") is not None:
        fields["CHAPTER_NUMBER_WITHIN_BOOK"] = str(track["chapter_number"])
    if plan.get("production_date"):
        fields["PRODUCTION_DATE"] = plan["production_date"]
    return fields


def check_flac_tags(audio, plan, track):
    for key, value in flac_fields(plan, track).items():
        assert audio.get(key) == [value], (track["track"], key, audio.get(key), value)
    assert audio.info.channels == 1 and audio.info.sample_rate == 24000 and audio.info.bits_per_sample == 24
    assert len(audio.pictures) == 1 and audio.pictures[0].type == 3 and audio.pictures[0].mime == "image/png"
    assert hashlib.sha256(audio.pictures[0].data).hexdigest() == plan["cover_sha256"]


def audit_flac(file, ffmpeg, plan, track):
    audio = FLAC(file)
    check_flac_tags(audio, plan, track)
    decoded = subprocess.run([str(ffmpeg), "-v", "error", "-i", str(file), "-map", "0:a:0",
                              "-f", "f32le", "pipe:1"], capture_output=True, check=True)
    assert not decoded.stderr, decoded.stderr
    samples = np.frombuffer(decoded.stdout, dtype="<f4")
    assert len(samples) >= 48000 and np.isfinite(samples).all() and np.max(np.abs(samples)) < 0.99
    first_peak, last_peak = float(np.max(np.abs(samples[:24000]))), float(np.max(np.abs(samples[-24000:])))
    assert first_peak < 0.0032 and last_peak < 0.0032, (file, first_peak, last_peak)
    return {"seconds": len(samples) / 24000, "bits_per_sample": audio.info.bits_per_sample,
            "sample_rate": audio.info.sample_rate, "leading_1s_peak": first_peak, "trailing_1s_peak": last_peak}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ready-only", action="store_true")
    args = parser.parse_args()
    plan = json.loads((ROOT / "plan.json").read_text(encoding="utf-8"))
    output = Path(plan["output"])
    flac_dir, mp3_dir = output / "FLAC", output / "MP3"
    flac_dir.mkdir(parents=True, exist_ok=True)
    mp3_dir.mkdir(parents=True, exist_ok=True)
    ffmpeg = str(next((DATA / "ffmpeg").glob("*/bin/ffmpeg.exe")))
    cover = Path(plan["cover"]).read_bytes()
    assert hashlib.sha256(cover).hexdigest() == plan["cover_sha256"]
    assert [t["track"] for t in plan["tracks"]] == list(range(1, len(plan["tracks"]) + 1))
    report = []
    for track in plan["tracks"]:
        directory = ROOT / f"track-{track['track']:02d}"
        packaged = directory / "packaged.json"
        if not packaged.exists():
            if args.ready_only:
                continue
            raise RuntimeError(f"Track {track['track']} not ready")
        metadata = json.loads(packaged.read_text(encoding="utf-8"))
        assert metadata["file"] == f"{track['track']:02d}. {track['title']}.mp3"
        mp3 = mp3_dir / metadata["file"]
        if not mp3.exists() or sha256(mp3) != metadata["sha256"]:
            source = output / metadata["file"]
            assert sha256(source) == metadata["sha256"], f"Changed staging MP3: {source}"
            shutil.copyfile(source, mp3)
        filename = Path(metadata["file"]).with_suffix(".flac").name
        flac = flac_dir / filename
        flac_checkpoint = directory / "flac.json"
        if flac.exists() and flac_checkpoint.exists():
            cached = json.loads(flac_checkpoint.read_text(encoding="utf-8"))
            if sha256(flac) == cached["sha256"] and cached["mp3_sha256"] == metadata["sha256"]:
                try:
                    check_flac_tags(FLAC(flac), plan, track)
                except AssertionError:
                    pass  # Rebuild tags from the current plan rather than retaining stale metadata.
                else:
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
        for key, value in flac_fields(plan, track).items():
            audio[key] = value
        picture = Picture()
        picture.type, picture.mime, picture.desc = 3, "image/png", "Front cover"
        picture.width, picture.height = struct.unpack(">II", cover[16:24])
        picture.depth = 32 if cover[25] == 6 else 24
        picture.data = cover
        audio.clear_pictures()
        audio.add_picture(picture)
        audio.save()
        checks = audit_flac(staged, ffmpeg, plan, track)
        shutil.copyfile(staged, flac)
        result = {"track": track["track"], "file": flac.relative_to(output).as_posix(), **checks,
                  "sha256": sha256(flac), "mp3_sha256": metadata["sha256"],
                  "encoded_from": "lossless PCM assembled master; no lossy intermediate"}
        flac_checkpoint.write_text(json.dumps(result, indent=2), encoding="utf-8")
        report.append(result)
        print(f"FLAC PASS {track['track']:02d}: {checks['seconds']:.2f}s", flush=True)
    if not args.ready_only:
        assert len(report) == len(plan["tracks"])
        for track, result in zip(plan["tracks"], report):
            assert track["track"] == result["track"]
            # Also recheck cached deliveries: a prior successful run is not sufficient.
            result.update(audit_flac(output / result["file"], ffmpeg, plan, track))
            result["title"] = track.get("metadata_title", track["title"])
        assert sorted(p.name for p in flac_dir.glob("*.flac")) == sorted(Path(r["file"]).name for r in report)
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
            (folder / f"{plan.get('short_title', plan['title'].split(':', 1)[0])}.m3u8").write_text("\n".join(playlist)+"\n", encoding="utf-8")
        print(f"BOTH FORMATS COMPLETE: {len(report)} FLAC + {len(report)} MP3")


if __name__ == "__main__":
    main()
