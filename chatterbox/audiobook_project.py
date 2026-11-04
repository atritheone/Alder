"""Explicit project selection for standalone audiobook production tools."""
import os
from pathlib import Path


def project_root():
    value = os.environ.get("CHATTERBOX_AUDIOBOOK_ROOT", "").strip()
    if not value:
        raise ValueError("Set CHATTERBOX_AUDIOBOOK_ROOT to the audiobook project directory containing plan.json.")
    return Path(value).expanduser().resolve()
