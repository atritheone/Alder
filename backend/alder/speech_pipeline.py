"""Bounded synthesis/QA pipeline with durable acceptance and event delivery."""
from __future__ import annotations
from collections import deque
from concurrent.futures import ThreadPoolExecutor
import copy
import hashlib
import json
import os
from pathlib import Path
import queue
import shutil
import threading
import time
import wave

from .speech import SpeechService, _hash, _now, _atomic_json, _replace, _wav_info, compare_transcript
from .speech_metrics import SpeechMetrics
from .pronunciation import compare_pronounced
from .sapi import NATIVE_TIMING_VERSION, native_timings
from .speech_quality import QUALITY_VERSION, inspect_pcm, projected_sections, valid_timings, speech_projection
from .reading import word_timings, TIMING_VERSION
from .speech_comparison import VERSION as COMPARISON_VERSION

STOPPED = {"cancelling", "ready", "failed", "cancelled", "interrupted", "needs_review"}


class SpeechPipeline(SpeechService):
    def __init__(self, data_dir, project_root):
        self._queued = set()
        self._inflight = set()
        self._assembling = set()
        self._demand = {}
        self._events = {}
        self._signatures = {}
        self._orders = {}
        self._integrity = {}
        self._event_condition = threading.Condition()
        self._serial = threading.RLock()
        self._qa_serial = threading.RLock()
        self._check_locks = [threading.RLock() for _ in range(32)]
        self._pool = ThreadPoolExecutor(2, thread_name_prefix="alder-speech-pipeline")
        self._exports = ThreadPoolExecutor(1, thread_name_prefix="alder-speech-export")
        self._prepared = ThreadPoolExecutor(2, thread_name_prefix="alder-speech-prepare")
        self._last_work = time.monotonic()
        self._maintenance_at = time.monotonic()
        super().__init__(data_dir, project_root)
        self._event_condition = threading.Condition(self._lock)
        self.metrics = SpeechMetrics(self.root)

    def _metric(self, event, job=None, chunk=None, **fields):
        metrics = getattr(self, "metrics", None)
        if metrics:
            metrics.emit(event, jobId=job and job["id"], sectionId=chunk and chunk["id"], **fields)

    def capabilities(self):
        result = super().capabilities()
        result["controls"] = [name for name in result["controls"] if name != "verify"]
        result["verification"].update(required=True, maximumRetries=1, maximumSectionAttempts=6,
                                      secondaryAvailable=bool(self.runtime.get("qaSecondaryModel")), maximumInteractiveSectionAttempts=12)
        return result

    def submit(self, project, request):
        if "verify" in request and not isinstance(request["verify"], bool):
            raise ValueError("verify must be true or false.")
        sources = self._sources(project, request)
        if any(not s["voiceId"].startswith("sapi-") for s in sources) and not self.capabilities()["verification"]["available"]:
            raise ValueError("Speech checking is unavailable. Repair Alder's speech resources before reading.")
        with self._lock:
            # Base storage creates the frozen source and cache identities. Every
            # new pipeline job is checked, regardless of an older client's flag.
            result = super().submit(project, {**request, "verify": False})
            job = self._jobs[result["id"]]
            job.update(schemaVersion=2, verify=True, follow=True, verificationModelRevision=self.runtime.get("qaModelRevision"),
                       interactive=bool(request.get("interactive", False)), _pronunciation=copy.deepcopy(project.get("pronunciation", [])), _budgets={})
            for c in job["chunks"]:
                c["verificationStatus"] = "pending"
                c["playbackEligible"] = False
            self._demand[job["id"]] = {"index": 0, "speed": 1., "mode": "playing", "at": time.monotonic()}
            self._persist(job)
            self._metric("submitted", job, sections=len(job["chunks"]), inputHash=_hash(job["text"]))
            return self._public(job)

    def _eligible(self, job, chunk):
        return bool(job.get("schemaVersion") == 2 and chunk["status"] == "ready" and
                    (chunk.get("verificationStatus") == "accepted" or self._review_applies(job, chunk)) and self._intact(job, chunk))

    def _intact(self, job, chunk):
        expected = (chunk.get("manualReview") or {}).get("audioHash") if self._review_applies(job, chunk) else (chunk.get("qa") or {}).get("audioHash")
        if not expected:
            return False
        path = self._chunk_path(job, chunk)
        try:
            stat = path.stat()
            key = (str(path), stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
            actual = self._integrity.get(key)
            if actual is None:
                actual = hashlib.sha256(path.read_bytes()).hexdigest()
                if len(self._integrity) >= 512:
                    self._integrity.clear()
                self._integrity[key] = actual
            return actual == expected
        except OSError:
            return False

    def _public(self, job):
        result = super()._public(job)
        for key in list(result):
            if key.startswith("_"):
                result.pop(key)
        for c in result["chunks"]:
            c["playbackEligible"] = self._eligible(job, c)
            if not c["playbackEligible"]:
                c.pop("audioUrl", None)
        if not all(c["playbackEligible"] for c in result["chunks"]):
            result.pop("audioUrl", None)
            if result["status"] == "ready":
                result["status"] = "interrupted"
                result["message"] = "This saved recording needs checking. Resume to recover or verify its audio."
        return result

    def _persist(self, job):
        # All writers, including export completion, serialize manifests/events.
        with self._lock:
            job["eventSequence"] = job.get("eventSequence", 0) + 1
            super()._persist(job)
            signatures = self._signatures.setdefault(job["id"], {})
            changed = []
            for c in job["chunks"]:
                signature = _hash(c)
                if signatures.get(c["id"]) != signature:
                    item = copy.deepcopy(c)
                    item.pop("cacheKey", None)
                    item.pop("qaAttempts", None)
                    item["playbackEligible"] = self._eligible(job, c)
                    if not item["playbackEligible"]:
                        item.pop("audioUrl", None)
                    changed.append(item)
                    signatures[c["id"]] = signature
            header = {k: copy.deepcopy(v) for k, v in job.items() if k in {
                "status", "progress", "message", "error", "seconds", "eventSequence", "reviewStatus", "updatedAt"}}
            header["error"] = job.get("error")
            header["audioUrl"] = job.get("audioUrl") if all(self._eligible(job, c) for c in job["chunks"]) else None
            events = self._events.setdefault(job["id"], deque(maxlen=128))
            order = [c["id"] for c in job["chunks"]]
            event = {"sequence": job["eventSequence"], "header": header, "chunks": changed}
            if self._orders.get(job["id"]) != order:
                event["order"] = order
                self._orders[job["id"]] = order
                for retired in set(signatures) - set(order):
                    signatures.pop(retired, None)
            events.append(event)
            # Retain a short reconnect history for recent/live jobs only. Older
            # recordings remain on disk and reconnect through a fresh snapshot.
            if len(self._events) > 32:
                for old_id in list(self._events):
                    if len(self._events) <= 32:
                        break
                    if old_id != job["id"] and self._jobs.get(old_id, {}).get("status") in STOPPED and time.monotonic() - self._demand.get(old_id, {}).get("at", 0) > 15:
                        self._events.pop(old_id, None)
                        self._signatures.pop(old_id, None)
                        self._orders.pop(old_id, None)
            with self._event_condition:
                self._event_condition.notify_all()

    def events(self, job_id, after=0, wait=20):
        deadline = time.monotonic() + min(max(wait, 0), 20)
        while True:
            with self._lock:
                job = self._job(job_id)
                events = self._events.get(job_id, ())
                if not after or not events and after != job.get("eventSequence", 0) or after > job.get("eventSequence", 0) or events and after < events[0]["sequence"] - 1:
                    return {"sequence": job.get("eventSequence", 0), "snapshot": self._public(job), "reset": True}
                pending = [e for e in events if e["sequence"] > after]
                if pending:
                    return {"sequence": pending[-1]["sequence"], "events": copy.deepcopy(pending)}
                if time.monotonic() >= deadline or self._stopping.is_set():
                    return {"sequence": after, "events": []}
                self._event_condition.wait(max(0, deadline - time.monotonic()))

    def demand(self, job_id, request):
        index, speed, mode = request.get("index", 0), request.get("speed", 1.), request.get("mode", "playing")
        if not isinstance(index, int) or isinstance(index, bool) or not isinstance(speed, (float, int)) or not .25 <= speed <= 3 or mode not in {"playing", "paused", "stopped", "export"}:
            raise ValueError("Invalid playback demand.")
        with self._lock:
            job = self._job(job_id)
            if not 0 <= index < len(job["chunks"]):
                raise ValueError("Unknown reading section.")
            self._demand[job_id] = {"index": index, "speed": float(speed), "mode": mode, "at": time.monotonic()}
            if mode == "export":
                job["interactive"] = False
            if job["status"] == "buffered":
                job["status"] = "queued"
            self._enqueue(job)
            return {"ok": True}

    def prepare(self, voice_id):
        voice = self._voice(voice_id)
        self._last_work = time.monotonic()
        if voice_id.startswith("sapi-"):
            from .sapi import prepare
            prepare()
            return {"ready": True, "engine": "sapi"}
        if not self.capabilities()["verification"]["available"]:
            raise ValueError("Speech checking resources are missing.")
        checked_future = self._prepared.submit(self._prepare_checker)
        with self._serial:
            result = self._invoke_worker({"operation": "prepare", "voiceHash": voice.get("hash", "default"),
                                          "referencePath": str(self.root / "voices" / voice_id / "reference.wav") if voice_id != "default" else None}, timeout=90)
        if not result.get("ok"):
            raise RuntimeError(result.get("error", "Voice preparation failed."))
        checked = checked_future.result()
        if not checked.get("ok"):
            raise RuntimeError(checked.get("error", "Checker preparation failed."))
        self._metric("prepared", device=(result.get("health") or {}).get("device"))
        return {"ready": True, "engine": "chatterbox-turbo", "worker": result.get("health")}

    def _prepare_checker(self):
        with self._qa_serial:
            return self._invoke_qa_worker({"operation": "prepare"}, timeout=45)

    def _enqueue(self, job):
        if job["id"] in self._queued or job["status"] in STOPPED:
            return
        self._sequence += 1
        self._queued.add(job["id"])
        demand = self._demand.get(job["id"], {})
        priority = 0 if job.get("interactive") and demand.get("mode", "playing") == "playing" else 10
        self._queue.put((priority, self._sequence, job["id"]))

    def _wanted(self, job, index):
        if not job.get("interactive"):
            return True
        d = self._demand.get(job["id"], {})
        if d.get("mode") == "stopped" or time.monotonic() - d.get("at", 0) > 15:
            return False
        current = d.get("index", 0)
        if index < current:
            return True
        recent = job["chunks"][max(0, current - 4):current + 8]
        recovery = max((c.get("processingSeconds", 0) for c in recent), default=0)
        budget = (4 if d.get("mode") == "paused" else min(45, max(12, recovery * 1.5))) * d.get("speed", 1)
        ahead = sum(c.get("seconds", max(.3, len(c["spokenText"].split()) / 2.5)) + job["settings"]["pauseSeconds"] for c in job["chunks"][current:index])
        return index - current < 8 and ahead < budget

    def _run(self):
        while not self._stopping.is_set():
            try:
                _, _, job_id = self._queue.get(timeout=.1)
            except queue.Empty:
                self._maintenance()
                continue
            try:
                with self._lock:
                    self._queued.discard(job_id)
                    job = self._jobs[job_id]
                    if job["status"] in STOPPED or job_id in self._assembling:
                        continue
                    if len(self._inflight) >= 2:
                        self._enqueue(job)
                        defer = True
                    else:
                        defer = False
                        chunk = next((c for c in job["chunks"] if c["status"] == "queued"), None)
                        if chunk is None:
                            if not any(j == job_id for j, _ in self._inflight):
                                if all(self._eligible(job, c) for c in job["chunks"]):
                                    self._assembling.add(job_id)
                                    self._exports.submit(self._finish_export, job)
                                else:
                                    self._hold_unresolved(job)
                                    self._persist(job)
                            continue
                        if not self._wanted(job, job["chunks"].index(chunk)):
                            if job["status"] != "buffered":
                                job["status"] = "buffered"
                                self._persist(job)
                            continue
                        chunk["status"] = "generating"
                        job["status"] = "generating"
                        self._inflight.add((job_id, chunk["id"]))
                        self._persist(job)
                        self._pool.submit(self._process_section, job, chunk)
                        self._enqueue(job)
                if defer:
                    self._stopping.wait(.015)
            except Exception as exc:
                with self._lock:
                    job = self._jobs.get(job_id)
                    if job:
                        job.update(status="failed", error=f"Speech could not be saved: {exc}")
                self._metric("scheduler_failure", job, errorType=type(exc).__name__)
            finally:
                self._queue.task_done()

    def _cancelled(self, job):
        return self._stopping.is_set() or job["status"] in {"cancelling", "cancelled", "interrupted"}

    def _copy_audio(self, source, destination):
        temporary = destination.with_suffix(".tmp.wav")
        temporary.unlink(missing_ok=True)
        try:
            os.link(source, temporary)
        except OSError:
            shutil.copyfile(source, temporary)
        _replace(temporary, destination)

    def _take(self, job, chunk, seed):
        cache = self.root / "cache" / (_hash({"synthesis": chunk["cacheKey"], "seed": seed, **({"nativeTimings": NATIVE_TIMING_VERSION} if chunk["voiceId"].startswith("sapi-") else {})}) + ".wav")
        try:
            _wav_info(cache)
            if chunk["voiceId"].startswith("sapi-"):
                json.loads(cache.with_suffix(".native.json").read_text("utf-8"))["words"]
            if self._cancelled(job):
                raise InterruptedError("Reading stopped.")
            os.utime(cache, None)
            return cache, True
        except (OSError, ValueError, KeyError, wave.Error, EOFError):
            pass
        with self._serial:
            if self._cancelled(job):
                raise InterruptedError("Reading stopped.")
            try:
                _wav_info(cache)
                if chunk["voiceId"].startswith("sapi-"):
                    json.loads(cache.with_suffix(".native.json").read_text("utf-8"))["words"]
                cached = True
            except (OSError, ValueError, KeyError, wave.Error, EOFError):
                cached = False
            if not cached:
                self._last_work = time.monotonic()
                started = time.monotonic()
                if chunk["voiceId"].startswith("sapi-"):
                    from .sapi import render
                    response = render(chunk["voiceId"], chunk["spokenText"], cache, job["settings"].get("sapiRate", 0), job["settings"].get("sapiVolume", 100), job["settings"].get("sapiPitch", 0))
                    native = response.get("words", [])
                    seconds = _wav_info(cache)["seconds"]
                    words = native_timings(native, seconds)
                    _atomic_json(cache.with_suffix(".native.json"), {"words": words})
                else:
                    response = self._invoke_worker({"operation": "generate", "text": chunk["spokenText"], "seed": seed,
                        "settings": job["settings"], "voiceHash": chunk["voiceHash"], "output": str(cache),
                        "cancelPath": str(self.root / "jobs" / job["id"] / "cancel.flag"),
                        "referencePath": str(self.root / "voices" / chunk["voiceId"] / "reference.wav") if chunk["voiceId"] != "default" else None}, timeout=90)
                    if not response.get("ok"):
                        if response.get("cancelled"):
                            raise InterruptedError("Reading stopped.")
                        raise RuntimeError(response.get("error", "Speech generation failed."))
                self._metric("synthesized", job, chunk, seconds=time.monotonic() - started, seed=seed,
                             device=(response.get("health") or {}).get("device"))
            os.utime(cache, None)
        return cache, cached

    def _check(self, job, chunk, cache):
        # Bounded striped locks deduplicate identical concurrent checks/publication.
        with self._check_locks[int(_hash(str(cache))[:8], 16) % len(self._check_locks)]:
            return self._check_locked(job, chunk, cache)

    def _check_locked(self, job, chunk, cache):
        audio_hash = hashlib.sha256(cache.read_bytes()).hexdigest()
        identity = _hash({"audio": audio_hash, "text": chunk["spokenText"], "pronunciation": chunk.get("pronunciationMap", []), "pronunciationComparison": 1, "version": QUALITY_VERSION,
                          "model": self.runtime.get("qaModelRevision"), "secondary": self.runtime.get("qaSecondaryRevision"), "voice": chunk["voiceId"], "comparison": COMPARISON_VERSION, **({"nativeTimings": NATIVE_TIMING_VERSION} if chunk["voiceId"].startswith("sapi-") else {})})
        path = self.root / "cache" / (identity + ".check.json")
        try:
            check = json.loads(path.read_text("utf-8"))
            if (check.get("audioHash") == audio_hash and check.get("status") in {"matched", "needs_review"}
                and check.get("acoustic", {}).get("version") == QUALITY_VERSION
                and isinstance(check.get("words"), list)
                and check.get("matched") is compare_pronounced(chunk, check.get("transcript", ""))["matched"]):
                os.utime(path, None)
                return check, True
        except (OSError, ValueError):
            pass
        try:
            acoustic = inspect_pcm(cache, chunk["spokenText"])
        except (OSError, ValueError, wave.Error, EOFError) as exc:
            return {"status": "needs_review", "matched": False, "audioHash": audio_hash,
                    "error": str(exc)}, False
        if not acoustic["accepted"]:
            return {"status": "needs_review", "matched": False, "acoustic": acoustic, "audioHash": audio_hash,
                    "error": ", ".join(acoustic["reasons"])}, False
        with self._lock:
            chunk["status"] = "checking"
            chunk["verificationStatus"] = "checking"
            self._persist(job)
        started = time.monotonic()
        if chunk["voiceId"].startswith("sapi-"):
            response = json.loads(cache.with_suffix(".native.json").read_text("utf-8"))
            transcript = " ".join(w["text"] for w in response["words"])
            model = "sapi-events"
        else:
            response = None
            for attempt in range(2):
                if self._cancelled(job):
                    raise InterruptedError("Reading stopped.")
                try:
                    with self._qa_serial:
                        response = self._invoke_qa_worker({"operation": "transcribe", "path": str(cache)}, timeout=45)
                except (RuntimeError, OSError) as exc:
                    response = {"ok": False, "error": str(exc)}
                if response.get("ok"):
                    break
            if not response or not response.get("ok"):
                raise RuntimeError((response or {}).get("error", "The speech checker could not finish."))
            transcript = response["transcript"]
            model = "faster-whisper-base.en"
        check = compare_pronounced(chunk, transcript)
        if not check["matched"] and model != "sapi-events" and self.runtime.get("qaSecondaryModel"):
            if self._cancelled(job):
                raise InterruptedError("Reading stopped.")
            try:
                with self._qa_serial:
                    alternative = self._invoke_qa_worker({"operation": "transcribe", "path": str(cache), "secondaryModel": self.runtime["qaSecondaryModel"]}, timeout=20)
                if alternative.get("ok"):
                    second_check = compare_pronounced(chunk, alternative["transcript"])
                    if second_check["matched"]:
                        second_check["primaryCheck"] = check
                        check, response, model = second_check, alternative, "faster-whisper-small.en"
                    else:
                        check["secondaryCheck"] = second_check
            except (RuntimeError, OSError) as exc:
                check["secondaryError"] = str(exc)
        check.update(audioHash=audio_hash, words=response.get("words", []), acoustic=acoustic,
                     model=model, modelRevision=self.runtime.get("qaSecondaryRevision") if model == "faster-whisper-small.en" else self.runtime.get("qaModelRevision"), checkedAt=_now(),
                     recognitionSeconds=time.monotonic() - started)
        self._metric("checked", job, chunk, seconds=check["recognitionSeconds"], matched=check["matched"])
        # A completed negative check is reusable too; it still cannot grant playback.
        # Worker errors and incomplete checks never reach this publication point.
        if not check.get("secondaryError"):
            _atomic_json(path, check)
        return check, False

    def _process_section(self, job, chunk):
        started = time.monotonic()
        try:
            attempts = chunk.setdefault("qaAttempts", [])
            root = chunk.get("budgetRoot", chunk["id"])
            with self._lock:
                budget = job.setdefault("_budgets", {}).setdefault(root, {"attempts": 0, "seconds": 0})
            selected = None
            # A short passage cannot use split recovery. Use the same fresh-take
            # sequence that an explicit Play retry used to require, automatically.
            leaf = chunk.get("splitDepth") or (len(chunk["spokenText"]) <= 125 and len(chunk["spokenText"].split()) <= 22)
            attempts_allowed = 6 if job.get("interactive") and leaf else 1 + min(1, job.get("verificationRetries", 1))
            for index in range(attempts_allowed):
                if self._cancelled(job):
                    raise InterruptedError("Reading stopped.")
                with self._lock:
                    if budget["attempts"] >= (12 if job.get("interactive") else 6) or budget["seconds"] + time.monotonic() - started > 180:
                        break
                    budget["attempts"] += 1
                seed = (chunk["seed"] + 200003 * (index // 2) + 99991 * (index % 2)) % 2**32
                try:
                    cache, cached = self._take(job, chunk, seed)
                except InterruptedError:
                    raise
                except (RuntimeError, ValueError, OSError) as exc:
                    self._metric("generation_retry", job, chunk, errorType=type(exc).__name__)
                    chunk.setdefault("generationFailures", []).append({"error": str(exc), "seed": seed})
                    continue
                check, check_cached = self._check(job, chunk, cache)
                take_path = self._chunk_path(job, chunk).with_name(chunk["id"] + f".take-{len(attempts)+1}.wav")
                self._copy_audio(cache, take_path)
                take = {"index": len(attempts), "seed": seed, "file": take_path.name,
                        "seconds": _wav_info(cache)["seconds"], "qa": check, "createdAt": _now()}
                attempts.append(take)
                if selected is None or check.get("wordErrorRate", 999) < selected["qa"].get("wordErrorRate", 999):
                    selected = take
                if check["matched"]:
                    selected = take
                    chunk.update(cached=cached, checkCached=check_cached)
                    break
                chunk["verificationStatus"] = "retrying"
                self._metric("rejected", job, chunk, attempt=index)
            if selected is None:
                with self._lock:
                    if self._split_section(job, chunk, root):
                        job["status"] = "queued"
                        return
                raise RuntimeError("Could not read this passage. Press Play to retry." if job.get("interactive") else "Speech retry budget exhausted. Review the passage before retrying.")
            destination = self._chunk_path(job, chunk)
            self._copy_audio(destination.parent / selected["file"], destination)
            info = _wav_info(destination)
            check = selected["qa"]
            timings = word_timings(chunk["text"], chunk["spokenText"], check.get("words", []), chunk.get("pronunciationMap", []))
            with self._lock:
                chunk.update(status="ready", qa=check, qaComplete=True, selectedAttempt=selected["index"], selectedSeed=selected["seed"],
                             seconds=info["seconds"], sampleRate=info["sampleRate"], processingSeconds=time.monotonic() - started,
                             verificationStatus="accepted" if check["matched"] else "needs_review",
                             wordTimings=valid_timings(timings, chunk["text"], info["seconds"]), timingVersion=TIMING_VERSION,
                             audioUrl=f"/api/speech/jobs/{job['id']}/chunks/{chunk['id']}")
                if not check["matched"]:
                    self._split_section(job, chunk, root)
                job["progress"] = sum(self._eligible(job, c) for c in job["chunks"]) / len(job["chunks"])
                if not self._cancelled(job):
                    if any(c.get("verificationStatus") == "check_failed" for c in job["chunks"]):
                        job["status"] = "failed"
                    elif any(c.get("verificationStatus") == "needs_review" for c in job["chunks"]):
                        self._hold_unresolved(job)
                    else:
                        job["status"] = "queued"
                self._metric("section_ready", job, chunk, seconds=time.monotonic() - started, accepted=check["matched"])
        except InterruptedError:
            with self._lock:
                chunk["status"] = "queued"
                chunk["verificationStatus"] = "pending"
        except Exception as exc:
            with self._lock:
                chunk["status"] = "queued"
                chunk["verificationStatus"] = "check_failed"
                chunk["error"] = str(exc)
                if not self._cancelled(job):
                    job["status"] = "failed"
                    job["error"] = str(exc)
                self._metric("failure", job, chunk, errorType=type(exc).__name__)
        finally:
            with self._lock:
                if 'budget' in locals():
                    budget["seconds"] += time.monotonic() - started
                self._inflight.discard((job["id"], chunk["id"]))
                if job["status"] == "cancelling" and not any(j == job["id"] for j, _ in self._inflight):
                    job["status"] = "cancelled"
                try:
                    self._persist(job)
                    self._enqueue(job)
                except OSError as exc:
                    job.update(status="failed", error=f"Speech could not be saved: {exc}")

    def _hold_unresolved(self, job):
        job["status"] = "failed" if job.get("interactive") else "needs_review"
        if job.get("interactive"):
            job["error"] = "Could not read this passage. Press Play to retry."

    def _split_section(self, job, chunk, root):
        if chunk.get("splitDepth") or self._cancelled(job):
            return False
        children = projected_sections(chunk["text"], job.get("_pronunciation", []), chunk["voiceId"], 125, 22)
        if len(children) <= 1:
            return False
        parts = []
        for n, part in enumerate(children):
            key = _hash({"parent": chunk["cacheKey"], "text": part["spokenText"], "splitVersion": 1})
            parts.append({**part, "id": chunk["id"] + f"-split-{n}", "cacheKey": key,
                "sourceStart": chunk["sourceStart"] + part["sourceStart"], "sourceEnd": chunk["sourceStart"] + part["sourceEnd"],
                "voiceId": chunk["voiceId"], "voiceHash": chunk["voiceHash"], "seed": chunk["seed"],
                "status": "queued", "verificationStatus": "pending", "splitDepth": 1, "budgetRoot": root})
        at = job["chunks"].index(chunk)
        job["chunks"][at:at+1] = parts
        job.setdefault("_retired", []).append(chunk)
        self._metric("split", job, chunk, children=len(parts))
        return True

    def _finish_export(self, job):
        try:
            if all(self._eligible(job, c) for c in job["chunks"]):
                super()._assemble(job)
        except Exception as exc:
            with self._lock:
                if not self._cancelled(job):
                    job.update(status="failed", error=str(exc))
                self._persist(job)
        finally:
            with self._lock:
                self._assembling.discard(job["id"])
                if job["status"] == "ready" and not all(self._eligible(job, c) for c in job["chunks"]):
                    job.update(status="needs_review", message="Review the unresolved passage before exporting.")
                    job.pop("audioUrl", None)
                    self._persist(job)

    def cancel(self, job_id):
        with self._lock:
            job = self._job(job_id)
            self._demand[job_id] = {"mode": "stopped", "at": time.monotonic()}
            (self.root / "jobs" / job_id / "cancel.flag").touch()
            if job["status"] != "ready":
                job["status"] = "cancelling" if any(j == job_id for j, _ in self._inflight) else "cancelled"
                self._persist(job)
            self._metric("stop", job)
            return self._public(job)

    def resume(self, job_id):
        with self._lock:
            job = self._job(job_id)
            if any(j == job_id for j, _ in self._inflight) and job["status"] == "cancelling":
                return self._public(job)
            if job.get("modelRevision") != self.runtime["modelRevision"] or job.get("sourceFingerprint") != self.runtime["sourceRevision"]:
                raise ValueError("The speech engine changed. Start a new reading to retain consistent audio.")
            if (job["status"] == "needs_review" and not job.get("interactive")) or job["status"] == "ready" and all(self._eligible(job, c) for c in job["chunks"]) or any(j == job_id for j, _ in self._inflight):
                return self._public(job)
            job.update(schemaVersion=2, verify=True, follow=True, verificationModelRevision=self.runtime.get("qaModelRevision"))
            (self.root / "jobs" / job_id / "cancel.flag").unlink(missing_ok=True)
            for c in job["chunks"]:
                try:
                    valid = self._eligible(job, c) and inspect_pcm(self._chunk_path(job, c), c["spokenText"])["accepted"]
                except (OSError, ValueError, wave.Error, EOFError):
                    valid = False
                if not valid:
                    spoken, mapping = speech_projection(c["text"], job.get("_pronunciation", []), c["voiceId"])
                    if spoken != c["spokenText"]:
                        c["cacheKey"] = _hash({"previous": c["cacheKey"], "spoken": spoken, "speechTextVersion": 1})
                        c["spokenText"] = spoken
                        c["pronunciationMap"] = mapping
                    if c.get("verificationStatus") == "needs_review":
                        # Retry wording failures with fresh speech, preserving checked neighbours.
                        rounds = max(1, (len(c.get("qaAttempts", [])) + 1) // 2)
                        c["seed"] = (c["seed"] + 200003 * rounds) % 2**32
                    c.update(status="queued", verificationStatus="pending")
                    c.pop("error", None)
                    c.pop("manualReview", None)
                    c.pop("audioUrl", None)
            job["status"] = "queued"
            job["_budgets"] = {}  # An explicit retry starts a fresh bounded recovery session.
            job["error"] = ""
            self._demand.setdefault(job_id, {}).update(mode="playing", at=time.monotonic())
            self._persist(job)
            self._enqueue(job)
            return self._public(job)

    def review(self, job_id, request):
        with self._lock:
            super().review(job_id, request)
            job = self._job(job_id)
            job["status"] = "queued" if all(c["status"] != "ready" or self._eligible(job, c) for c in job["chunks"]) else "needs_review"
            job.pop("audioUrl", None)
            self._persist(job)
            self._enqueue(job)
            return self._public(job)

    def audio_path(self, job_id, chunk_id=None):
        with self._lock:
            job = self._job(job_id)
            chunk = next((c for c in job["chunks"] if c["id"] == chunk_id), None)
            if chunk_id is None and not all(self._eligible(job, c) for c in job["chunks"]) or chunk and not self._eligible(job, chunk):
                raise KeyError("This speech needs checking or listening review before playback.")
            return super().audio_path(job_id, chunk_id)

    def _maintenance(self):
        now = time.monotonic()
        if now - self._maintenance_at < 30:
            return
        self._maintenance_at = now
        if self._inflight or self._assembling:
            return
        if now - self._last_work > 300:
            if self._serial.acquire(blocking=False):
                try:
                    self._close_worker()
                    from .sapi import shutdown
                    shutdown()
                finally:
                    self._serial.release()
            if self._qa_serial.acquire(blocking=False):
                try:
                    self._close_qa_worker()
                finally:
                    self._qa_serial.release()
        for name in ("worker.log", "verification-worker.log"):
            log = self.root / name
            try:
                if log.exists() and log.stat().st_size > 2_000_000 and now - self._last_work > 300:
                    os.replace(log, log.with_suffix(".previous.log"))
            except OSError:
                pass
        cache = (self.root / "cache").resolve()
        try:
            paths = sorted(cache.glob("*"), key=lambda p: p.stat().st_mtime)
            for path in list(paths):
                if ".tmp" in path.name and now - self._last_work > 300 and path.resolve().is_relative_to(cache):
                    path.unlink(missing_ok=True)
                    paths.remove(path)
            total = sum(p.stat().st_size for p in paths if p.is_file())
            for path in paths:
                if total <= 1_000_000_000:
                    break
                if path.is_file() and path.resolve().is_relative_to(cache):
                    total -= path.stat().st_size
                    path.unlink()
        except OSError:
            pass

    def shutdown(self):
        self._stopping.set()
        with self._event_condition:
            self._event_condition.notify_all()
        for job_id in list(self._jobs):
            (self.root / "jobs" / job_id / "cancel.flag").touch()
        super().shutdown()
        self._pool.shutdown(wait=True, cancel_futures=True)
        self._exports.shutdown(wait=True, cancel_futures=True)
        self._prepared.shutdown(wait=True, cancel_futures=True)
        from .sapi import shutdown
        shutdown()
