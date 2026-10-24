"""Review completed audiobook tracks using strict, unprompted medium.en ASR.

This never synthesises or packages audio. It only accepts existing WAVs whose
actual contents match the saved hash and whose transcript matches the original
text under audiobook_qa.compare. JSON replacements are atomic; candidate evidence
is saved before its containing selected checkpoint, so interruption is resumable.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re

from audiobook_qa import compare
from narration import split_narration


def save(path, data):
    temporary = path.with_suffix(path.suffix + ".review.tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def units(track):
    result = []
    for paragraph_index, paragraph in enumerate(track["paragraphs"]):
        chunks = split_narration(paragraph, max_chars=220, max_words=40)
        assert " ".join(chunks).split() == paragraph.split()
        for section_index, text in enumerate(chunks):
            result.append((f"p{paragraph_index:03d}-s{section_index:02d}", text))
    return result


class Reviewer:
    def __init__(self, root):
        self.root = root
        self.model = None
        self.audit_path = root / "third-pass-review.json"
        self.audit = (json.loads(self.audit_path.read_text(encoding="utf-8"))
                      if self.audit_path.exists() else {"runs": []})
        self.run = {"started": now(), "model": "medium.en", "initial_prompt": None,
                    "offline": True, "cpu_threads": 3, "events": [], "tracks": []}
        self.audit["runs"].append(self.run)
        self.persist()

    def persist(self):
        save(self.audit_path, self.audit)

    def event(self, value):
        self.run["events"].append({"time": now(), **value})
        self.persist()

    def transcribe(self, path):
        if self.model is None:
            os.environ["HF_HUB_OFFLINE"] = "1"
            from faster_whisper import WhisperModel
            data = Path(os.environ["LOCALAPPDATA"]) / "chatterbox"
            self.model = WhisperModel("medium.en", device="cpu", compute_type="int8", cpu_threads=3,
                                      download_root=str(data / "qa-models"), local_files_only=True)
        segments, _ = self.model.transcribe(str(path), language="en", beam_size=5, temperature=0,
                                            condition_on_previous_text=False, vad_filter=False,
                                            initial_prompt=None)
        return " ".join(segment.text.strip() for segment in segments)

    def candidate(self, item, directory, expected_text):
        path = Path(item["file"]).resolve()
        assert path.parent == directory.resolve() and path.suffix == ".wav", path
        actual_hash = sha(path)
        if item.get("sha256"):
            assert item["sha256"] == actual_hash, f"Selected audio changed: {path}"
        candidate_path = path.with_suffix(".json")
        candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
        assert Path(candidate["file"]).resolve() == path
        assert candidate["text"] == item["text"] == expected_text
        if candidate.get("sha256"):
            assert candidate["sha256"] == actual_hash, f"Candidate audio changed: {path}"
        # Preserve all earlier recogniser evidence, including selected-only evidence.
        evidence = list(candidate.get("asr", []))
        for old in item.get("asr", []):
            if old not in evidence:
                evidence.append(old)
        cached = next((entry for entry in reversed(evidence)
                       if entry.get("review_method") == "strict-unprompted-medium-v1"
                       and entry.get("audio_sha256") == actual_hash
                       and entry.get("initial_prompt", "missing") is None), None)
        existing_match = next((entry for entry in evidence
                               if entry.get("initial_prompt") is None
                               and compare(expected_text, entry["transcript"])["accepted"]), None)
        if existing_match is not None:
            # A reviewed spelling/homophone rule may explain an earlier mismatch.
            # Reuse the actual recogniser transcript; never rewrite what it heard.
            result = {**existing_match, **compare(expected_text, existing_match["transcript"]),
                      "initial_prompt": None, "audio_sha256": actual_hash,
                      "review_method": "existing-unprompted-transcript-normalisation-v1",
                      "review_reason": "spelling_or_spoken_homophone_normalisation_only",
                      "reviewed_at": now()}
            evidence.append(result)
            used_cache = True
        elif cached is not None:
            result = {**cached, **compare(expected_text, cached["transcript"])}
            used_cache = True
        else:
            transcript = self.transcribe(path)
            result = {"model": "medium.en", "transcript": transcript,
                      **compare(expected_text, transcript), "initial_prompt": None,
                      "audio_sha256": actual_hash, "review_method": "strict-unprompted-medium-v1",
                      "reviewed_at": now()}
            evidence.append(result)
            used_cache = False
        # Transcript correctness does not overrule the original duration guard.
        candidate.update({"asr": evidence, "sha256": actual_hash,
                          "accepted": bool(result["accepted"] and candidate.get("plausible_duration", False))})
        save(candidate_path, candidate)
        self.event({"candidate": str(candidate_path), "text": expected_text,
                    "audio_sha256": actual_hash, "cached": used_cache,
                    "accepted": candidate["accepted"], "result": result})
        print(f"{'PASS' if candidate['accepted'] else 'REVIEW'} {path.name}: {result['transcript']}", flush=True)
        return candidate

    def track(self, track):
        directory = self.root / f"track-{track['track']:02d}"
        expected = units(track)
        paths = [directory / f"{unit_id}-selected.json" for unit_id, _ in expected]
        # Do not review a partially generated track or the renderer's active track.
        missing = [str(path) for path in paths if not path.is_file()]
        if missing:
            raise RuntimeError(f"Track {track['track']} is incomplete; missing {missing[0]}")
        progress_path = self.root / "progress.json"
        if progress_path.exists():
            progress = json.loads(progress_path.read_text(encoding="utf-8"))
            if progress.get("status") == "running" and progress.get("track") == track["track"]:
                raise RuntimeError(f"Track {track['track']} is still active in the renderer")
        result = {"track": track["track"], "resolved": [], "unresolved": [], "already_accepted": 0}
        for (unit_id, text), checkpoint in zip(expected, paths):
            selected = json.loads(checkpoint.read_text(encoding="utf-8"))
            assert selected["id"] == unit_id and selected["text"] == text
            assert " ".join(part["text"] for part in selected["parts"]).split() == text.split()
            if selected["accepted"]:
                assert all(part["accepted"] for part in selected["parts"])
                result["already_accepted"] += 1
                continue
            for index, part in enumerate(selected["parts"]):
                if not part["accepted"]:
                    selected["parts"][index] = self.candidate(part, directory, part["text"])
            selected["accepted"] = all(part["accepted"] for part in selected["parts"])
            # If split excerpts still fail, the intact original sentence may give
            # the recogniser better context. Never change or prompt its wording.
            if not selected["accepted"]:
                intact = sorted(directory.glob(f"{unit_id}-a*.json"))
                for candidate_path in intact:
                    if re.fullmatch(re.escape(unit_id) + r"-a\d+\.json", candidate_path.name) is None:
                        continue
                    item = json.loads(candidate_path.read_text(encoding="utf-8"))
                    candidate = self.candidate(item, directory, text)
                    if candidate["accepted"]:
                        selected["parts"] = [candidate]
                        selected["accepted"] = True
                        break
            selected["third_pass_review"] = {"model": "medium.en", "initial_prompt": None,
                                              "reviewed_at": now(), "accepted": selected["accepted"]}
            # Validate every selected WAV again before accepting the containing unit.
            for part in selected["parts"]:
                assert sha(Path(part["file"])) == part["sha256"]
            assert " ".join(part["text"] for part in selected["parts"]).split() == text.split()
            save(checkpoint, selected)
            result["resolved" if selected["accepted"] else "unresolved"].append(unit_id)
            self.event({"checkpoint": str(checkpoint), "accepted": selected["accepted"],
                        "selected_files": [part["file"] for part in selected["parts"]]})
        self.run["tracks"].append(result)
        self.persist()
        print(f"TRACK {track['track']:02d}: resolved={len(result['resolved'])}, unresolved={result['unresolved']}", flush=True)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tracks", nargs="+", type=int, help="Only completed track numbers to review; default all")
    args = parser.parse_args()
    root = Path(os.environ.get("CHATTERBOX_AUDIOBOOK_ROOT",
                               str(Path(os.environ["LOCALAPPDATA"]) / "chatterbox/audiobooks/her-many-faces")))
    plan = json.loads((root / "plan.json").read_text(encoding="utf-8"))
    requested = set(args.tracks) if args.tracks is not None else {track["track"] for track in plan["tracks"]}
    unknown = requested - {track["track"] for track in plan["tracks"]}
    if unknown:
        parser.error(f"Unknown track numbers: {sorted(unknown)}")
    reviewer = Reviewer(root)
    try:
        results = [reviewer.track(track) for track in plan["tracks"] if track["track"] in requested]
        unresolved = any(result["unresolved"] for result in results)
        reviewer.run.update({"finished": now(), "status": "needs_review" if unresolved else "passed"})
        reviewer.persist()
        print(f"REVIEW {reviewer.run['status'].upper()}: {reviewer.audit_path}", flush=True)
        return 1 if unresolved else 0
    except Exception as error:
        reviewer.run.update({"finished": now(), "status": "error", "error": repr(error)})
        reviewer.persist()
        raise


if __name__ == "__main__":
    raise SystemExit(main())
