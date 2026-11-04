"""Reuse style lookups while reading one Word package, without global caches."""
from contextlib import contextmanager


@contextmanager
def cached_import_styles(document):
    part = document.part
    original = part.get_style
    missing = object()
    previous = part.__dict__.get('get_style', missing)
    definitions = document.styles.element
    count = len(definitions)
    cache = {}

    def resolve(identity, kind):
        nonlocal count
        current = len(definitions)
        # Restoring list-continuation histories can add a native style. A
        # formerly missing ID must then resolve to that style, not a fallback.
        if current != count:
            cache.clear(); count = current
        key = identity, kind
        if key not in cache:
            if len(cache) >= 512: cache.clear()
            cache[key] = original(identity, kind)
        return cache[key]

    part.get_style = resolve
    try:
        yield
    finally:
        if previous is missing: del part.get_style
        else: part.get_style = previous
        cache.clear()
