"""Bounded local timings. Records operation names and durations, never content."""
from contextlib import contextmanager
import time
from threading import Lock

_origin = time.perf_counter()
_events = []
_lock = Lock()


def mark(event, duration=None):
    with _lock:
        if len(_events) < 512:
            row = {"event": event, "ms": (time.perf_counter() - _origin) * 1000}
            if duration is not None:
                row["duration"] = duration
            _events.append(row)


@contextmanager
def span(event):
    start = time.perf_counter()
    try:
        yield
    finally:
        mark(event, (time.perf_counter() - start) * 1000)


def report():
    with _lock:
        return {"version": 1, "events": [dict(row) for row in _events]}
