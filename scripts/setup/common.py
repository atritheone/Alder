"""Standard-library-only primitives for repository-independent setup state."""
from __future__ import annotations
import contextlib
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import time


class SetupError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.partial')
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    os.replace(temporary, path)


def inside(path, root):
    p, r = Path(path).resolve(), Path(root).resolve()
    if p == r or not p.is_relative_to(r):
        raise SetupError('ALDER_PATH', f'Operation escaped owned directory: {p}')
    return p


def unlink_file(path):
    """Remove one already scoped file, including Windows archive read-only bits."""
    path=Path(path)
    try:path.unlink()
    except PermissionError:
        if sys.platform!='win32':raise
        path.chmod(stat.S_IREAD | stat.S_IWRITE)
        path.unlink()


def remove_empty_directory(path):
    path=Path(path)
    try:path.rmdir()
    except PermissionError:
        if sys.platform!='win32':raise
        path.chmod(stat.S_IREAD | stat.S_IWRITE | stat.S_IEXEC)
        path.rmdir()


def remove_owned(path, root):
    """Only remove descendants of an explicitly marked setup/installation root."""
    root = Path(root).resolve()
    if not (root / '.alder-owned.json').is_file():
        raise SetupError('ALDER_PATH', f'No Alder ownership marker: {root}')
    p = inside(path, root)
    if Path(path).is_symlink():
        Path(path).unlink()
    elif p.is_dir():
        def retry_readonly(function, failed, error):
            # Windows copies the read-only directory bit from OneDrive checkouts.
            # Change only the failing path inside this already validated owned tree.
            inside(failed, root)
            if sys.platform != 'win32' or not isinstance(error[1], PermissionError):
                raise error[1]
            os.chmod(failed, stat.S_IWRITE | stat.S_IREAD)
            function(failed)
        shutil.rmtree(p, onerror=retry_readonly)
    elif p.exists():
        unlink_file(p)


@contextlib.contextmanager
def operation_lock(root, filename='operation.lock'):
    """OS advisory locks release even after a killed process; no stale PID guessing."""
    file = (Path(root) / filename).open('a+b')
    if file.tell() == 0:
        file.write(b'0'); file.flush()
    file.seek(0)
    try:
        if sys.platform == 'win32':
            import msvcrt
            msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as error:
        file.close()
        raise SetupError('ALDER_BUSY', 'Another setup operation owns this state directory.') from error
    try:
        yield
    finally:
        file.close()


@contextlib.contextmanager
def installation_lock(root):
    root=Path(root)
    root.parent.mkdir(parents=True,exist_ok=True)
    with operation_lock(root.parent, '.'+root.name+'.alder-setup.lock'):
        yield


def inventory(root):
    root = Path(root).resolve()
    records = {}
    def inspect(path):
        relative = path.relative_to(root).as_posix()
        if '__pycache__' in path.parts or path.suffix == '.pyc':
            return None
        if path.is_symlink():
            if not path.resolve().is_relative_to(root):
                raise SetupError('ALDER_LINK', f'External resource link: {relative}')
            return relative, {'link': os.readlink(path)}
        elif path.is_file():
            return relative, {'sha256': digest(path), 'bytes': path.stat().st_size}
        return None
    # Bounded concurrent reads avoid serial antivirus/file-open latency on the
    # tens of thousands of runtime files. Every byte is still hashed.
    with ThreadPoolExecutor(max_workers=8) as pool:
        for result in pool.map(inspect, sorted(root.rglob('*'))):
            if result is not None:
                records[result[0]]=result[1]
                if len(records) % 10000 == 0:
                    print(f'[inventory] {len(records)} files checked in {root}',file=sys.stderr,flush=True)
    return records


def verify_inventory(root, records):
    root = Path(root).resolve()
    def check(item):
        name,record=item
        p = root / name
        inside(p, root)
        if 'link' in record:
            if not p.is_symlink() or os.readlink(p) != record['link']:
                return False
        elif not p.is_file() or p.is_symlink() or p.stat().st_size != record['bytes'] or digest(p) != record['sha256']:
            return False
        return True
    with ThreadPoolExecutor(max_workers=8) as pool:
        return all(pool.map(check,records.items()))


def run(args, cwd, env, logs, label, timeout=None, input=None):
    logs = Path(logs)
    logs.mkdir(parents=True, exist_ok=True)
    log = logs / (label + '.log')
    print(f'[{label}]', flush=True, file=sys.stderr)
    with log.open('w', encoding='utf-8') as stream:
        try:
            result = subprocess.run([str(x) for x in args], cwd=cwd, env=env,
                stdout=stream, stderr=subprocess.STDOUT, timeout=timeout,
                input=input, text=True, encoding='utf-8', errors='replace',
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
        except subprocess.TimeoutExpired as error:
            raise SetupError('ALDER_TIMEOUT', f'{label} exceeded its time limit. See {log}') from error
    if result.returncode:
        tail = log.read_text(encoding='utf-8', errors='replace')[-3500:]
        raise SetupError('ALDER_STAGE', f'{label} failed ({result.returncode}). See {log}\n{tail}')
    return log


def check_space(path, required):
    path = Path(path).resolve()
    while not path.exists():
        path = path.parent
    free = shutil.disk_usage(path).free
    if free < required:
        raise SetupError('ALDER_SPACE', f'{path}: {free / 2**30:.1f} GiB free; this stage needs {required / 2**30:.1f} GiB. Use --state-dir on a larger local disk.')
    if hasattr(os, 'statvfs'):
        status = os.statvfs(path)
        if status.f_files and status.f_favail < 100000:
            raise SetupError('ALDER_INODES', f'Insufficient free inodes on {path}; use another state directory.')
    return free
