"""Bounded local timings. Records operation names and durations, never content."""
from contextlib import contextmanager
import time
from threading import Lock
from collections import deque
from contextvars import ContextVar
import re

_origin = time.perf_counter()
_events = []
_recent = deque(maxlen=384)
_dropped = 0
_lock = Lock()
_operation = ContextVar('alder_operation', default=None)


def mark(event, duration=None):
    global _dropped
    if not isinstance(event, str) or not re.fullmatch(r'[a-z][a-z0-9.-]{0,63}', event): return
    with _lock:
        row = {"event": event, "ms": (time.perf_counter() - _origin) * 1000}
        if duration is not None: row["duration"] = duration
        if identity := _operation.get(): row['operation'] = identity
        if len(_events) < 128: _events.append(row)
        else:
            if len(_recent) == _recent.maxlen: _dropped += 1
            _recent.append(row)


@contextmanager
def operation(identity):
    safe = identity if isinstance(identity, str) and re.fullmatch(r'[a-f0-9-]{36}', identity) else None
    token = _operation.set(safe)
    try: yield
    finally: _operation.reset(token)


@contextmanager
def span(event):
    start = time.perf_counter()
    try:
        yield
    finally:
        mark(event, (time.perf_counter() - start) * 1000)


def report():
    with _lock:
        return {"version": 1, "dropped": _dropped, "events": [dict(row) for row in [*_events, *_recent]]}
