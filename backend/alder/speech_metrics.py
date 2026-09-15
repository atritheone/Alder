"""Bounded local timings: identifiers and measurements, never manuscript content."""
import json
from pathlib import Path
import threading
import time


class SpeechMetrics:
    def __init__(self, root):
        self.path = Path(root) / "metrics.jsonl"
        self.lock = threading.Lock()

    def emit(self, event, **fields):
        record = {"event": event, "monotonic": time.monotonic(), **fields}
        with self.lock:
            try:
                if self.path.exists() and self.path.stat().st_size > 2_000_000:
                    self.path.replace(self.path.with_suffix(".previous.jsonl"))
                with self.path.open("a", encoding="utf-8") as stream:
                    stream.write(json.dumps(record) + "\n")
            except OSError:
                pass  # Diagnostics must not prevent playback or recovery.
