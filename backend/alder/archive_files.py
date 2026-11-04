"""Restore collected files if an archive's database publication fails."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
from .models import ValidationError


def _lock(root):
    scratch = root / 'imports'; scratch.mkdir(parents=True, exist_ok=True)
    if scratch.resolve() != scratch:
        raise ValidationError('The archive staging directory must be inside the Alder data directory.')
    handle = (scratch / '.archive-handoff.lock').open('a+b')
    if handle.tell() == 0: handle.write(b'\0'); handle.flush()
    handle.seek(0)
    try:
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close(); return None
    return handle


def _restore(root, directory, entries, parents):
    checked = []
    for entry in entries:
        relative = Path(entry['path'])
        path = (root / entry['path']).resolve()
        if relative.is_absolute() or relative.parts[0] not in ('assets', 'speech') or not path.is_relative_to(root) or path == root:
            raise ValueError('Invalid collected recovery path.')
        backup = None
        if entry['backup'] is not None:
            if not str(entry['backup']).isdigit(): raise ValueError('Invalid recovery backup.')
            backup = (directory / entry['backup']).resolve()
            if backup.parent != directory: raise ValueError('Invalid recovery backup path.')
            if backup.is_file():
                if hashlib.sha256(backup.read_bytes()).hexdigest() != entry['digest']:
                    raise ValueError('Recovery backup failed its integrity check.')
            elif not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != entry['digest']:
                raise ValueError('An original collected file could not be restored.')
        checked.append((path, backup))
    checked_parents = []
    for relative in sorted(parents, key=lambda p: len(Path(p).parts), reverse=True):
        parent = (root / relative).resolve()
        if Path(relative).is_absolute() or Path(relative).parts[0] not in ('assets', 'speech') or not parent.is_relative_to(root) or parent == root:
            raise ValueError('Invalid recovery directory.')
        checked_parents.append(parent)
    # Validate the whole journal before restoring any of it.
    for path, backup in reversed(checked):
        if backup is None: path.unlink(missing_ok=True)
        elif backup.exists(): os.replace(backup, path)
    for parent in checked_parents:
        try: parent.rmdir()
        except OSError: pass


class ArchiveWrites:
    def __init__(self, root, atomic_write):
        self.root, self.atomic_write = Path(root).resolve(), atomic_write
        scratch = self.root / 'imports'
        scratch.mkdir(parents=True, exist_ok=True)
        self.lock = _lock(self.root)
        if self.lock is None: raise ValidationError('Another collected document is being opened. Try again when it finishes.')
        self.directory = None
        try:
            self.directory = Path(tempfile.mkdtemp(prefix='archive-handoff-', dir=scratch)).resolve()
            self.key = 'archive_handoff:' + self.directory.name
            self.files, self.parents = {}, set()
            self.entries = []
            self._save()
        except Exception:
            self.lock.close()
            if self.directory is not None: shutil.rmtree(self.directory, ignore_errors=True)
            raise

    def _save(self):
        self.atomic_write(self.directory / 'journal.json', b'{"version":2}\n')

    def __enter__(self):
        return self

    def remember(self, path):
        path = Path(path).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError('Collected file is outside the Alder data directory.')
        if path in self.files: return
        backup = None
        if path.exists():
            backup = self.directory / str(len(self.files))
            shutil.copy2(path, backup)
            with backup.open('r+b') as handle: os.fsync(handle.fileno())
        parent = path.parent
        added_parents = []
        while not parent.exists() and parent != self.root:
            if parent not in self.parents: added_parents.append(str(parent.relative_to(self.root)))
            self.parents.add(parent); parent = parent.parent
        self.files[path] = backup
        self.entries.append({'path': str(path.relative_to(self.root)), 'backup': backup.name if backup else None,
                             'digest': hashlib.sha256(backup.read_bytes()).hexdigest() if backup else None})
        # Append once per file, so documents with many images do not repeatedly
        # rewrite their entire recovery journal. A partial final record cannot
        # describe a file we have touched: flush completes before returning.
        record = json.dumps({'file': self.entries[-1], 'parents': added_parents}).encode('utf-8') + b'\n'
        with (self.directory / 'journal.json').open('ab') as handle:
            handle.write(record); handle.flush(); os.fsync(handle.fileno())

    def write(self, path, content):
        path = Path(path)
        if path.is_file() and path.read_bytes() == content: return
        self.remember(path)
        self.atomic_write(path, content)

    def __exit__(self, kind, error, traceback):
        try:
            if kind is not None:
                _restore(self.root, self.directory, self.entries, [str(p.relative_to(self.root)) for p in self.parents])
            shutil.rmtree(self.directory, ignore_errors=True)
        finally: self.lock.close()

    @staticmethod
    def recover(store):
        root = store.data_dir.resolve()
        handle = _lock(root)
        if handle is None: return  # Never recover a live process's handoff.
        try:
            with store.connection() as conn:
                committed = {row[0] for row in conn.execute("SELECT key FROM metadata WHERE key LIKE 'archive_handoff:%'")}
            for candidate in (root / 'imports').glob('archive-handoff-*'):
                directory = candidate.resolve()
                if directory.parent != root / 'imports' or directory != candidate or not directory.is_dir():
                    raise ValidationError('An archive recovery directory is invalid. Its contents have been preserved.')
                key = 'archive_handoff:' + directory.name
                if key not in committed:
                    try:
                        journal_path = directory / 'journal.json'
                        if not journal_path.exists() and all(p.name.startswith('.alder-') and p.suffix == '.tmp' for p in directory.iterdir()):
                            shutil.rmtree(directory, ignore_errors=True)
                            continue  # Initial journal never published; no user file was touched.
                        raw = journal_path.read_bytes()
                        try: journal = json.loads(raw)
                        except ValueError: journal = None
                        if isinstance(journal, dict) and journal.get('version') == 1:
                            entries, parents = journal['files'], journal['parents']
                        else:
                            lines = raw.splitlines(keepends=True)
                            if not lines or json.loads(lines[0]).get('version') != 2: raise ValueError('Unknown recovery version.')
                            records = [json.loads(line) for line in lines[1:] if line.endswith(b'\n')]
                            entries = [record['file'] for record in records]
                            parents = {parent for record in records for parent in record['parents']}
                        _restore(root, directory, entries, parents)
                    except Exception as error:
                        raise ValidationError(f'An interrupted archive could not be restored. Recovery files are preserved at {directory}.') from error
                shutil.rmtree(directory, ignore_errors=True)
            with store.connection() as conn:
                for key in committed:
                    if not (root / 'imports' / key.split(':', 1)[1]).exists():
                        conn.execute('DELETE FROM metadata WHERE key=?', (key,))
                conn.commit()
        finally: handle.close()
