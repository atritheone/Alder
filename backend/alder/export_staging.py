"""Recognise abandoned export preparation without touching a live writer."""
import os
from pathlib import Path
import re
import shutil

HEADER = b'Alder export preparation v1\n'


def _folder(root):
    folder = root / '.preparing'
    folder.mkdir(exist_ok=True)
    if folder.resolve() != folder: raise ValueError('Invalid export preparation directory.')
    return folder


def _lock(handle):
    handle.seek(0)
    try:
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError: return False


def begin(root, identity):
    marker = _folder(root) / (identity + '.lock')
    handle = marker.open('x+b')
    try:
        handle.write(b'\0'); handle.flush()
        if not _lock(handle): raise ValueError('This export is already being prepared.')
        handle.seek(0); handle.write(HEADER); handle.truncate(); handle.flush(); os.fsync(handle.fileno())
        return handle
    except Exception:
        handle.close()
        raise


def finish(handle, remove=True):
    marker = Path(handle.name)
    handle.close()
    if not remove: return
    try: marker.unlink(missing_ok=True)
    except OSError: pass  # The next startup can remove this completed marker.


def recover(root):
    for marker in _folder(root).glob('export_*.lock'):
        if not re.fullmatch(r'export_[a-f0-9]{32}\.lock', marker.name) or marker.resolve() != marker: continue
        try: handle = marker.open('r+b')
        except (FileNotFoundError, PermissionError): continue
        handled = False
        try:
            if not _lock(handle): continue
            handle.seek(0)
            # An incomplete/unknown marker has no authority to remove files.
            if handle.read(len(HEADER) + 1) != HEADER: continue
            directory = root / marker.stem
            if directory.resolve() != directory or directory.parent != root: continue
            if directory.is_dir() and not (directory / 'result.json').is_file():
                try: shutil.rmtree(directory)
                except OSError: continue  # Retain the marker to retry later.
            handled = True
        finally:
            if handled: finish(handle)
            else: handle.close()
