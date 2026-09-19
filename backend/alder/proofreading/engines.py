"""Supervised local engines. No inference path contains a download operation."""
from __future__ import annotations

from collections import OrderedDict
import copy
import hashlib
import http.client
import json
import os
from pathlib import Path
import queue
import socket
import subprocess
import sys
import threading
import time
import urllib.parse

from ..platform_runtime import resource_executable
from .contracts import diagnostic, fingerprint, slice16
from .memory import require_model_memory


def stop(process):
    if process is not None and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)
    if process:
        for pipe in (process.stdin, process.stdout, process.stderr):
            if pipe:
                try:
                    pipe.close()
                except OSError:
                    pass


def launch(args, **kwargs):
    return subprocess.Popen(args, creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
                            **kwargs)


class Resources:
    def __init__(self, root):
        self.root = Path(root)
        self.directory = Path(os.environ.get("ALDER_PROOFREADING_RESOURCES", self.root / "proofreading"))
        self.manifest = {}
        try:
            self.manifest = json.loads((self.directory / "manifest.json").read_text("utf-8"))
        except (OSError, ValueError):
            pass
        if not isinstance(self.manifest, dict):
            self.manifest = {}
        self.java = resource_executable(self.root, "java")
        self.rules = self.directory / "languagetool/languagetool-server.jar"
        self.python = Path(os.environ.get("ALDER_PROOFREADING_PYTHON", str(
            self.directory / ("python/python.exe" if sys.platform == "win32" else "python/bin/python3"))))
        model = self.manifest.get("model", {})
        if not isinstance(model, dict):
            model = {}
        relative = model.get("file")
        if not isinstance(relative, str) or not relative or "\x00" in relative:
            relative = "models/model.gguf"
        self.model = (self.directory / relative).resolve()
        if not self.model.is_relative_to(self.directory.resolve()):
            self.model = self.directory / "invalid-model-path"
        self.model_hash = model.get("sha256") if isinstance(model.get("sha256"), str) else ""
        self.revision = model.get("revision") if isinstance(model.get("revision"), str) else "unknown"

    def capabilities(self):
        rules = self.rules.is_file() and self.java.is_file()
        model = self.model.is_file() and self.python.is_file() and len(self.model_hash) == 64
        return {"rules": {"available": rules, "engine": "LanguageTool", "revision": self.manifest.get("rulesVersion"),
                          "reason": "" if rules else "The local grammar resource pack is not installed."},
                "model": {"available": model, "revision": self.revision, "device": "cpu",
                          "experimental": True,
                          "reason": "" if model else "The local advanced grammar model/runtime is not installed."}}


class RuleEngine:
    def __init__(self, resources):
        self.resources = resources
        self.process = None
        self.port = None
        self.lock = threading.Lock()
        self.cache = OrderedDict()

    def _request(self, method, path, body=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        try:
            connection.request(method, path, body, {"Content-Type": "application/x-www-form-urlencoded"})
            response = connection.getresponse()
            content = response.read(2_000_001)
            if response.status != 200 or len(content) > 2_000_000:
                raise RuntimeError("The local grammar engine could not complete this check.")
            return json.loads(content)
        finally:
            connection.close()

    def _start(self):
        if self.process and self.process.poll() is None:
            return
        if not self.resources.capabilities()["rules"]["available"]:
            raise RuntimeError("The local grammar resource pack is not installed.")
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            self.port = listener.getsockname()[1]
        self.process = launch([str(self.resources.java), "-Xmx768m", "-cp", str(self.resources.rules),
                               "org.languagetool.server.HTTPServer", "--port", str(self.port)],
                              cwd=self.resources.rules.parent, stdin=subprocess.DEVNULL,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline and self.process and self.process.poll() is None:
            try:
                self._request("GET", "/v2/languages")
                return
            except (OSError, ValueError, RuntimeError, http.client.HTTPException):
                time.sleep(.1)
        self.close()
        raise RuntimeError("The local grammar engine did not start. Repair the proofreading pack.")

    def check(self, text, config):
        key = fingerprint([text, config["dialect"], config["style"]])
        with self.lock:
            if key in self.cache:
                self.cache.move_to_end(key)
                matches = copy.deepcopy(self.cache[key])
            else:
                self._start()
                try:
                    data = self._request("POST", "/v2/check", urllib.parse.urlencode({
                        "text": text, "language": config["dialect"], "level": "picky" if config["style"] else "default"}))
                except (OSError, ValueError, RuntimeError, http.client.HTTPException) as exc:
                    self.close()
                    raise RuntimeError("The local grammar engine failed. Try the check again or repair its resource pack.") from exc
                matches = data.get("matches", [])
                self.cache[key] = copy.deepcopy(matches)
                while len(self.cache) > 128:
                    self.cache.popitem(last=False)
        accepted = {word.casefold() for word in config["acceptedWords"]}
        result = []
        for match in matches:
            rule = match.get("rule", {})
            identifier = "lt:" + rule.get("id", "unknown")
            if identifier in config["ignoredRuleIds"]:
                continue
            start, end = match.get("offset", -1), match.get("offset", -1) + match.get("length", 0)
            try:
                original = slice16(text, start, end)
            except (ValueError, UnicodeError):
                continue
            kind = rule.get("issueType", "grammar")
            category = "spelling" if kind == "misspelling" else "style" if kind in ("style", "register", "redundancy") else "punctuation" if kind == "typographical" else "grammar"
            if category == "spelling" and original.casefold() in accepted:
                continue
            if category == "style" and not config["style"]:
                continue
            result.append(diagnostic(text, start, end, category, identifier,
                                     match.get("message", "Possible language issue."),
                                     [r["value"] for r in match.get("replacements", [])[:5]], "rules"))
        return result

    def close(self):
        process, self.process = self.process, None
        stop(process)


class ModelEngine:
    def __init__(self, resources):
        self.resources = resources
        self.process = None
        self.responses = None
        self.verified = False
        self.lock = threading.Lock()
        self.last_used = 0.0
        self.cache = OrderedDict()

    def _start(self):
        if self.process and self.process.poll() is None:
            return
        if not self.resources.capabilities()["model"]["available"]:
            raise RuntimeError("The local advanced grammar model/runtime is not installed.")
        require_model_memory()
        if not self.verified:
            digest = hashlib.sha256()
            with self.resources.model.open("rb") as source:
                for chunk in iter(lambda: source.read(4 * 1024 * 1024), b""):
                    digest.update(chunk)
            if digest.hexdigest() != self.resources.model_hash:
                raise RuntimeError("The grammar model failed its checksum. Repair the proofreading pack.")
            self.verified = True
        environment = {**os.environ, "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
                       "PYTHONNOUSERSITE": "1", "PYTHONIOENCODING": "utf-8", "TOKENIZERS_PARALLELISM": "false"}
        environment.pop("PYTHONPATH", None)
        environment.pop("PYTHONHOME", None)
        self.process = launch([str(self.resources.python), "-I", "-u", str(Path(__file__).with_name("worker.py")),
                               "--model", str(self.resources.model)], env=environment,
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              text=True, encoding="utf-8")
        responses = self.responses = queue.Queue(maxsize=4)
        process = self.process

        def reader():
            try:
                while line := process.stdout.readline(65537):
                    if len(line) > 65536:
                        break
                    try:
                        responses.put_nowait(json.loads(line))
                    except (ValueError, queue.Full):
                        break
            except (OSError, ValueError):
                pass
            try:
                responses.put_nowait({"error": "The local grammar worker exited."})
            except queue.Full:
                pass
        threading.Thread(target=reader, daemon=True, name="proofreading-replies").start()

    def check(self, text, config, cancelled):
        key = fingerprint([text, config["dialect"], config["acceptedWords"], self.resources.revision])
        with self.lock:
            if cancelled():
                raise InterruptedError()
            if key in self.cache:
                self.cache.move_to_end(key)
                return self.cache[key]
            self._start()
            identifier = fingerprint([text, time.monotonic_ns()])[:24]
            payload = {"id": identifier, "text": text, "dialect": config["dialect"],
                       "acceptedWords": config["acceptedWords"][:100]}
            try:
                self.process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
                self.process.stdin.flush()
                deadline = time.monotonic() + 120
                while time.monotonic() < deadline:
                    if cancelled():
                        raise InterruptedError()
                    try:
                        result = self.responses.get(timeout=.1)
                    except queue.Empty:
                        continue
                    if result.get("error"):
                        raise RuntimeError("The local grammar worker could not complete this passage.")
                    if result.get("id") != identifier:
                        raise RuntimeError("The grammar worker returned an invalid response.")
                    self.last_used = time.monotonic()
                    self.cache[key] = result["corrected"]
                    while len(self.cache) > 128:
                        self.cache.popitem(last=False)
                    return result["corrected"]
                raise RuntimeError("Advanced grammar timed out. Fast checks remain available.")
            except BaseException:
                self.close()
                raise

    def close(self):
        process, self.process = self.process, None
        stop(process)
