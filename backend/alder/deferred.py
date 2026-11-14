"""Single-flight optional services; shutting down an unused service does no work."""
from threading import RLock


class DeferredService:
    def __init__(self, factory):
        self._factory = factory
        self._lock = RLock()
        self._value = None
        self._error = None
        self._closed = False

    def get(self):
        with self._lock:
            if self._closed:
                raise RuntimeError("The service is shutting down.")
            if self._error is not None:
                raise RuntimeError(str(self._error)) from self._error
            if self._value is None:
                try:
                    self._value = self._factory()
                except (ImportError, RuntimeError, OSError) as exc:
                    self._error = exc
                    raise
            return self._value

    def has_active_generation(self):
        # Reading this from proofreading must never initialize narration.
        value = self._value
        return value.has_active_generation() if value is not None else False

    def shutdown(self):
        with self._lock:
            if self._closed:
                return
            self._closed = True
            if self._value is not None:
                self._value.shutdown()

    def __getattr__(self, name):
        return getattr(self.get(), name)
