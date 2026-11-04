from contextlib import contextmanager
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from zipfile import ZipFile, ZIP_DEFLATED
import pytest

from alder.document_opening import DocumentOpening
from alder.models import ValidationError, text_document
from alder.store import Store


@pytest.fixture
def collected(tmp_path):
    source = Store(tmp_path / 'source')
    project = source.create('Collected', 'blank')
    project['book'] = {'version': 1, 'chapters': [{'id': 'chapter_one', 'title': 'Chapter', 'include': True,
        'document': text_document('Collected writing.'), 'voiceId': 'reference_voice'}]}
    asset = source.store_asset(project['id'], 'collected.txt', b'collected bytes')
    project['assets'].append(asset)
    reference = b'controlled voice reference'
    voice = {'id': 'reference_voice', 'name': 'Collected voice', 'hash': hashlib.sha256(reference).hexdigest()}
    voice_dir = source.data_dir / 'speech' / 'voices' / voice['id']
    voice_dir.mkdir(parents=True)
    (voice_dir / 'voice.json').write_text(json.dumps(voice), encoding='utf-8')
    (voice_dir / 'reference.wav').write_bytes(reference)
    project['tracks'][0]['voiceId'] = 'sapi-archived'
    project = source.update(project['id'], project, project['revision'])
    archive = source.save_archive(project['id'], str(tmp_path / 'collected.alder'))
    return source, project, archive, reference


@pytest.fixture
def opening(tmp_path):
    service = DocumentOpening(Store(tmp_path / 'destination'))
    yield service
    service.shutdown(); service.pool.shutdown(wait=True, cancel_futures=True)


def stage(opening, archive):
    job = opening.start('Collected.alder', archive.read_bytes())
    opening.jobs[job['id']]['future'].result(timeout=10)
    assert opening.get(job['id'])['status'] == 'ready'
    return job['id']


def test_cancelled_archive_never_collects_voices_assets_or_a_workspace(opening, collected):
    _, project, archive, _ = collected
    identity = stage(opening, archive)
    assert not opening.store.list_projects()
    assert not (opening.store.data_dir / 'speech').exists()
    assert not (opening.store.data_dir / 'assets').exists()
    opening.cancel(identity)
    with pytest.raises(ValidationError, match='not ready'): opening.commit(identity)
    assert not list(opening.root.iterdir())
    assert not opening.store.list_projects()
    assert not (opening.store.data_dir / 'speech').exists()


def test_staged_archive_commits_collected_components_once(opening, collected):
    _, project, archive, reference = collected
    identity = stage(opening, archive)
    assert set(opening.jobs[identity]['archive']['payloads']) == {'assets/' + project['assets'][0]['path']}
    saved = opening.commit(identity)
    assert saved['book'] == project['book']
    assert opening.commit(identity) == saved
    assert len(opening.store.versions(saved['id'])) == 1
    assert opening.store.asset_path(saved['id'], project['assets'][0]['id'])[0].read_bytes() == b'collected bytes'
    assert (opening.store.data_dir / 'speech/voices/reference_voice/reference.wav').read_bytes() == reference
    catalog = json.loads((opening.store.data_dir / 'speech/voices/system-catalog.json').read_text())
    assert catalog['sapi-archived']['provider'] == 'sapi'
    assert not list(opening.root.iterdir())


def test_archive_keeps_an_existing_voice_name_and_separates_conflicting_audio(opening, collected):
    _, project, archive, reference = collected
    directory = opening.store.data_dir / 'speech/voices/reference_voice'; directory.mkdir(parents=True)
    metadata = json.dumps({'id': 'reference_voice', 'name': 'My voice name', 'hash': hashlib.sha256(reference).hexdigest()}).encode()
    (directory / 'voice.json').write_bytes(metadata)
    (directory / 'reference.wav').write_bytes(reference)
    saved = opening.commit(stage(opening, archive))
    assert saved['book']['chapters'][0]['voiceId'] == 'reference_voice'
    assert (directory / 'voice.json').read_bytes() == metadata
    (directory / 'reference.wav').write_bytes(b'different local voice')
    saved = opening.commit(stage(opening, archive))
    new_id = saved['book']['chapters'][0]['voiceId']
    assert new_id != 'reference_voice'
    assert (directory.parent / new_id / 'reference.wav').read_bytes() == reference
    assert (directory / 'voice.json').read_bytes() == metadata
    assert (directory / 'reference.wav').read_bytes() == b'different local voice'


def test_collision_is_resolved_after_edits_made_during_preparation(opening, collected):
    _, project, archive, _ = collected
    existing = opening.store.insert(project)
    identity = stage(opening, archive)
    changed = deepcopy(existing); changed['book']['chapters'][0]['document'] = text_document('Newer writing.')
    changed = opening.store.update(existing['id'], changed, existing['revision'])
    saved = opening.commit(identity)
    assert saved['id'] != changed['id'] and saved['restoredFrom'] == changed['id']
    assert saved['book'] == project['book']
    assert opening.store.get(changed['id']) == changed


def test_missing_collected_asset_fails_before_any_voice_or_catalog_write(opening, collected, tmp_path):
    _, project, archive, _ = collected
    with ZipFile(archive) as source: entries = {name: source.read(name) for name in source.namelist()}
    missing = 'assets/' + project['assets'][0]['path']
    manifest = json.loads(entries['manifest.json']); del manifest['files'][missing]; del entries[missing]
    entries['manifest.json'] = json.dumps(manifest).encode()
    broken = tmp_path / 'missing.alder'
    with ZipFile(broken, 'w', ZIP_DEFLATED) as target:
        for name, content in entries.items(): target.writestr(name, content)
    with pytest.raises(ValidationError, match='missing asset'): opening.store.open_archive(str(broken))
    assert not opening.store.list_projects()
    assert not (opening.store.data_dir / 'speech').exists()


def test_archive_disk_failure_restores_existing_voice_metadata_and_catalog(opening, collected, monkeypatch):
    _, project, archive, reference = collected
    voice_dir = opening.store.data_dir / 'speech/voices/reference_voice'; voice_dir.mkdir(parents=True)
    old_voice = b'{"id":"reference_voice","name":"My renamed voice"}'
    (voice_dir / 'voice.json').write_bytes(old_voice); (voice_dir / 'reference.wav').write_bytes(reference)
    catalog = voice_dir.parent / 'system-catalog.json'; catalog.write_bytes(b'{}')
    original_write = opening.store._atomic_bytes
    def fail_asset(path, content):
        if 'assets' in path.parts: raise OSError('Disk full')
        original_write(path, content)
    monkeypatch.setattr(opening.store, '_atomic_bytes', fail_asset)
    identity = stage(opening, archive)
    with pytest.raises(OSError, match='Disk full'): opening.commit(identity)
    assert (voice_dir / 'voice.json').read_bytes() == old_voice
    assert (voice_dir / 'reference.wav').read_bytes() == reference
    assert catalog.read_bytes() == b'{}'
    assert not opening.store.list_projects()
    assert not list((opening.store.data_dir / 'imports').glob('archive-handoff-*'))


def test_archive_database_failure_rolls_back_snapshot_history_and_new_files(opening, collected, monkeypatch):
    _, project, archive, _ = collected
    original_connection = opening.store.connection
    class Connection:
        def __init__(self, connection): self.connection = connection
        def execute(self, sql, *args):
            if sql.startswith('INSERT OR REPLACE INTO archives'): raise sqlite3.OperationalError('Database full')
            return self.connection.execute(sql, *args)
        def commit(self): self.connection.commit()
    @contextmanager
    def failing_connection():
        with original_connection() as connection: yield Connection(connection)
    identity = stage(opening, archive)
    monkeypatch.setattr(opening.store, 'connection', failing_connection)
    with pytest.raises(sqlite3.OperationalError, match='Database full'): opening.commit(identity)
    assert not opening.store.list_projects()
    with original_connection() as connection: assert connection.execute('SELECT COUNT(*) FROM history').fetchone()[0] == 0
    assert not (opening.store.data_dir / 'speech').exists()
    assert not (opening.store.data_dir / 'assets').exists()
    assert not list(opening.root.iterdir())


@pytest.mark.parametrize('point', ['before', 'after'])
def test_process_exit_during_archive_handoff_recovers_at_next_open(tmp_path, collected, point):
    _, project, archive, reference = collected
    destination = tmp_path / ('crash-' + point)
    store = Store(destination)
    voice_dir = destination / 'speech/voices/reference_voice'; voice_dir.mkdir(parents=True)
    old_metadata = b'{"name":"Existing voice metadata"}'
    (voice_dir / 'voice.json').write_bytes(old_metadata)
    (voice_dir / 'reference.wav').write_bytes(reference)
    (voice_dir.parent / 'system-catalog.json').write_bytes(b'{}')
    sentinel = destination / 'keep.txt'; sentinel.write_bytes(b'Unrelated local data')
    script = tmp_path / 'exit-during-archive.py'
    script.write_text('''
import os, sys
from contextlib import contextmanager
sys.path.insert(0, sys.argv[1])
from alder.store import Store
store = Store(sys.argv[2]); prepared = store.prepare_archive(sys.argv[3])
original = store.connection
class Connection:
    marked = False
    def __init__(self, conn): self.conn = conn
    def execute(self, sql, *args):
        if sql.startswith('INSERT INTO metadata'):
            self.marked = True
            if sys.argv[4] == 'before': os._exit(71)
        return self.conn.execute(sql, *args)
    def commit(self):
        self.conn.commit()
        if self.marked: os._exit(72)
@contextmanager
def connection():
    with original() as conn: yield Connection(conn)
store.connection = connection
store.commit_archive(prepared)
raise RuntimeError('The crash point was not reached')
''', encoding='utf-8')
    result = subprocess.run([sys.executable, '-B', str(script), str(Path(__file__).resolve().parents[1]), str(destination), str(archive), point],
        capture_output=True, timeout=30, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    assert result.returncode == (71 if point == 'before' else 72), result.stderr.decode(errors='replace')
    assert list((destination / 'imports').glob('archive-handoff-*'))
    recovered = Store(destination)
    assert sentinel.read_bytes() == b'Unrelated local data'
    if point == 'before':
        assert not recovered.list_projects()
        assert (voice_dir / 'voice.json').read_bytes() == old_metadata
        assert (voice_dir.parent / 'system-catalog.json').read_bytes() == b'{}'
        assert not (destination / 'assets').exists()
    else:
        assert len(recovered.list_projects()) == 1
        saved = recovered.get(project['id'])
        assert saved['book'] == project['book']
        assert recovered.asset_path(saved['id'], saved['assets'][0]['id'])[0].read_bytes() == b'collected bytes'
        assert json.loads((voice_dir / 'voice.json').read_bytes())['hash'] == hashlib.sha256(reference).hexdigest()
    assert not list((destination / 'imports').glob('archive-handoff-*'))
    with recovered.connection() as conn:
        assert not conn.execute("SELECT key FROM metadata WHERE key LIKE 'archive_handoff:%'").fetchall()


def test_startup_does_not_restore_a_live_handoff(tmp_path):
    from alder.archive_files import ArchiveWrites
    store = Store(tmp_path / 'live'); path = store.data_dir / 'assets/one/image.png'
    store._atomic_bytes(path, b'original')
    with pytest.raises(ValueError, match='cancel handoff'):
        with ArchiveWrites(store.data_dir, store._atomic_bytes) as writes:
            writes.write(path, b'new')
            Store(store.data_dir)
            assert path.read_bytes() == b'new'
            raise ValueError('cancel handoff')
    assert path.read_bytes() == b'original'


def test_invalid_recovery_journal_preserves_all_files(tmp_path):
    from alder.archive_files import ArchiveWrites
    store = Store(tmp_path / 'invalid'); path = store.data_dir / 'assets/one/image.png'
    store._atomic_bytes(path, b'original')
    writes = ArchiveWrites(store.data_dir, store._atomic_bytes)
    writes.write(path, b'new'); writes.lock.close()
    journal_path = writes.directory / 'journal.json'
    with journal_path.open('ab') as handle:
        handle.write(json.dumps({'file': {'path': '../../outside.txt', 'backup': None}, 'parents': []}).encode() + b'\n')
    with pytest.raises(ValidationError, match='Recovery files are preserved'): Store(store.data_dir)
    assert path.read_bytes() == b'new'
    assert (writes.directory / '0').read_bytes() == b'original'


def test_interrupted_journal_append_restores_only_previously_prepared_files(tmp_path):
    from alder.archive_files import ArchiveWrites
    store = Store(tmp_path / 'partial'); path = store.data_dir / 'assets/one/image.png'
    store._atomic_bytes(path, b'original')
    writes = ArchiveWrites(store.data_dir, store._atomic_bytes)
    writes.write(path, b'new')
    with (writes.directory / 'journal.json').open('ab') as handle:
        handle.write(b'{"file":{"path":"assets/one/untouched.png"')
    untouched = path.with_name('untouched.png'); untouched.write_bytes(b'keep')
    writes.lock.close()
    Store(store.data_dir)
    assert path.read_bytes() == b'original' and untouched.read_bytes() == b'keep'
    assert not writes.directory.exists()
