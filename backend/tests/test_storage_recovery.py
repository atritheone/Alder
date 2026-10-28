"""Failure injection uses only disposable SQLite databases and child processes."""
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
import sqlite3
import subprocess
import sys
import pytest
from alder.store import Store


def test_disk_full_rolls_back_snapshot_and_history(tmp_path, monkeypatch):
    store = Store(tmp_path)
    project = store.create('Recoverable', 'blank')
    original_versions = store.versions(project['id'])
    connection = store.connection

    @contextmanager
    def limited_connection():
        with connection() as conn:
            # A connection-local database growth limit, never the user's disk.
            page_count = conn.execute('PRAGMA page_count').fetchone()[0]
            conn.execute(f'PRAGMA max_page_count={page_count}')
            yield conn

    changed = deepcopy(project)
    changed['clips'][0]['document'] = {'type': 'doc', 'content': [{'type': 'paragraph', 'content': [{'type': 'text', 'text': 'Unsaved expansion. ' * 100000}]}]}
    changed['clips'][0]['text'] = 'Unsaved expansion. ' * 100000
    monkeypatch.setattr(store, 'connection', limited_connection)
    with pytest.raises(sqlite3.OperationalError, match='full'):
        store.update(project['id'], changed, project['revision'])
    monkeypatch.setattr(store, 'connection', connection)
    reopened = Store(tmp_path)
    assert reopened.get(project['id']) == project
    assert reopened.versions(project['id']) == original_versions
    retry = deepcopy(project); retry['name'] = 'Retry saved'
    assert reopened.update(project['id'], retry, project['revision'])['name'] == 'Retry saved'


def test_process_exit_between_history_and_current_snapshot_recovers_last_commit(tmp_path):
    store = Store(tmp_path)
    project = store.create('Before crash', 'blank')
    original_versions = store.versions(project['id'])
    script = r'''
import os, sys
from contextlib import contextmanager
sys.path.insert(0, sys.argv[1])
from alder.store import Store
store = Store(sys.argv[2])
original = store.connection
class Interrupted:
    def __init__(self, conn): self.conn = conn
    def execute(self, sql, *args):
        if sql.startswith('UPDATE projects SET'):
            os._exit(73)
        return self.conn.execute(sql, *args)
    def __getattr__(self, name): return getattr(self.conn, name)
@contextmanager
def connection():
    with original() as conn: yield Interrupted(conn)
store.connection = connection
project = store.get(sys.argv[3])
project['name'] = 'Must not survive uncommitted crash'
store.update(project['id'], project, project['revision'])
'''
    result = subprocess.run([sys.executable, '-B', '-c', script, str(Path(__file__).resolve().parents[1]), str(tmp_path), project['id']], timeout=15, capture_output=True)
    assert result.returncode == 73, result.stderr.decode(errors='replace')
    reopened = Store(tmp_path)
    assert reopened.get(project['id']) == project
    assert reopened.versions(project['id']) == original_versions
    assert reopened.history_status(project['id']) == {'canUndo': False, 'canRedo': False}
