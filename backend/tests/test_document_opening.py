from copy import deepcopy
from pathlib import Path
import base64
import threading
import pytest

from alder.document_opening import DocumentOpening
from alder.models import ValidationError, document_text, text_document, validate_project
from alder.store import Store


@pytest.fixture
def opening(tmp_path):
    service = DocumentOpening(Store(tmp_path / 'data'))
    yield service
    service.shutdown()
    service.pool.shutdown(wait=True, cancel_futures=True)


def ready(service, identity):
    service.jobs[identity]['future'].result(timeout=10)
    return service.get(identity)


@pytest.mark.parametrize('suffix,preferred', [('txt','txt'), ('md','md'), ('markdown','md'), ('rtf','rtf'), ('odt','odt'), ('docx','docx'), ('pdf','docx')])
def test_import_is_staged_until_one_idempotent_commit(opening, suffix, preferred):
    opening.importer = lambda _: {'document': text_document('Imported words.'), 'settings': {'fontSize': 17}, 'warnings': ['An explicit conversion.']}
    existing = opening.store.create('Existing', 'blank'); before = deepcopy(existing)
    job = opening.start('Example.'+suffix, b'fixture')
    assert ready(opening, job['id'])['status'] == 'ready'
    assert len(opening.store.list_projects()) == 1
    assert not list((opening.store.data_dir / 'assets').glob('*'))
    saved = opening.commit(job['id'])
    assert saved['settings']['preferredFormat'] == preferred
    assert saved['settings']['fontSize'] == 17
    assert saved['lastImport']['warnings'] == ['An explicit conversion.']
    assert document_text(saved['book']['chapters'][0]['document']) == 'Imported words.'
    assert saved['clips'][-1]['text'] == 'Imported words.'
    assert saved['revision'] == 1 and len(opening.store.versions(saved['id'])) == 1
    assert opening.commit(job['id']) == saved
    assert opening.cancel(job['id'])['status'] == 'completed'
    assert opening.store.get(existing['id']) == before
    assert not list(opening.root.iterdir())


def test_real_text_import_keeps_unicode_and_exact_paragraphs(opening):
    text = 'First paragraph 😀\nSecond line, café.'
    job = opening.start('Words.txt', text.encode())
    assert ready(opening, job['id'])['status'] == 'ready'
    project = opening.commit(job['id'])
    assert document_text(project['book']['chapters'][0]['document']) == text


def test_cancellation_during_parsing_never_publishes_a_workspace(opening):
    entered, release = threading.Event(), threading.Event()
    def parse(_):
        entered.set(); assert release.wait(5)
        return {'document': text_document('Must not appear.')}
    opening.importer = parse
    job = opening.start('Cancelled.docx', b'fixture')
    try:
        assert entered.wait(5)
        assert opening.cancel(job['id'])['status'] == 'cancelled'
        assert not opening.store.list_projects()
        with pytest.raises(ValidationError, match='not ready'): opening.commit(job['id'])
    finally: release.set()
    assert ready(opening, job['id'])['status'] == 'cancelled'
    assert not opening.store.list_projects() and not list(opening.root.iterdir())


def test_ready_cancellation_drops_collected_assets_without_touching_existing_files(opening):
    existing = opening.store.create('Retained', 'blank')
    asset = opening.store.store_asset(existing['id'], 'kept.txt', b'keep')
    opening.importer = lambda _: {'document': text_document('New'), 'assets': [{'id': 'new_image', 'name': 'new.png', 'data': base64.b64encode(b'image').decode(), 'mime': 'image/png'}]}
    job = opening.start('cancel.docx', b'fixture')
    assert ready(opening, job['id'])['status'] == 'ready'
    opening.cancel(job['id'])
    assert len(opening.store.list_projects()) == 1 and not list(opening.root.iterdir())
    assert (opening.store.asset_dir(existing['id']) / asset['path']).read_bytes() == b'keep'


def test_failure_and_storage_failure_leave_no_partial_project(opening, monkeypatch):
    def broken(_): raise ValueError('Unreadable source.')
    opening.importer = broken
    job = opening.start('broken.docx', b'invalid')
    assert ready(opening, job['id'])['error'] == 'Unreadable source.'
    opening.importer = lambda _: {'document': text_document('New'), 'assets': [{'id': 'new_image', 'name': 'new.png', 'data': base64.b64encode(b'image').decode()}]}
    job = opening.start('disk.docx', b'fixture')
    assert ready(opening, job['id'])['status'] == 'ready'
    monkeypatch.setattr(opening.store, 'insert', lambda _: (_ for _ in ()).throw(OSError('Disk full')))
    with pytest.raises(OSError, match='Disk full'): opening.commit(job['id'])
    assert opening.get(job['id'])['status'] == 'failed'
    assert not opening.store.list_projects() and not list(opening.root.iterdir())
    assert not list((opening.store.data_dir / 'assets').iterdir())


def test_changed_staged_asset_is_not_published(opening):
    opening.importer = lambda _: {'document': text_document('New'), 'assets': [{'id': 'new_image', 'name': 'new.png', 'data': base64.b64encode(b'image').decode()}]}
    job = opening.start('changed.docx', b'fixture'); ready(opening, job['id'])
    staged = opening.jobs[job['id']]; project = staged['project']
    (staged['directory'] / 'staged' / 'assets' / project['id'] / project['assets'][0]['path']).write_bytes(b'corrupted')
    with pytest.raises(ValidationError, match='integrity'): opening.commit(job['id'])
    assert not opening.store.list_projects() and not list(opening.root.iterdir())


def test_queued_cancellation_and_shutdown_do_not_start_another_parser(opening):
    entered, release = threading.Event(), threading.Event(); calls = []
    def parse(path):
        calls.append(path); entered.set(); assert release.wait(5)
        return {'document': text_document('New')}
    opening.importer = parse
    first = opening.start('first.txt', b'first')
    try:
        assert entered.wait(5)
        queued = opening.start('queued.txt', b'queued')
        opening.cancel(queued['id'])
        assert opening.jobs[queued['id']]['future'].cancelled()
        opening.shutdown()
        with pytest.raises(ValidationError, match='shutting down'): opening.start('late.txt', b'late')
    finally: release.set()
    assert ready(opening, first['id'])['status'] == 'cancelled'
    assert len(calls) == 1 and not list(opening.root.iterdir())


def test_expiration_does_not_delete_a_cancelled_parsers_working_files(opening):
    entered, release = threading.Event(), threading.Event()
    def parse(path):
        entered.set(); assert release.wait(5)
        assert path.read_bytes() == b'first'
        return {'document': text_document('Cancelled')}
    opening.importer = parse
    first = opening.start('first.txt', b'first')
    try:
        assert entered.wait(5)
        opening.cancel(first['id'])
        opening.jobs[first['id']]['touched'] -= 901
        second = opening.start('second.txt', b'second')
        assert first['id'] in opening.jobs
        assert (opening.jobs[first['id']]['directory'] / 'source.txt').exists()
        opening.cancel(second['id'])
    finally: release.set()
    assert ready(opening, first['id'])['status'] == 'cancelled'
    assert not list(opening.root.iterdir())


def test_abandoned_prepared_uploads_expire_and_queue_is_bounded(opening):
    opening.importer = lambda _: {'document': text_document('Prepared')}
    jobs = [opening.start(str(index)+'.txt', b'upload') for index in range(4)]
    for job in jobs: assert ready(opening, job['id'])['status'] == 'ready'
    with pytest.raises(ValidationError, match='Finish or cancel'):
        opening.start('fifth.txt', b'upload')
    committed = opening.commit(jobs[0]['id'])
    for job in jobs: opening.jobs[job['id']]['touched'] -= 901
    replacement = opening.start('replacement.txt', b'upload')
    assert ready(opening, replacement['id'])['status'] == 'ready'
    assert list(opening.jobs) == [replacement['id']]
    assert len(list(opening.root.iterdir())) == 1
    assert [p['id'] for p in opening.store.list_projects()] == [committed['id']]


def test_structured_book_and_collected_images_retain_their_properties(opening):
    from alder.publishing import build_export
    from PIL import Image
    from io import BytesIO
    project = opening.store.create('Authored', 'blank')
    project['settings'].update(documentKind='book', includeTitle=False)
    project['book'] = {'version': 1, 'chapters': [
        {'id': 'first', 'title': 'First chapter', 'include': True, 'document': text_document('First authored passage.')},
        {'id': 'second', 'title': 'Second chapter', 'include': True, 'document': text_document('Second authored passage.')},
    ]}
    image = BytesIO(); Image.new('RGB', (8, 8), 'blue').save(image, format='PNG')
    asset = opening.store.store_asset(project['id'], 'picture.png', image.getvalue(), 'image/png')
    project['assets'].append(asset)
    project['book']['chapters'][0]['document']['content'][0]['content'].append({'type': 'inline_image', 'attrs': {'assetId': asset['id'], 'src': f"/api/projects/{project['id']}/assets/{asset['id']}", 'width': 30, 'alt': 'Blue picture'}})
    project = validate_project(project)
    exported = Path(build_export(project, 'docx', opening.store.data_dir / 'source', {'assetRoot': opening.store.asset_dir(project['id'])})['path'])
    job = opening.start('book.docx', exported.read_bytes())
    assert ready(opening, job['id'])['status'] == 'ready'
    saved = opening.commit(job['id'])
    assert saved['settings']['documentKind'] == 'book'
    assert [document_text(c['document']) for c in saved['book']['chapters']] == ['First authored passage.', 'Second authored passage.']
    assert len(saved['assets']) == 1
    assert (opening.store.asset_dir(saved['id']) / saved['assets'][0]['path']).read_bytes() == image.getvalue()


def test_loopback_open_job_api_preserves_auth_and_cancellation(tmp_path):
    from fastapi.testclient import TestClient
    from alder.app import create_app
    app = create_app(tmp_path / 'api', session_token='opening-secret')
    with TestClient(app) as client:
        path = '/api/document-open-jobs/import'
        assert client.post(path, files={'file': ('a.txt', b'hello')}).status_code == 401
        client.headers['Authorization'] = 'Bearer opening-secret'
        response = client.post(path, files={'file': ('a.txt', b'hello')}); assert response.status_code == 200
        identity = response.json()['id']; assert ready(app.state.opening, identity)['status'] == 'ready'
        assert client.get('/api/document-open-jobs/'+identity).json()['status'] == 'ready'
        assert client.delete('/api/document-open-jobs/'+identity).json()['status'] == 'cancelled'
        assert client.post('/api/document-open-jobs/'+identity+'/open').status_code == 422
        assert client.get('/api/projects').json()['projects'] == []
