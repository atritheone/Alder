"""Optional local speech providers. Native libraries live in isolated workers.

IDs are persisted identities, not display names. Prefix decoding is confined to
this compatibility boundary so unavailable voices can still be archived.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import queue
import re
import subprocess
import sys
import threading
import time
import wave

from . import sapi

TIMING_VERSION = f"system-1-sapi-{sapi.NATIVE_TIMING_VERSION}"
PROVIDERS = {"sapi": "Windows SAPI", "macos": "macOS voices", "espeak": "eSpeak NG"}
_catalog = {}
_errors = {}
_catalog_lock = threading.RLock()


def provider_id(voice_id):
    for provider in PROVIDERS:
        if isinstance(voice_id, str) and re.fullmatch(provider + r"-[A-Za-z0-9_.-]{1,120}", voice_id):
            return provider
    return "chatterbox-turbo"


def is_system(voice_id):
    return provider_id(voice_id) in PROVIDERS


def identity(provider, native_id):
    return provider + "-" + hashlib.sha256(native_id.encode("utf-8")).hexdigest()[:24]


def references(root, remember=()):
    """Keep descriptive metadata for absent voices; never import executables/paths."""
    from .speech import _atomic_json
    path = Path(root) / "voices" / "system-catalog.json"
    with _catalog_lock:
        try:
            saved = json.loads(path.read_text("utf-8"))
            if not isinstance(saved, dict):
                saved = {}
        except (OSError, ValueError):
            saved = {}
        clean = {}
        for voice in [*saved.values(), *remember]:
            if not isinstance(voice, dict) or not is_system(voice.get("id")):
                continue
            row = {k: voice[k] for k in ("id", "name", "nativeId", "culture")
                   if isinstance(voice.get(k), str) and len(voice[k]) <= 512}
            row["provider"] = provider_id(voice["id"])
            clean[voice["id"]] = row
        if clean != saved:
            _atomic_json(path, clean)
        return clean


class Host:
    def __init__(self, provider):
        self.provider = provider
        self.lock = threading.RLock()
        self.process = None

    def close(self):
        with self.lock:
            process, self.process = self.process, None
            if process:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=2)
                for pipe in (process.stdin, process.stdout):
                    pipe.close()

    def request(self, payload, cancel=None, timeout=60):
        with self.lock:
            if cancel and Path(cancel).exists():
                raise InterruptedError("Reading stopped.")
            if self.process is None or self.process.poll() is not None:
                self.close()
                # sys.executable is Alder's core interpreter in packaged builds.
                self.process = subprocess.Popen(
                    [sys.executable, "-s", str(Path(__file__).with_name("system_voice_worker.py")), self.provider],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                    text=True, encoding="utf-8", env={**os.environ, "PYTHONNOUSERSITE": "1"},
                    **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}))
                self.responses = queue.Queue()
                process, responses = self.process, self.responses
                def read():
                    try:
                        for line in process.stdout:
                            try:
                                responses.put(json.loads(line))
                            except ValueError:
                                continue
                    finally:
                        responses.put({"error": "The system voice worker stopped."})
                threading.Thread(target=read, daemon=True).start()
            try:
                self.process.stdin.write(json.dumps(payload, ensure_ascii=True) + "\n")
                self.process.stdin.flush()
                deadline = time.monotonic() + timeout
                while time.monotonic() < deadline:
                    if cancel and Path(cancel).exists():
                        raise InterruptedError("Reading stopped.")
                    try:
                        response = self.responses.get(timeout=.1)
                    except queue.Empty:
                        continue
                    if response.get("error"):
                        raise RuntimeError(response["error"])
                    return response
                raise RuntimeError("The system voice timed out. Restart Alder and retry.")
            except (OSError, RuntimeError):
                self.close()
                raise


_hosts = {name: Host(name) for name in ("macos", "espeak")}


def voices(refresh=False):
    with _catalog_lock:
        if refresh:
            if hasattr(sapi.voices, "cache_clear"):
                sapi.voices.cache_clear()
            _catalog.clear()
            _errors.clear()
        # Preserve the SAPI function as the Windows compatibility/test boundary.
        result = [dict(v, provider="sapi", nativeId=v.get("nativeId", v["name"]),
                       system=True, available=True, capabilities=controls()) for v in sapi.voices()]
        provider = {"darwin": "macos", "linux": "espeak"}.get(sys.platform)
        if provider:
            if provider not in _catalog:
                try:
                    response = _hosts[provider].request({"operation": "voices"}, timeout=15)
                    version = response.get("version", "unknown")
                    _catalog[provider] = [dict(v, id=identity(provider, v["nativeId"]), kind="system",
                        system=True, provider=provider, engine=provider, available=True,
                        hash=hashlib.sha256(f"{provider}:{v['nativeId']}:{version}:{TIMING_VERSION}".encode()).hexdigest(),
                        capabilities=controls()) for v in response["voices"]]
                    _errors.pop(provider, None)
                except (OSError, ValueError, RuntimeError, KeyError) as exc:
                    _catalog[provider] = []
                    _errors[provider] = str(exc)
            result += _catalog[provider]
        return result


def controls():
    return {"rate": {"min": -10, "max": 10, "default": 0},
            "pitch": {"min": -10, "max": 10, "default": 0},
            "volume": {"min": 0, "max": 100, "default": 100},
            "audioExport": True, "nativeTimings": True}


def status(refresh=False):
    rows = voices(refresh)
    native = {"win32": "sapi", "darwin": "macos", "linux": "espeak"}.get(sys.platform)
    return [{"id": key, "name": name, "available": any(v["provider"] == key for v in rows),
             "reason": _errors.get(key, "" if key == native else "Available on its native operating system only.")}
            for key, name in PROVIDERS.items()]


def resolve(voice_id):
    voice = next((v for v in voices() if v["id"] == voice_id), None)
    if voice is None:
        raise ValueError("This system voice is not available on this computer. Restart Alder or choose a replacement.")
    return voice


def prepare(voice_id):
    voice = resolve(voice_id)
    if voice["provider"] == "sapi":
        sapi.prepare(voice["nativeId"])
    else:
        _hosts[voice["provider"]].request({"operation": "prepare", "voice": voice["nativeId"]})
    return {"ready": True, "engine": voice["provider"]}


def render(voice_id, text, path, rate=0, volume=100, pitch=0, *, ffmpeg=None, cancel=None, expected_hash=None):
    voice = resolve(voice_id)
    if expected_hash is not None and expected_hash != voice.get("hash", "default"):
        raise ValueError("The system voice changed since this narration was saved. Start a new reading to avoid mixing voice versions.")
    if voice["provider"] == "sapi":
        return sapi.render(voice_id, text, path, rate, volume, pitch)
    output = Path(path)
    raw = output.with_suffix(".native.wav")
    temporary = output.with_suffix(".system.tmp.wav")
    try:
        response = _hosts[voice["provider"]].request({"operation": "render", "voice": voice["nativeId"],
            "text": text, "path": str(raw), "rate": rate, "volume": volume, "pitch": pitch}, cancel=cancel)
        if not ffmpeg:
            raise RuntimeError("Alder's audio converter is missing. Repair its bundled resources.")
        process = subprocess.Popen([str(ffmpeg), "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(raw), "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", str(temporary)],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}))
        try:
            deadline = time.monotonic() + 30
            while True:
                if cancel and Path(cancel).exists():
                    raise InterruptedError("Reading stopped.")
                if time.monotonic() > deadline:
                    raise RuntimeError("System voice audio conversion timed out.")
                try:
                    _, error = process.communicate(timeout=.1)
                    break
                except subprocess.TimeoutExpired:
                    continue
            if process.returncode:
                raise RuntimeError("System voice audio conversion failed: " + error.decode(errors="replace")[-500:])
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()
        with wave.open(str(temporary), "rb") as audio:
            if audio.getnframes() == 0:
                raise RuntimeError("The selected voice returned empty audio.")
        os.replace(temporary, output)
        return response
    finally:
        raw.unlink(missing_ok=True)
        temporary.unlink(missing_ok=True)


def native_timings(events, duration):
    # Workers normalize text positions to UTF-16 before this shared adapter.
    if not isinstance(events, list):
        return []
    valid = [e for e in events if isinstance(e, dict) and isinstance(e.get("text"), str)
             and isinstance(e.get("start"), int) and isinstance(e.get("seconds"), (float, int))
             and math.isfinite(e["seconds"]) and 0 <= e["seconds"] <= duration]
    result = sapi.native_timings(valid, duration)
    if any(w["endSeconds"] < w["startSeconds"] or
           i and w["startSeconds"] < result[i-1]["startSeconds"] for i, w in enumerate(result)):
        return []
    return result


def shutdown():
    sapi.shutdown()
    for host in _hosts.values():
        host.close()
