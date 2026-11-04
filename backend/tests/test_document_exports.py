from copy import deepcopy
from pathlib import Path
import threading
import os
import subprocess
import sys
import pytest
from alder.document_exports import DocumentExports
from alder.models import ValidationError, text_document
from alder.store import Store, ConflictError


@pytest.fixture
def service(tmp_path):
    value = DocumentExports(Store(tmp_path / 'data'))
    yield value
    value.shutdown(); value.pool.shutdown(wait=True, cancel_futures=True)


def project(service):
    p = service.store.create('Export words', 'blank')
    p['book'] = {'version': 1, 'chapters': [{'id': 'main', 'title': 'Text', 'include': True, 'document': text_document('Authored words.')} ]}
    p['settings'].update(documentKind='docx', includeTitle=False)
    return service.store.update(p['id'], p, p['revision'])


def ready(service, job):
    service.jobs[job['id']]['future'].result(timeout=15)
    return service.get(job['id'])


@pytest.mark.parametrize('format', ['txt', 'docx', 'html'])
def test_export_publishes_one_saved_snapshot_only_after_completion(service, format):
    p = project(service); before = deepcopy(p)
    job = service.start(p['id'], format, expected_revision=p['revision'])
    assert ready(service, job)['status'] == 'ready'
    directory = service.jobs[job['id']]['directory']
    assert not (directory / 'result.json').exists()
    assert service.store.get(p['id']) == before
    result = service.complete(job['id'])
    assert result['sourceRevision'] == p['revision'] and Path(result['path']).is_file()
    assert (directory / 'result.json').is_file()
    assert service.complete(job['id']) == result
    assert service.cancel(job['id'])['status'] == 'completed'
    service.shutdown()
    assert Path(result['path']).is_file()


def test_cancel_running_export_waits_for_writer_then_removes_every_partial_file(service):
    entered, release = threading.Event(), threading.Event()
    def build(p, format, directory, options):
        (directory / 'partial.bin').write_bytes(b'partial')
        entered.set(); assert release.wait(5)
        path = directory / 'later.txt'; path.write_text('Later')
        return {'path': str(path), 'filename': path.name, 'mime': 'text/plain'}
    service.builder = build; p = project(service); job = service.start(p['id'], 'txt')
    try:
        assert entered.wait(5)
        assert service.cancel(job['id'])['status'] == 'cancelled'
        assert not (service.jobs[job['id']]['directory'] / 'result.json').exists()
        with pytest.raises(ValidationError, match='not ready'): service.complete(job['id'])
    finally: release.set()
    assert ready(service, job)['status'] == 'cancelled'
    assert not service.jobs[job['id']]['directory'].exists()
    assert service.store.get(p['id']) == p


def test_cancel_ready_output_and_shutdown_queued_exports(service):
    p = project(service); job = service.start(p['id'], 'txt'); ready(service, job)
    assert service.cancel(job['id'])['status'] == 'cancelled'
    assert not service.jobs[job['id']]['directory'].exists()
    entered, release = threading.Event(), threading.Event()
    def build(*args):
        entered.set(); assert release.wait(5)
        raise RuntimeError('Cancelled builder stopped.')
    service.builder = build
    running = service.start(p['id'], 'txt')
    try:
        assert entered.wait(5)
        queued = [service.start(p['id'], 'txt') for _ in range(3)]
        with pytest.raises(ValidationError, match='current exports'): service.start(p['id'], 'txt')
        service.shutdown()
        assert all(service.jobs[j['id']]['future'].cancelled() for j in queued)
    finally: release.set()
    assert ready(service, running)['status'] == 'cancelled'


@pytest.mark.parametrize('damage', ['failure', 'outside', 'manifest'])
def test_export_failure_removes_generated_output_without_touching_user_files(service, tmp_path, damage, monkeypatch):
    outside = tmp_path / 'existing.txt'; outside.write_text('Keep this')
    def build(p, format, directory, options):
        path = directory / 'partial.txt'; path.write_text('Generated')
        if damage == 'failure': raise RuntimeError('Exporter failed')
        return {'path': str(outside if damage == 'outside' else path), 'filename': path.name, 'mime': 'text/plain'}
    service.builder = build; job = service.start(project(service)['id'], 'txt')
    result = ready(service, job)
    if damage == 'manifest':
        def fail(*args): raise OSError('Disk full')
        monkeypatch.setattr(service.store, '_atomic_bytes', fail)
        with pytest.raises(OSError, match='Disk full'): service.complete(job['id'])
    else: assert result['status'] == 'failed'
    assert outside.read_text() == 'Keep this'
    assert not service.jobs[job['id']]['directory'].exists()


def test_stale_revision_fails_and_expired_unclaimed_output_is_removed(service):
    p = project(service)
    with pytest.raises(ConflictError): service.start(p['id'], 'txt', expected_revision=p['revision']-1)
    job = service.start(p['id'], 'txt'); ready(service, job)
    directory = service.jobs[job['id']]['directory']; service.jobs[job['id']]['touched'] -= 901
    next_job = service.start(p['id'], 'txt'); ready(service, next_job)
    assert job['id'] not in service.jobs and not directory.exists()


def test_export_api_auth_and_unpublished_download(service, tmp_path):
    from fastapi.testclient import TestClient
    from alder.app import create_app
    app = create_app(tmp_path / 'api', session_token='secret')
    with TestClient(app) as client:
        p = project(app.state.exports)
        assert client.post(f"/api/projects/{p['id']}/export-jobs", json={'format': 'txt'}).status_code == 401
        client.headers['Authorization'] = 'Bearer secret'
        job = client.post(f"/api/projects/{p['id']}/export-jobs", json={'format': 'txt', 'expectedRevision': p['revision']}).json()
        assert ready(app.state.exports, job)['status'] == 'ready'
        assert client.get(f"/api/document-export-jobs/{job['id']}").json()['status'] == 'ready'
        assert client.get(f"/api/exports/{job['id']}").status_code == 404
        result = client.post(f"/api/document-export-jobs/{job['id']}/complete").json()
        assert client.get(result['downloadUrl']).text.strip() == 'Authored words.'
        assert client.delete(f"/api/document-export-jobs/{job['id']}").json()['status'] == 'completed'


@pytest.mark.parametrize('complete', [False, True])
def test_restart_after_process_exit_removes_only_unpublished_export(tmp_path, complete):
    directory = tmp_path / 'crashed'
    child = '''
import os, sys
from alder.document_exports import DocumentExports
from alder.store import Store
s = DocumentExports(Store(sys.argv[1]))
p = s.store.create('Crash fixture', 'blank')
j = s.start(p['id'], 'txt')
s.jobs[j['id']]['future'].result(timeout=10)
assert s.get(j['id'])['status'] == 'ready'
if sys.argv[2] == 'yes': s.complete(j['id'])
os._exit(37)
'''
    process = subprocess.run([sys.executable, '-B', '-c', child, str(directory), 'yes' if complete else 'no'], env=os.environ.copy(), capture_output=True, text=True, timeout=20)
    assert process.returncode == 37, process.stderr
    outputs = list((directory / 'exports').glob('export_*')); assert len(outputs) == 1
    service = DocumentExports(Store(directory))
    try:
        assert outputs[0].exists() == complete
        if complete: assert (outputs[0] / 'result.json').is_file()
        assert not list((directory / 'exports' / '.preparing').iterdir())
        assert len(service.store.list_projects()) == 1
    finally: service.shutdown()


def test_recovery_does_not_remove_a_live_prepared_export_or_unknown_record(service):
    p = project(service); job = service.start(p['id'], 'txt'); ready(service, job)
    directory = service.jobs[job['id']]['directory']
    unknown = service.root / ('export_' + 'a' * 32); unknown.mkdir(); (unknown / 'authored.txt').write_text('Keep this')
    (service.root / '.preparing' / (unknown.name + '.lock')).write_bytes(b'Unknown future marker')
    other = DocumentExports(service.store)
    try:
        assert directory.is_dir() and (unknown / 'authored.txt').read_text() == 'Keep this'
        assert service.complete(job['id'])['sourceRevision'] == p['revision']
    finally: other.shutdown()


def test_failed_cleanup_retains_a_recoverable_marker(service, monkeypatch):
    import alder.document_exports as exports
    p = project(service); job = service.start(p['id'], 'txt'); ready(service, job)
    directory = service.jobs[job['id']]['directory']
    with monkeypatch.context() as patch:
        patch.setattr(exports.shutil, 'rmtree', lambda *args, **kwargs: None)
        service.cancel(job['id'])
    assert directory.exists()
    assert (service.root / '.preparing' / (job['id'] + '.lock')).exists()
    other = DocumentExports(service.store)
    try: assert not directory.exists()
    finally: other.shutdown()


def test_editing_during_preparation_keeps_the_original_export_snapshot(service):
    entered, release = threading.Event(), threading.Event()
    from alder.publishing import build_export
    def build(*args):
        entered.set(); assert release.wait(5)
        return build_export(*args)
    service.builder = build; p = project(service); job = service.start(p['id'], 'txt', expected_revision=p['revision'])
    try:
        assert entered.wait(5)
        p['book']['chapters'][0]['document'] = text_document('Later authoring remains saved.')
        edited = service.store.update(p['id'], p, p['revision'])
    finally: release.set()
    assert ready(service, job)['status'] == 'ready'
    result = service.complete(job['id'])
    assert result['sourceRevision'] < edited['revision']
    assert Path(result['path']).read_text('utf-8').strip() == 'Authored words.'
    assert service.store.get(p['id']) == edited
