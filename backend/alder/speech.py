"""Persistent, chunked narration. The application process never imports torch.

Only our child worker owns the model. Its protocol is a serial JSON-lines pipe,
so reference conditioning cannot leak between concurrently submitted jobs.
"""
from __future__ import annotations

import copy
import difflib
import hashlib
import json
import math
import os
from pathlib import Path
import queue
import re
import shutil
import subprocess
import threading
import time
import unicodedata
import uuid
import wave
from datetime import datetime, timezone


SEGMENT_VERSION = 2
TERMINAL = {"ready", "failed", "cancelled", "interrupted"}
ABBREVIATIONS = {"mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "no", "fig", "inc"}
QA_COMPARISON_VERSION = 1


def compare_transcript(expected: str, transcript: str):
    """Conservative content comparison; recognition is evidence, not a correction.

    Casing, Unicode presentation, and sentence punctuation are ignored. Words,
    apostrophes, numbers, regional spelling and homophones remain distinguishable.
    """
    def tokens(value):
        normalized = unicodedata.normalize("NFKC", value).casefold().replace("’", "'")
        return re.findall(r"[^\W_]+(?:'[^\W_]+)*", normalized, flags=re.UNICODE)
    source_words, heard_words = tokens(expected), tokens(transcript)
    row = list(range(len(heard_words) + 1))
    for index, source_word in enumerate(source_words, 1):
        next_row = [index]
        for j, heard_word in enumerate(heard_words, 1):
            next_row.append(min(next_row[-1] + 1, row[j] + 1, row[j - 1] + (source_word != heard_word)))
        row = next_row
    differences = []
    for operation, a, b, c, d in difflib.SequenceMatcher(None, source_words, heard_words, autojunk=False).get_opcodes():
        if operation != "equal":
            differences.append({"type": operation, "expected": " ".join(source_words[a:b]), "heard": " ".join(heard_words[c:d]), "expectedTokenStart": a, "expectedTokenEnd": b, "heardTokenStart": c, "heardTokenEnd": d})
    matched = bool(source_words) and source_words == heard_words
    return {"status": "matched" if matched else "needs_review", "matched": matched, "expected": expected, "transcript": transcript, "wordErrorRate": row[-1] / max(len(source_words), 1), "expectedWords": len(source_words), "heardWords": len(heard_words), "differences": differences, "comparisonVersion": QA_COMPARISON_VERSION, "note": "ASR content comparison does not verify delivery, prosody, or pronunciation quality. Recognition and homophone errors require listening review."}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def _atomic_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def split_narration(text: str, max_chars=240, max_words=45):
    """Sentence chunks with source character spans; no lost or split tokens.

    A deliberately conservative English sentence boundary rule preserves common
    abbreviations and initials. It is not a multilingual linguistic segmenter.
    """
    if max_chars < 1 or max_words < 1:
        raise ValueError("Speech chunk limits must be positive.")
    chunks = []
    for paragraph in re.finditer(r"[^\n]+(?:\n(?!\s*\n)[^\n]+)*", text):
        raw = paragraph.group()
        sentence_start = 0
        boundaries = []
        for match in re.finditer(r"[.!?]+[\"'”’»)]*(?=\s|$)", raw):
            prefix = raw[:match.start()]
            previous = re.search(r"([\w.]+)$", prefix)
            token = previous.group(1).lower() if previous else ""
            if match.group().startswith(".") and (token in ABBREVIATIONS or re.fullmatch(r"(?:[A-Za-z]\.)*[A-Za-z]", token)):
                continue
            boundaries.append(match.end())
        boundaries.append(len(raw))
        paragraph_chunks = []
        for end in boundaries:
            sentence = raw[sentence_start:end]
            tokens = list(re.finditer(r"\S+", sentence))
            group = []
            for token in tokens:
                if len(token.group()) > max_chars:
                    raise ValueError(f"A word exceeds {max_chars} characters; check pasted URLs or missing spaces.")
                if group and (len(" ".join(t.group() for t in group)) + 1 + len(token.group()) > max_chars or len(group) >= max_words):
                    a = paragraph.start() + sentence_start + group[0].start()
                    b = paragraph.start() + sentence_start + group[-1].end()
                    paragraph_chunks.append({"text": " ".join(t.group() for t in group), "sourceStart": a, "sourceEnd": b, "paragraphEnd": False})
                    group = []
                group.append(token)
            if group:
                a = paragraph.start() + sentence_start + group[0].start()
                b = paragraph.start() + sentence_start + group[-1].end()
                paragraph_chunks.append({"text": " ".join(t.group() for t in group), "sourceStart": a, "sourceEnd": b, "paragraphEnd": False})
            sentence_start = end
        if paragraph_chunks:
            paragraph_chunks[-1]["paragraphEnd"] = True
            chunks.extend(paragraph_chunks)
    return chunks


def pronunciation_projection(text, entries, voice_id="default"):
    """Return spoken text and a map without changing authored text.

    All substitutions match the original text once, longest phrase first;
    replacements are never fed back into the substitution engine.
    """
    entries = [entry for entry in entries if entry.get("word") and entry.get("spoken") and entry.get("voiceId") in (None, "", voice_id)]
    entries.sort(key=lambda item: len(item["word"]), reverse=True)
    if not entries:
        return text, []
    patterns = [re.compile(r"(?<!\w)" + re.escape(item["word"]) + r"(?!\w)", 0 if item.get("caseSensitive") else re.IGNORECASE) for item in entries]
    candidates = []
    for index, pattern in enumerate(patterns):
        candidates.extend((m.start(), m.end(), index) for m in pattern.finditer(text))
    candidates.sort(key=lambda m: (m[0], -(m[1] - m[0]), m[2]))
    result, mappings, cursor, spoken_position = [], [], 0, 0
    for start, end, index in candidates:
        if start < cursor:
            continue
        prefix = text[cursor:start]
        result.append(prefix)
        spoken_position += len(prefix)
        replacement = entries[index]["spoken"]
        result.append(replacement)
        mappings.append({"sourceStart": start, "sourceEnd": end, "spokenStart": spoken_position, "spokenEnd": spoken_position + len(replacement), "word": text[start:end], "spoken": replacement})
        spoken_position += len(replacement)
        cursor = end
    result.append(text[cursor:])
    return "".join(result), mappings


def _wav_info(path):
    with wave.open(str(path), "rb") as audio:
        rate, frames = audio.getframerate(), audio.getnframes()
        if not rate or not frames or audio.getsampwidth() != 2:
            raise ValueError("Expected nonempty 16-bit PCM WAV audio.")
        return {"sampleRate": rate, "frames": frames, "seconds": frames / rate, "channels": audio.getnchannels(), "sampleWidth": audio.getsampwidth()}


def _hidden_process_options():
    return {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}


def discover_runtime(project_root: Path):
    local = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local/share"))) / "chatterbox"
    resources = Path(os.environ["ALDER_RESOURCES_DIR"]) / "speech" if os.environ.get("ALDER_RESOURCES_DIR") else None
    configured = os.environ.get("ALDER_SPEECH_PYTHON")
    bundled_python = resources / "python" / ("python.exe" if os.name == "nt" else "bin/python3") if resources else None
    python = Path(configured) if configured else bundled_python if bundled_python else local / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    hf_home = Path(os.environ.get("HF_HOME", str(local / "huggingface")))
    model = None
    if os.environ.get("ALDER_CHATTERBOX_MODEL"):
        model = Path(os.environ["ALDER_CHATTERBOX_MODEL"])
    elif resources:
        model = resources / "models/turbo"
    else:
        repository = hf_home / "hub/models--ResembleAI--chatterbox-turbo"
        reference = repository / "refs/main"
        if reference.is_file():
            model = repository / "snapshots" / reference.read_text().strip()
        if model is None or not model.is_dir():
            snapshots = repository / "snapshots"
            candidates = sorted(snapshots.glob("*"), key=lambda p: p.stat().st_mtime, reverse=True) if snapshots.exists() else []
            model = next((p for p in candidates if p.is_dir()), None)
    required = ["ve.safetensors", "t3_turbo_v1.safetensors", "s3gen_meanflow.safetensors", "conds.pt", "tokenizer_config.json"]
    model_present = model is not None and all((model / name).is_file() for name in required)
    if model_present:
        model_present = (model / "tokenizer.json").is_file() or all((model / name).is_file() for name in ("vocab.json", "merges.txt"))
    ffmpeg = os.environ.get("ALDER_FFMPEG") or (str(resources / "ffmpeg" / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")) if resources else shutil.which("ffmpeg"))
    if not ffmpeg and not resources:
        ffmpeg = next((str(p) for p in sorted((local / "ffmpeg").glob("*/bin/ffmpeg.exe"), reverse=True)), None)
    source = project_root / "chatterbox/src"
    if resources:
        source = resources / "chatterbox/src"
    source_hasher = hashlib.sha256()
    if source.exists():
        for path in sorted(source.rglob("*.py")):
            source_hasher.update(path.relative_to(source).as_posix().encode())
            source_hasher.update(path.read_bytes())
    model_revision = model.name if model else None
    if model and (model / "revision.txt").is_file():
        model_revision = (model / "revision.txt").read_text().strip()
    qa_python = Path(os.environ["ALDER_QA_PYTHON"]) if os.environ.get("ALDER_QA_PYTHON") else resources / "qa/python" / ("python.exe" if os.name == "nt" else "bin/python3") if resources else local / "qa-venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    qa_model = None
    if os.environ.get("ALDER_QA_MODEL"):
        qa_model = Path(os.environ["ALDER_QA_MODEL"])
    elif resources:
        qa_model = resources / "qa/models/base.en"
    else:
        qa_repository = local / "qa-models/models--Systran--faster-whisper-base.en"
        reference = qa_repository / "refs/main"
        if reference.is_file():
            qa_model = qa_repository / "snapshots" / reference.read_text().strip()
        if qa_model is None or not qa_model.is_dir():
            qa_model = next((p for p in sorted((qa_repository / "snapshots").glob("*")) if p.is_dir()), None)
    qa_present = qa_model is not None and all((qa_model / name).is_file() for name in ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt"))
    qa_revision = (qa_model / "revision.txt").read_text().strip() if qa_model and (qa_model / "revision.txt").is_file() else qa_model.name if qa_model else None
    return {"python": str(python), "pythonPresent": python.is_file(), "source": str(source), "sourcePresent": (source / "chatterbox/tts_turbo.py").is_file(), "sourceRevision": source_hasher.hexdigest(), "model": str(model) if model else None, "modelPresent": model_present, "modelRevision": model_revision, "hfHome": str(hf_home), "ffmpeg": ffmpeg if ffmpeg and Path(ffmpeg).is_file() else None, "qaPython": str(qa_python), "qaPythonPresent": qa_python.is_file(), "qaModel": str(qa_model) if qa_model else None, "qaModelPresent": qa_present, "qaModelRevision": qa_revision}


class SpeechService:
    def __init__(self, data_dir: Path, project_root: Path):
        self.root = Path(data_dir) / "speech"
        self.project_root = Path(project_root)
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / "jobs").mkdir(exist_ok=True)
        (self.root / "voices").mkdir(exist_ok=True)
        (self.root / "cache").mkdir(exist_ok=True)
        self.runtime = discover_runtime(self.project_root)
        self._lock = threading.RLock()
        self._jobs = {}
        self._queue = queue.PriorityQueue()
        self._sequence = 0
        self._stopping = threading.Event()
        self._process = None
        self._responses = None
        self._stderr = None
        self._worker_health = None
        self._qa_process = None
        self._qa_responses = None
        self._qa_stderr = None
        self._qa_health = None
        for manifest in (self.root / "jobs").glob("*/manifest.json"):
            try:
                job = json.loads(manifest.read_text(encoding="utf-8"))
                if job["id"] != manifest.parent.name:
                    continue
                if job["status"] not in TERMINAL:
                    job["status"] = "interrupted"
                    job["message"] = "Alder stopped before this narration finished. Resume to retain completed chunks."
                for chunk in job["chunks"]:
                    if chunk["status"] in ("generating", "checking"):
                        chunk["status"] = "queued"
                    if chunk["status"] == "ready":
                        try:
                            _wav_info(self._chunk_path(job, chunk))
                        except (OSError, ValueError, wave.Error, EOFError):
                            chunk["status"] = "queued"
                            chunk.pop("audioUrl", None)
                            chunk.pop("manualReview", None)
                            job["status"] = "interrupted"
                            job["message"] = "A saved audio chunk is missing or damaged. Resume to recover it."
                if job["status"] == "ready" and not (manifest.parent / ("narration." + job["format"])).is_file():
                    job["status"] = "interrupted"
                    job["message"] = "Combined audio is missing. Resume to rebuild it from saved chunks."
                self._jobs[job["id"]] = job
                self._persist(job)
            except (ValueError, KeyError, OSError):
                continue  # Retain a damaged manifest on disk for recovery.
        self._thread = threading.Thread(target=self._run, name="alder-speech-supervisor", daemon=True)
        self._thread.start()

    def capabilities(self):
        missing = []
        if not self.runtime["pythonPresent"]:
            missing.append("Alder's bundled speech runtime is missing. Repair or reinstall Alder.")
        if not self.runtime["sourcePresent"]:
            missing.append("Alder's Chatterbox engine files are missing.")
        if not self.runtime["modelPresent"]:
            missing.append("Alder's bundled Turbo model is incomplete. Repair or reinstall Alder.")
        verification_available = bool(self.runtime.get("qaPythonPresent") and self.runtime.get("qaModelPresent"))
        return {"available": not missing, "engine": "chatterbox-turbo", "engines": [{"id": "chatterbox-turbo", "name": "Chatterbox Turbo", "languages": ["en"], "available": not missing}], "reason": " ".join(missing), "formats": ["wav", "mp3", "flac"] if self.runtime["ffmpeg"] else ["wav"], "voiceCloning": True, "referenceMinimumSeconds": 5, "referenceMaximumSeconds": 120, "wordTimestamps": False, "streaming": False, "chunkPlayback": True, "controls": ["voiceId", "seed", "temperature", "topP", "topK", "repetitionPenalty", "pauseSeconds", "verify", "verificationRetries"], "unsupportedControls": ["exaggeration", "cfgWeight", "minP", "ssml", "phonemes", "exactWpm"], "modelRevision": self.runtime["modelRevision"], "sourceRevision": self.runtime["sourceRevision"], "runtimeVerified": self._worker_health is not None, "worker": self._worker_health, "verification": {"available": verification_available, "model": "faster-whisper-base.en", "modelRevision": self.runtime.get("qaModelRevision"), "languages": ["en"], "device": "cpu", "maximumRetries": 2, "worker": self._qa_health, "reason": "" if verification_available else "The local speech content-check runtime or base.en model is missing."}}

    def voices(self):
        result = [{"id": "default", "name": "Built-in Turbo voice", "kind": "builtin"}]
        for path in sorted((self.root / "voices").glob("*/voice.json")):
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
                if value["id"] == path.parent.name and (path.parent / "reference.wav").is_file():
                    result.append(value)
            except (ValueError, OSError, KeyError):
                continue
        return result

    def add_voice(self, path: Path, name: str):
        path = Path(path)
        if not path.is_file() or path.stat().st_size > 100 * 1024 * 1024:
            raise ValueError("Upload an audio reference smaller than 100 MB.")
        name = name.strip()[:100]
        if not name:
            raise ValueError("Give the voice a name.")
        voice_id = uuid.uuid4().hex
        destination = self.root / "voices" / voice_id
        destination.mkdir()
        temporary = destination / "reference.tmp.wav"
        try:
            if self.runtime["ffmpeg"]:
                completed = subprocess.run([self.runtime["ffmpeg"], "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(path), "-vn", "-t", "121", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", str(temporary)], capture_output=True, text=True, timeout=60, **_hidden_process_options())
                if completed.returncode:
                    raise ValueError("The reference could not be decoded as audio: " + completed.stderr[-1000:])
            else:
                _wav_info(path)
                shutil.copyfile(path, temporary)
            info = _wav_info(temporary)
            if info["seconds"] <= 5 or info["seconds"] > 120:
                raise ValueError("Voice references must be longer than 5 seconds and at most 120 seconds; about 10 clean seconds works well.")
            voice = {"id": voice_id, "name": name, "kind": "reference", "seconds": info["seconds"], "hash": hashlib.sha256(temporary.read_bytes()).hexdigest(), "createdAt": _now()}
            os.replace(temporary, destination / "reference.wav")
            _atomic_json(destination / "voice.json", voice)
            return voice
        except Exception:
            # The directory was created here with a random ID and contains no user files.
            shutil.rmtree(destination)
            raise

    def _voice(self, voice_id):
        voice = next((v for v in self.voices() if v["id"] == voice_id), None)
        if voice is None:
            raise ValueError("Unknown voice profile.")
        return voice

    def _sources(self, project, request):
        tracks = {track["id"]: track for track in project.get("tracks", [])}
        clips = {clip["id"]: clip for clip in project.get("clips", [])}
        scope = request.get("scope", "clip")
        def voice(clip):
            return request.get("voiceId") or clip.get("voiceId") or tracks.get(clip.get("trackId"), {}).get("voiceId") or "default"
        def chosen_text(clip, variant_id=None):
            chosen_id = variant_id or clip.get("activeVariantId")
            chosen = next((v for v in clip.get("variants", []) if v.get("id") == chosen_id), clip)
            return chosen.get("text", "")
        if scope == "selection" or request.get("text") is not None:
            clip = clips.get(request.get("clipId"), {})
            return [{"text": request.get("text", ""), "clipId": clip.get("id"), "voiceId": voice(clip)}]
        if scope == "clip":
            clip = clips.get(request.get("clipId"))
            if clip is None:
                raise ValueError("Select an existing clip to narrate.")
            return [{"text": chosen_text(clip), "clipId": clip["id"], "voiceId": voice(clip)}]
        if scope != "collation":
            raise ValueError("Speech scope must be clip, selection, or collation.")
        sections = {section["id"]: section.get("order", index) for index, section in enumerate(project.get("sections", []))}
        result = []
        for placement in sorted(project.get("placements", []), key=lambda p: (sections.get(p.get("sectionId"), 0), p.get("order", 0))):
            if not placement.get("include", True):
                continue
            clip = clips.get(placement.get("clipId"))
            if clip is None:
                raise ValueError("A collation placement references a missing clip.")
            result.append({"text": placement.get("frozenText") if placement.get("frozenText") is not None else chosen_text(clip, placement.get("variantId")), "clipId": clip["id"], "sectionId": placement.get("sectionId"), "placementId": placement["id"], "voiceId": voice(clip)})
        return result

    def submit(self, project: dict, request: dict):
        sources = self._sources(project, request)
        source_text = "\n\n".join(source["text"] for source in sources)
        if not source_text.strip():
            raise ValueError("Enter some text to narrate.")
        if len(source_text) > 2_000_000:
            raise ValueError("Split this narration into jobs of at most 2 million characters.")
        for unsupported in ("exaggeration", "cfgWeight", "minP", "ssml", "phonemes", "exactWpm"):
            if unsupported in request:
                raise ValueError(f"Chatterbox Turbo does not support {unsupported}.")
        settings = {"temperature": float(request.get("temperature", .8)), "topP": float(request.get("topP", .95)), "topK": int(request.get("topK", 1000)), "repetitionPenalty": float(request.get("repetitionPenalty", 1.2)), "pauseSeconds": float(request.get("pauseSeconds", .18))}
        if not all(math.isfinite(v) for v in settings.values()):
            raise ValueError("Speech settings must be finite numbers.")
        if not (0.05 <= settings["temperature"] <= 2 and 0 < settings["topP"] <= 1 and 1 <= settings["topK"] <= 6563 and 1 <= settings["repetitionPenalty"] <= 3 and 0 <= settings["pauseSeconds"] <= 5):
            raise ValueError("Speech sampling or pause settings are out of range.")
        seed = int(request.get("seed", 42))
        if not 0 <= seed <= 2**32 - 1:
            raise ValueError("Seed must be between 0 and 4294967295.")
        output_format = request.get("format", "wav").lower()
        if output_format not in self.capabilities()["formats"]:
            raise ValueError("This audio format is unavailable. MP3 and FLAC need Alder's bundled audio converter; repair the installation or choose WAV.")
        verify = request.get("verify", False)
        if not isinstance(verify, bool):
            raise ValueError("verify must be true or false.")
        verification_retries = request.get("verificationRetries", 1)
        if not isinstance(verification_retries, int) or isinstance(verification_retries, bool) or not 0 <= verification_retries <= 2:
            raise ValueError("verificationRetries must be an integer from 0 to 2.")
        if verify and not self.capabilities()["verification"]["available"]:
            raise ValueError(self.capabilities()["verification"]["reason"])
        chunks, source_offset, occurrences = [], 0, {}
        for source in sources:
            voice = self._voice(source["voiceId"])
            for chunk in split_narration(source["text"]):
                spoken, mappings = pronunciation_projection(chunk["text"], project.get("pronunciation", []), voice["id"])
                if len(spoken) > 400 or len(spoken.split()) > 70:
                    raise ValueError("Pronunciation substitutions make a speech chunk too long; shorten the substitution or source sentence.")
                content = _hash({"text": spoken, "voice": voice.get("hash", "default"), "segmentVersion": SEGMENT_VERSION})
                chunk_seed = (seed + int(content[:8], 16)) % 2**32
                key = _hash({"content": content, "seed": chunk_seed, "settings": settings, "model": self.runtime["modelRevision"], "source": self.runtime["sourceRevision"], "watermark": True})
                occurrences[key] = occurrences.get(key, 0) + 1
                chunks.append({**chunk, "id": key[:20] + "-" + str(occurrences[key]), "cacheKey": key, "spokenText": spoken, "pronunciationMap": mappings, "voiceId": voice["id"], "voiceHash": voice.get("hash", "default"), "seed": chunk_seed, "clipId": source.get("clipId"), "sectionId": source.get("sectionId"), "sourceStart": chunk["sourceStart"] + source_offset, "sourceEnd": chunk["sourceEnd"] + source_offset, "status": "queued"})
            source_offset += len(source["text"]) + 2
        job = {"id": uuid.uuid4().hex, "projectId": project["id"], "sourceRevision": project.get("revision", 0), "status": "queued", "progress": 0, "message": "Queued for narration.", "text": source_text, "chunks": chunks, "createdAt": _now(), "updatedAt": _now(), "request": copy.deepcopy(request), "settings": settings, "format": output_format, "engine": "chatterbox-turbo", "modelRevision": self.runtime["modelRevision"], "sourceFingerprint": self.runtime["sourceRevision"], "sourceOffsetUnit": "unicodeCodePoint", "seed": seed, "verify": verify, "verificationRetries": verification_retries, "verificationModelRevision": self.runtime.get("qaModelRevision") if verify else None}
        with self._lock:
            self._jobs[job["id"]] = job
            self._persist(job)
            self._enqueue(job)
            return self._public(job)

    def _persist(self, job):
        job["updatedAt"] = _now()
        _atomic_json(self.root / "jobs" / job["id"] / "manifest.json", job)

    def _public(self, job):
        result = copy.deepcopy(job)
        result.pop("request", None)
        accepted = 0
        for chunk in result["chunks"]:
            chunk.pop("cacheKey", None)
            if self._review_applies(job, chunk):
                accepted += 1
            elif chunk.get("manualReview", {}).get("accepted"):
                chunk["manualReview"]["superseded"] = True
            for attempt in chunk.get("qaAttempts", []):
                take_id = f"{chunk['id']}.take-{attempt['index'] + 1}"
                if (self.root / "jobs" / job["id"] / (take_id + ".wav")).is_file():
                    attempt["audioUrl"] = f"/api/speech/jobs/{job['id']}/chunks/{take_id}"
        result["manualReviewSummary"] = {"accepted": accepted, "total": len(result["chunks"])}
        result["manualReviewStatus"] = "accepted" if accepted == len(result["chunks"]) else "partial" if accepted else "unreviewed"
        return result

    @staticmethod
    def _review_identity(job, chunk):
        return _hash({"sourceRevision": job["sourceRevision"], "model": job["modelRevision"], "source": job["sourceFingerprint"], "text": chunk["text"], "spokenText": chunk["spokenText"], "voice": chunk["voiceHash"], "seed": chunk.get("selectedSeed", chunk["seed"]), "selectedAttempt": chunk.get("selectedAttempt"), "settings": job["settings"]})

    def _review_applies(self, job, chunk):
        review = chunk.get("manualReview") or {}
        return bool(review.get("accepted") and chunk["status"] == "ready" and review.get("identity") == self._review_identity(job, chunk))

    def review(self, job_id, request):
        """Record the author's listening decision separately from recognition results."""
        if not isinstance(request, dict) or not isinstance(request.get("accepted"), bool):
            raise ValueError("accepted must be true or false.")
        note = request.get("note", "")
        if not isinstance(note, str) or len(note) > 2000:
            raise ValueError("A listening review note must be text of at most 2000 characters.")
        chunk_id = request.get("chunkId")
        if chunk_id is not None and not isinstance(chunk_id, str):
            raise ValueError("chunkId must identify a saved narration chunk.")
        with self._lock:
            job = self._job(job_id)
            selected = [c for c in job["chunks"] if chunk_id is None or c["id"] == chunk_id]
            if not selected:
                raise KeyError("Unknown narration chunk for listening review.")
            records = []
            for chunk in selected:
                if request["accepted"]:
                    if chunk["status"] != "ready" or job.get("verify") and not chunk.get("qaComplete"):
                        raise ValueError("Wait for the selected chunk's rendering and content checks before accepting it.")
                    path = self._chunk_path(job, chunk)
                    try:
                        _wav_info(path)
                        audio_hash = hashlib.sha256(path.read_bytes()).hexdigest()
                    except (OSError, ValueError, wave.Error, EOFError) as error:
                        raise ValueError("The saved audio is missing or damaged. Reopen and resume this narration before reviewing it.") from error
                else:
                    audio_hash = (chunk.get("manualReview") or {}).get("audioHash")
                records.append({"accepted": request["accepted"], "note": note.strip(), "reviewedAt": _now(), "sourceRevision": job["sourceRevision"], "selectedAttempt": chunk.get("selectedAttempt"), "selectedSeed": chunk.get("selectedSeed", chunk["seed"]), "audioHash": audio_hash, "identity": self._review_identity(job, chunk)})
            for chunk, record in zip(selected, records):
                chunk["manualReview"] = record
                chunk["reviewHistory"] = [*chunk.get("reviewHistory", []), copy.deepcopy(record)][-50:]
            self._persist(job)
            return self._public(job)

    def list_jobs(self, project_id):
        with self._lock:
            return [self._public(j) for j in sorted(self._jobs.values(), key=lambda j: j["createdAt"], reverse=True) if j["projectId"] == project_id]

    def _job(self, job_id):
        if job_id not in self._jobs:
            raise KeyError("Unknown narration job.")
        return self._jobs[job_id]

    def get_job(self, job_id):
        with self._lock:
            return self._public(self._job(job_id))

    def cancel(self, job_id):
        with self._lock:
            job = self._job(job_id)
            if job["status"] not in TERMINAL:
                active = any(c["status"] in ("generating", "checking") for c in job["chunks"])
                job["status"] = "cancelling" if active else "cancelled"
                job["message"] = "Cancelling after the current chunk; completed audio will be retained." if active else "Cancelled. Completed chunks are retained for resumption."
                self._persist(job)
            return self._public(job)

    def resume(self, job_id):
        with self._lock:
            job = self._job(job_id)
            if job["status"] not in ("cancelled", "failed", "interrupted"):
                return self._public(job)
            if job.get("modelRevision") != self.runtime["modelRevision"] or job.get("sourceFingerprint") != self.runtime["sourceRevision"]:
                raise ValueError("The speech engine changed since this job was frozen. Start a new narration to avoid mixing engine versions.")
            for chunk in job["chunks"]:
                if chunk["status"] == "ready":
                    try:
                        _wav_info(self._chunk_path(job, chunk))
                    except (OSError, ValueError, wave.Error, EOFError):
                        chunk["status"] = "queued"
                        chunk.pop("audioUrl", None)
                        chunk.pop("manualReview", None)
                else:
                    chunk["status"] = "queued"
            job["status"] = "queued"
            job["message"] = "Resuming retained chunks."
            job.pop("error", None)
            self._persist(job)
            self._enqueue(job)
            return self._public(job)

    def audio_path(self, job_id, chunk_id=None):
        with self._lock:
            job = self._job(job_id)
            if chunk_id is not None:
                chunk = next((c for c in job["chunks"] if c["id"] == chunk_id), None)
                if chunk is not None and chunk["status"] == "ready":
                    path = self._chunk_path(job, chunk)
                elif any(chunk_id == f"{c['id']}.take-{attempt['index'] + 1}" for c in job["chunks"] for attempt in c.get("qaAttempts", [])):
                    path = self.root / "jobs" / job["id"] / (chunk_id + ".wav")
                else:
                    raise KeyError("This narration chunk is not available.")
            else:
                if job["status"] != "ready":
                    raise KeyError("The combined narration is not ready.")
                path = self.root / "jobs" / job["id"] / ("narration." + job["format"])
            if not path.is_file() or not path.resolve().is_relative_to((self.root / "jobs").resolve()):
                raise KeyError("Narration audio is missing.")
            return path

    def _chunk_path(self, job, chunk):
        return self.root / "jobs" / job["id"] / (chunk["id"] + ".wav")

    def _enqueue(self, job):
        self._sequence += 1
        self._queue.put((10 if job["request"].get("scope") == "collation" else 1, self._sequence, job["id"]))

    def _run(self):
        while not self._stopping.is_set():
            try:
                _, _, job_id = self._queue.get(timeout=.2)
            except queue.Empty:
                continue
            with self._lock:
                job = self._jobs[job_id]
                if job["status"] in TERMINAL:
                    continue
            try:
                self._step(job)
            except Exception as exc:
                with self._lock:
                    job["status"] = "interrupted" if self._stopping.is_set() else ("cancelled" if job["status"] in ("cancelling", "cancelled") else "failed")
                    job["message"] = str(exc)
                    job["error"] = str(exc)
                    for chunk in job["chunks"]:
                        if chunk["status"] in ("generating", "checking"):
                            chunk["status"] = "queued"
                    self._persist(job)
            finally:
                self._queue.task_done()

    def _step(self, job):
        with self._lock:
            if job["status"] in TERMINAL:
                return
            if job["status"] == "cancelling":
                job["status"] = "cancelled"
                self._persist(job)
                return
            chunk = next((chunk for chunk in job["chunks"] if chunk["status"] != "ready"), None)
        if chunk is None:
            self._assemble(job)
            return
        with self._lock:
            job["status"] = "generating"
            chunk["status"] = "generating"
            job["message"] = f"Generating chunk {job['chunks'].index(chunk) + 1} of {len(job['chunks'])}."
            self._persist(job)
        cached = self.root / "cache" / (chunk["cacheKey"] + ".wav")
        valid_cache = False
        if cached.exists():
            try:
                _wav_info(cached)
                valid_cache = True
            except (OSError, ValueError, wave.Error, EOFError):
                pass
        if not valid_cache:
            capabilities = self.capabilities()
            if not capabilities["available"]:
                raise RuntimeError(capabilities["reason"])
            response = self._invoke_worker({"operation": "generate", "text": chunk["spokenText"], "voiceId": chunk["voiceId"], "voiceHash": chunk["voiceHash"], "referencePath": str(self.root / "voices" / chunk["voiceId"] / "reference.wav") if chunk["voiceId"] != "default" else None, "seed": chunk["seed"], "settings": job["settings"], "output": str(cached)}, timeout=600)
            if not response.get("ok"):
                raise RuntimeError(response.get("error", "Speech synthesis failed."))
        info = _wav_info(cached)
        destination = self._chunk_path(job, chunk)
        temporary = destination.with_suffix(".tmp.wav")
        shutil.copyfile(cached, temporary)
        os.replace(temporary, destination)
        if job.get("verify"):
            self._verify_chunk(job, chunk)
            info = _wav_info(destination)
        with self._lock:
            chunk_ready = not job.get("verify") or chunk.get("qaComplete", False)
            chunk.update({"status": "ready" if chunk_ready else "queued", "seconds": info["seconds"], "sampleRate": info["sampleRate"], "cached": valid_cache, "audioUrl": f"/api/speech/jobs/{job['id']}/chunks/{chunk['id']}"})
            job["progress"] = sum(c["status"] == "ready" for c in job["chunks"]) / len(job["chunks"])
            if job["status"] == "cancelling":
                job["status"] = "cancelled"
                job["message"] = "Cancelled after completing the current chunk. Resume to continue."
            else:
                job["status"] = "queued"
                self._enqueue(job)
            self._persist(job)

    def _assemble(self, job):
        with self._lock:
            if job["status"] in ("cancelled", "cancelling"):
                return
            job["status"] = "preparing"
            job["message"] = "Assembling saved narration chunks."
            self._persist(job)
        output = self.root / "jobs" / job["id"] / "narration.wav"
        temporary = output.with_name("narration.tmp.wav")
        first = _wav_info(self._chunk_path(job, job["chunks"][0]))
        position = 0
        with wave.open(str(temporary), "wb") as combined:
            combined.setnchannels(first["channels"])
            combined.setsampwidth(2)
            combined.setframerate(first["sampleRate"])
            for index, chunk in enumerate(job["chunks"]):
                if self._stopping.is_set() or job["status"] in ("cancelled", "cancelling"):
                    raise RuntimeError("Audio assembly stopped. Resume to rebuild from the retained chunks.")
                if index:
                    pause_frames = round(first["sampleRate"] * job["settings"]["pauseSeconds"])
                    combined.writeframes(b"\0" * pause_frames * first["channels"] * 2)
                    position += pause_frames
                chunk["startSeconds"] = position / first["sampleRate"]
                with wave.open(str(self._chunk_path(job, chunk)), "rb") as audio:
                    if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (first["sampleRate"], first["channels"], 2):
                        raise RuntimeError("Narration chunks have incompatible audio formats.")
                    while frames := audio.readframes(65536):
                        combined.writeframes(frames)
                    position += audio.getnframes()
        os.replace(temporary, output)
        if job["format"] != "wav":
            target = output.with_suffix("." + job["format"])
            converted = target.with_name("narration.tmp." + job["format"])
            encoder = ["-c:a", "libmp3lame", "-q:a", "2"] if job["format"] == "mp3" else ["-c:a", "flac"]
            command = [self.runtime["ffmpeg"], "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(output), *encoder, str(converted)]
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, **_hidden_process_options())
            deadline = time.monotonic() + 300
            try:
                while True:
                    if self._stopping.is_set() or job["status"] in ("cancelled", "cancelling"):
                        raise RuntimeError("Audio conversion stopped. Resume to rebuild from retained chunks.")
                    if time.monotonic() >= deadline:
                        raise RuntimeError("Audio conversion timed out. The saved WAV and chunks are retained.")
                    try:
                        _, errors = process.communicate(timeout=.2)
                        break
                    except subprocess.TimeoutExpired:
                        continue
                if process.returncode:
                    raise RuntimeError("Audio conversion failed: " + errors[-1500:])
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                for pipe in (process.stdout, process.stderr):
                    if pipe:
                        pipe.close()
            os.replace(converted, target)
        with self._lock:
            if job["status"] in ("cancelling", "cancelled"):
                job["status"] = "cancelled"
            else:
                review_status = "unreviewed"
                message = "Narration ready. Listen to review delivery and pronunciation."
                if job.get("verify"):
                    unresolved = sum(c.get("qa", {}).get("status") != "matched" for c in job["chunks"])
                    review_status = "needs_review" if unresolved else "content_checked"
                    message = f"Narration ready; {unresolved} chunk(s) need listening review after speech recognition checks." if unresolved else "Narration ready. The recognised words match the spoken text; listen to assess pronunciation and delivery."
                    job["verificationSummary"] = {"matched": len(job["chunks"]) - unresolved, "needsReview": unresolved, "model": "faster-whisper-base.en", "modelRevision": job.get("verificationModelRevision"), "comparisonVersion": QA_COMPARISON_VERSION}
                job.update({"status": "ready", "progress": 1, "message": message, "seconds": position / first["sampleRate"], "audioUrl": f"/api/speech/jobs/{job['id']}/audio", "reviewStatus": review_status, "alignment": "chunk"})
            self._persist(job)

    def _verify_chunk(self, job, chunk):
        """Retain every take and its transcript; select the smallest content error.

        A mismatch triggers at most two new seeded takes. Recogniser failure does
        not trigger speculative regeneration. Unresolved material stays playable
        and explicitly needs human listening review.
        """
        attempts = chunk.setdefault("qaAttempts", [])
        if job.get("verificationModelRevision") != self.runtime.get("qaModelRevision"):
            raise RuntimeError("The verification model changed since this job was frozen. Start a new verified narration.")
        maximum_attempts = 1 + job.get("verificationRetries", 1)
        destination = self._chunk_path(job, chunk)
        for attempt_index in range(maximum_attempts):
            with self._lock:
                if job["status"] == "cancelling" or self._stopping.is_set():
                    break
                job["status"] = "checking"
                chunk["status"] = "checking"
                job["message"] = f"Checking spoken content in chunk {job['chunks'].index(chunk) + 1}, take {attempt_index + 1}."
                self._persist(job)
            take = next((a for a in attempts if a.get("index") == attempt_index), None)
            take_path = destination.with_name(chunk["id"] + f".take-{attempt_index + 1}.wav")
            if take and take.get("qa") and take_path.is_file():
                if take["qa"]["status"] in ("matched", "error"):
                    break
                continue
            attempt_seed = (chunk["seed"] + 99991 * attempt_index) % 2**32
            if attempt_index:
                retry_cache = self.root / "cache" / (_hash({"initialCacheKey": chunk["cacheKey"], "retrySeed": attempt_seed}) + ".wav")
                valid_cache = False
                try:
                    _wav_info(retry_cache)
                    valid_cache = True
                except (OSError, ValueError, wave.Error, EOFError):
                    pass
                if not valid_cache:
                    response = self._invoke_worker({"operation": "generate", "text": chunk["spokenText"], "voiceId": chunk["voiceId"], "voiceHash": chunk["voiceHash"], "referencePath": str(self.root / "voices" / chunk["voiceId"] / "reference.wav") if chunk["voiceId"] != "default" else None, "seed": attempt_seed, "settings": job["settings"], "output": str(retry_cache)}, timeout=600)
                    if not response.get("ok"):
                        raise RuntimeError(response.get("error", "Verification retry synthesis failed."))
                source = retry_cache
            else:
                source = destination
            temporary = take_path.with_name(take_path.name + ".tmp")
            shutil.copyfile(source, temporary)
            os.replace(temporary, take_path)
            if take is None:
                take = {"index": attempt_index, "seed": attempt_seed, "file": take_path.name, "seconds": _wav_info(take_path)["seconds"], "createdAt": _now()}
                attempts.append(take)
            try:
                response = self._invoke_qa_worker({"operation": "transcribe", "path": str(take_path)}, timeout=180)
                if not response.get("ok"):
                    raise RuntimeError(response.get("error", "Local speech verification failed."))
                qa = compare_transcript(chunk["spokenText"], response["transcript"])
                qa.update({"model": "faster-whisper-base.en", "modelRevision": self.runtime.get("qaModelRevision"), "checkedAt": _now(), "recognitionSeconds": response.get("seconds"), "segments": response.get("segments", [])})
            except Exception as exc:
                if self._stopping.is_set():
                    raise
                qa = {"status": "error", "matched": False, "expected": chunk["spokenText"], "transcript": "", "differences": [], "error": str(exc), "checkedAt": _now(), "model": "faster-whisper-base.en", "modelRevision": self.runtime.get("qaModelRevision"), "comparisonVersion": QA_COMPARISON_VERSION}
            with self._lock:
                take["qa"] = qa
                self._persist(job)
            if qa["status"] in ("matched", "error"):
                break
        checked = [a for a in attempts if a.get("qa") and (destination.parent / a["file"]).is_file()]
        if checked:
            selected = min(checked, key=lambda a: (a["qa"].get("wordErrorRate", float("inf")), a["index"]))
            selected_path = destination.parent / selected["file"]
            temporary = destination.with_suffix(".tmp.wav")
            shutil.copyfile(selected_path, temporary)
            os.replace(temporary, destination)
            chunk["qa"] = copy.deepcopy(selected["qa"])
            chunk["selectedAttempt"] = selected["index"]
            chunk["selectedSeed"] = selected["seed"]
            chunk["qaComplete"] = any(a["qa"]["status"] in ("matched", "error") for a in checked) or len(checked) >= maximum_attempts
        else:
            chunk["qa"] = {"status": "pending", "matched": False, "note": "Content check has not completed."}
            chunk["qaComplete"] = False
        with self._lock:
            self._persist(job)

    def _start_worker(self):
        if self._process is not None and self._process.poll() is None:
            return
        self._close_worker()
        environment = os.environ.copy()
        environment.update({"HF_HOME": str(self.root / "model-cache"), "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "PYTHONUNBUFFERED": "1", "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1", "TOKENIZERS_PARALLELISM": "false", "PYTHONPATH": self.runtime["source"]})
        self._stderr = (self.root / "worker.log").open("a", encoding="utf-8")
        self._process = subprocess.Popen([self.runtime["python"], "-u", str(Path(__file__).with_name("speech_worker.py")), "--model", self.runtime["model"]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self._stderr, text=True, encoding="utf-8", errors="replace", env=environment, **_hidden_process_options())
        self._responses = queue.Queue()
        process, responses = self._process, self._responses
        def read_responses():
            try:
                for line in process.stdout:
                    try:
                        responses.put(json.loads(line))
                    except ValueError:
                        continue
            finally:
                responses.put({"ok": False, "error": "The Chatterbox worker exited. Resume to restart it; completed chunks are saved."})
        threading.Thread(target=read_responses, name="alder-speech-pipe", daemon=True).start()

    def _invoke_worker(self, payload, timeout=600):
        self._start_worker()
        request_id = uuid.uuid4().hex
        self._process.stdin.write(json.dumps({**payload, "id": request_id}) + "\n")
        self._process.stdin.flush()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._stopping.is_set():
                raise RuntimeError("Alder is shutting down; resume this narration after reopening.")
            try:
                response = self._responses.get(timeout=.2)
            except queue.Empty:
                continue
            if response.get("id") != request_id and "id" in response:
                continue
            if response.get("health"):
                self._worker_health = response["health"]
            if not response.get("ok"):
                self._close_worker()  # Fatal or generation error: discard mutable model state.
            return response
        self._close_worker()
        raise RuntimeError("Chatterbox timed out. Completed chunks remain saved; resume to retry with a fresh worker.")

    def _close_worker(self):
        process = self._process
        self._process = None
        if process is not None:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            for pipe in (process.stdin, process.stdout):
                if pipe:
                    pipe.close()
        if self._stderr:
            self._stderr.close()
            self._stderr = None

    def _start_qa_worker(self):
        if self._qa_process is not None and self._qa_process.poll() is None:
            return
        self._close_qa_worker()
        if not self.runtime.get("qaPythonPresent") or not self.runtime.get("qaModelPresent"):
            raise RuntimeError("The bundled speech content-check runtime or model is unavailable.")
        environment = os.environ.copy()
        environment.update({"HF_HOME": str(self.root / "model-cache"), "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "PYTHONUNBUFFERED": "1", "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1", "TOKENIZERS_PARALLELISM": "false", "PYTHONPATH": ""})
        self._qa_stderr = (self.root / "verification-worker.log").open("a", encoding="utf-8")
        self._qa_process = subprocess.Popen([self.runtime["qaPython"], "-u", str(Path(__file__).with_name("speech_qa_worker.py")), "--model", self.runtime["qaModel"]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self._qa_stderr, text=True, encoding="utf-8", errors="replace", env=environment, **_hidden_process_options())
        self._qa_responses = queue.Queue()
        process, responses = self._qa_process, self._qa_responses
        def read_responses():
            try:
                for line in process.stdout:
                    try:
                        responses.put(json.loads(line))
                    except ValueError:
                        continue
            finally:
                responses.put({"ok": False, "error": "The local speech verification worker exited."})
        threading.Thread(target=read_responses, name="alder-qa-pipe", daemon=True).start()

    def _invoke_qa_worker(self, payload, timeout=180):
        self._start_qa_worker()
        request_id = uuid.uuid4().hex
        self._qa_process.stdin.write(json.dumps({**payload, "id": request_id}) + "\n")
        self._qa_process.stdin.flush()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._stopping.is_set():
                raise RuntimeError("Alder is shutting down; content checks will resume after reopening.")
            try:
                response = self._qa_responses.get(timeout=.2)
            except queue.Empty:
                continue
            if response.get("id") != request_id and "id" in response:
                continue
            if response.get("health"):
                self._qa_health = response["health"]
            if not response.get("ok"):
                self._close_qa_worker()
            return response
        self._close_qa_worker()
        raise RuntimeError("Local speech verification timed out. Listen to this chunk before accepting it.")

    def _close_qa_worker(self):
        process = self._qa_process
        self._qa_process = None
        if process is not None:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            for pipe in (process.stdin, process.stdout):
                if pipe:
                    pipe.close()
        if self._qa_stderr:
            self._qa_stderr.close()
            self._qa_stderr = None

    def shutdown(self):
        self._stopping.set()
        self._thread.join(timeout=2)
        self._close_worker()
        self._close_qa_worker()
        self._thread.join(timeout=5)
        with self._lock:
            for job in self._jobs.values():
                if job["status"] not in TERMINAL:
                    job["status"] = "interrupted"
                    job["message"] = "Alder closed before this job finished. Resume to continue from saved chunks."
                    self._persist(job)
