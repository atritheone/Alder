"""Resumable local audiobook renderer with speech verification and tagged MP3 output."""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

from local_app import DATA  # Sets model/audio-tool paths before audio imports.
import numpy as np
import soundfile as sf
import torch
from chatterbox.tts_turbo import ChatterboxTurboTTS
from narration import split_narration
from mutagen.id3 import ID3, APIC, TIT2, TALB, TPE1, TPE2, TPE3, TCOM, TRCK, TPOS, TCON, TLAN, TIT1, TXXX, COMM, TSSE
from mutagen.mp3 import MP3

ROOT = DATA / "audiobooks/her-many-faces"
HERE = Path(__file__).parent
FFMPEG = shutil.which("ffmpeg")


def save(path, obj):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


class Verifier:
    def __init__(self):
        self.stderr = (ROOT / "qa-worker.log").open("a", encoding="utf-8")
        self.process = subprocess.Popen([str(DATA / "qa-venv/Scripts/python.exe"), "-u", str(HERE / "audiobook_qa.py")],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.stderr, text=True, encoding="utf-8")

    def verify(self, path, text):
        self.process.stdin.write(json.dumps({"path": str(path), "text": text}, ensure_ascii=False) + "\n")
        self.process.stdin.flush()
        response = self.process.stdout.readline()
        if not response:
            raise RuntimeError("Speech verification worker stopped; see qa-worker.log")
        answer = json.loads(response)
        if "error" in answer:
            raise RuntimeError(answer["error"])
        return answer

    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=30)
        self.stderr.close()


def make_units(track):
    result = []
    for pi, paragraph in enumerate(track["paragraphs"]):
        sections = split_narration(paragraph, max_chars=220, max_words=40)
        assert " ".join(sections).split() == paragraph.split()
        for ci, text in enumerate(sections):
            result.append({"id": f"p{pi:03d}-s{ci:02d}", "text": text,
                           "pause": (0.45 if ci == len(sections)-1 else 0.12)})
    return result


def render_candidate(model, verifier, text, directory, label, attempt):
    seed = int(hashlib.sha256(f"{label}:{attempt}:her-many-faces-v1".encode()).hexdigest()[:8], 16)
    audio_path = directory / f"{label}-a{attempt}.wav"
    qa_path = audio_path.with_suffix(".json")
    if qa_path.exists() and audio_path.exists():
        cached = json.loads(qa_path.read_text(encoding="utf-8"))
        if cached["text"] == text:
            return cached
    torch.manual_seed(seed)
    temperature = [0.7, 0.6, 0.8, 0.65, 0.75][attempt % 5]
    started = time.perf_counter()
    wav = model.generate(text, temperature=temperature)
    samples = wav.squeeze(0).numpy()
    duration = len(samples) / model.sr
    assert np.isfinite(samples).all() and np.max(np.abs(samples)) > 0.001
    sf.write(audio_path, samples, model.sr, subtype="PCM_16")
    qa = verifier.verify(audio_path, text)
    plausible = max(0.3, len(text.split()) * 0.1) < duration < len(text.split()) * 1.3 + 4
    result = {"text": text, "file": str(audio_path), "seed": seed, "temperature": temperature,
              "seconds": duration, "accepted": qa["accepted"] and plausible, "plausible_duration": plausible,
              "asr": qa["results"], "elapsed": time.perf_counter() - started}
    save(qa_path, result)
    return result


def render_unit(model, verifier, unit, directory):
    attempts = []
    for attempt in range(3):
        item = render_candidate(model, verifier, unit["text"], directory, unit["id"], attempt)
        attempts.append(item)
        if item["accepted"]:
            return {**unit, "accepted": True, "parts": [item], "attempts": len(attempts)}
    pieces = split_narration(unit["text"], max_chars=125, max_words=22)
    accepted = []
    for i, text in enumerate(pieces):
        options = []
        for attempt in range(4):
            item = render_candidate(model, verifier, text, directory, f"{unit['id']}-split{i}", attempt)
            options.append(item)
            if item["accepted"]:
                break
        best = min(options, key=lambda x: (not x["accepted"], min(a["wer"] for a in x["asr"])))
        accepted.append(best)
    return {**unit, "accepted": all(x["accepted"] for x in accepted), "parts": accepted,
            "attempts": len(attempts) + sum(1 for _ in directory.glob(f"{unit['id']}-split*-a*.json"))}


def run_command(args):
    return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True)


def package(track, records, plan):
    output = Path(plan["output"])
    output.mkdir(parents=True, exist_ok=True)
    directory = ROOT / f"track-{track['track']:02d}"
    assembled = directory / "assembled.wav"
    sr = 24000
    with sf.SoundFile(assembled, "w", samplerate=sr, channels=1, subtype="PCM_24") as dest:
        for ui, unit in enumerate(records):
            assert unit["accepted"]
            assert " ".join(p["text"] for p in unit["parts"]).split() == unit["text"].split()
            for pi, part in enumerate(unit["parts"]):
                samples, rate = sf.read(part["file"], dtype="float32")
                assert rate == sr
                if pi:
                    dest.write(np.zeros(round(sr * 0.10), dtype=np.float32))
                dest.write(samples)
            if ui < len(records)-1:
                dest.write(np.zeros(round(sr * unit["pause"]), dtype=np.float32))
    measurement = run_command([FFMPEG, "-hide_banner", "-nostats", "-i", str(assembled), "-af",
        "loudnorm=I=-19:TP=-3:LRA=11:print_format=json", "-f", "null", "NUL"])
    loudness, _ = json.JSONDecoder().raw_decode(measurement.stderr[measurement.stderr.rfind("{"):])
    filt = ("loudnorm=I=-19:TP=-3:LRA=11:linear=true:"
            f"measured_I={loudness['input_i']}:measured_TP={loudness['input_tp']}:"
            f"measured_LRA={loudness['input_lra']}:measured_thresh={loudness['input_thresh']}:offset={loudness['target_offset']}")
    filename = f"{track['track']:02d}. {track['title']}.mp3"
    target = output / filename
    partial = directory / "encoded.mp3"
    # Pad after normalization: every deliverable receives one full second at each end.
    filt += ",adelay=1000,apad=pad_dur=1"
    run_command([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(assembled), "-af", filt,
                 "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "128k", "-map_metadata", "-1", str(partial)])
    tags = ID3()
    for frame in [TIT2(encoding=1, text=track.get("metadata_title", track["title"])), TALB(encoding=1, text=plan["title"]),
                  TPE1(encoding=1, text=plan["author"]), TPE2(encoding=1, text=plan["author"]),
                  TCOM(encoding=1, text=plan["author"]), TPE3(encoding=1, text=plan["narrator"]),
                  TRCK(encoding=1, text=f"{track['track']}/{len(plan['tracks'])}"), TPOS(encoding=1, text="1/1"),
                  TCON(encoding=1, text="Audiobook"), TLAN(encoding=1, text="eng"), TIT1(encoding=1, text=track["group"]),
                  TSSE(encoding=1, text="Chatterbox Turbo / FFmpeg libmp3lame"),
                  COMM(encoding=1, lang="eng", desc="", text=plan["description"]),
                  TXXX(encoding=1, desc="NARRATOR", text=plan["narrator"]),
                  TXXX(encoding=1, desc="AUTHOR", text=plan["author"]),
                  TXXX(encoding=1, desc="PRODUCTION_DATE", text=datetime.now().date().isoformat()),
                  TXXX(encoding=1, desc="SOURCE_SHA256", text=plan["source_sha256"]),
                  TXXX(encoding=1, desc="BOOK_PART", text=track["group"]),
                  APIC(encoding=1, mime="image/png", type=3, desc="Front cover", data=Path(plan["cover"]).read_bytes())]:
        tags.add(frame)
    if track["chapter_number"] is not None:
        tags.add(TXXX(encoding=1, desc="CHAPTER_NUMBER_WITHIN_BOOK", text=str(track["chapter_number"])))
    tags.save(partial, v2_version=3)
    meta = MP3(partial)
    assert str(meta.tags["TRCK"]) == f"{track['track']}/{len(plan['tracks'])}" and len(meta.tags.getall("APIC")) == 1
    assert meta.info.channels == 1 and meta.info.sample_rate == 24000
    assert abs(meta.info.length - sf.info(assembled).duration - 2) < 0.2
    run_command([FFMPEG, "-v", "error", "-i", str(partial), "-map", "0:a:0", "-f", "null", "NUL"])
    shutil.copyfile(partial, target)
    result = {"file": filename, "seconds": meta.info.length, "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
              "source_words": sum(len(p.split()) for p in track["paragraphs"]), "sections": len(records),
              "all_sections_asr_matched": True, "padding_start_seconds": 1, "padding_end_seconds": 1, "loudness_input": loudness}
    save(directory / "packaged.json", result)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tracks", nargs="*", type=int)
    parser.add_argument("--package-only", action="store_true")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    plan = json.loads((ROOT / "plan.json").read_text(encoding="utf-8"))
    progress = {"started": datetime.now().isoformat(), "status": "running", "tracks": []}
    save(ROOT / "progress.json", progress)
    model = verifier = None
    try:
        if not args.package_only:
            model = ChatterboxTurboTTS.from_pretrained(device="cuda")
            model.prepare_conditionals(plan["reference"])
            verifier = Verifier()
        for track in plan["tracks"]:
            if args.tracks and track["track"] not in args.tracks:
                continue
            directory = ROOT / f"track-{track['track']:02d}"
            directory.mkdir(exist_ok=True)
            units = make_units(track)
            records = []
            print(f"TRACK {track['track']:02d} START: {track['title']} ({len(units)} sections)", flush=True)
            for index, unit in enumerate(units):
                checkpoint = directory / (unit["id"] + "-selected.json")
                if checkpoint.exists():
                    selected = json.loads(checkpoint.read_text(encoding="utf-8"))
                    assert selected["text"] == unit["text"]
                elif args.package_only:
                    raise RuntimeError(f"Missing section {checkpoint}")
                else:
                    selected = render_unit(model, verifier, unit, directory)
                    save(checkpoint, selected)
                records.append(selected)
                progress.update({"track": track["track"], "section": index + 1, "sections_in_track": len(units),
                                 "pending_in_track": sum(not r["accepted"] for r in records), "updated": datetime.now().isoformat()})
                save(ROOT / "progress.json", progress)
                print(f"TRACK {track['track']:02d} {index+1}/{len(units)} {'PASS' if selected['accepted'] else 'REVIEW'} attempts={selected['attempts']}", flush=True)
            assert [r["text"] for r in records] == [u["text"] for u in units]
            pending = [r["id"] for r in records if not r["accepted"]]
            if pending:
                result = {"track": track["track"], "pending": pending}
                print(f"TRACK {track['track']:02d} NEEDS REVIEW: {pending}", flush=True)
            else:
                result = {"track": track["track"], **package(track, records, plan)}
                print(f"TRACK {track['track']:02d} PACKAGED: {result['seconds']:.1f}s", flush=True)
            progress["tracks"].append(result)
            save(ROOT / "progress.json", progress)
        progress["status"] = "needs_review" if any(t.get("pending") for t in progress["tracks"]) else "complete"
        progress["finished"] = datetime.now().isoformat()
        save(ROOT / "progress.json", progress)
        print(f"RUN {progress['status'].upper()}", flush=True)
    finally:
        if verifier:
            verifier.close()


if __name__ == "__main__":
    main()
