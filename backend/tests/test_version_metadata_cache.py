from alder.store import Store
from contextlib import contextmanager
import json

def test_version_metadata_matches_history_after_updates_undo_and_external_writer(tmp_path):
    store=Store(tmp_path);project=store.create('history');identity=project['id']
    for i in range(5):
        project['name']=f'Name {i}';project=store.update(identity,project,project['revision'])
        assert store.versions(identity)==Store(tmp_path).versions(identity)
    rows=store.versions(identity);rows[0]['name']='mutated response'
    assert store.versions(identity)[0]['name']==project['name']
    project=store.history_step(identity,-1)
    assert store.versions(identity)==Store(tmp_path).versions(identity)
    project=store.update(identity,project,project['revision'])
    assert store.versions(identity)==Store(tmp_path).versions(identity)
    other=Store(tmp_path);project=other.get(identity);project['name']='External writer'
    other.update(identity,project,project['revision'])
    assert store.versions(identity)==other.versions(identity)
    assert store._version_metadata.retained_bytes<=4*1024*1024

def test_persisted_metadata_avoids_snapshot_scans_and_corruption_backfills(tmp_path,monkeypatch):
    store=Store(tmp_path);project=store.create('indexed history');identity=project['id']
    for i in range(205):
        project['name']=f'Version {i}';project=store.update(identity,project,project['revision'])
    expected=store.versions(identity);assert len(expected)==201
    reopened=Store(tmp_path);queries=[];original=reopened.connection
    @contextmanager
    def traced():
        with original() as conn:
            conn.set_trace_callback(queries.append);yield conn
    monkeypatch.setattr(reopened,'connection',traced)
    assert reopened.versions(identity)==expected
    assert not any('json_extract' in query for query in queries)
    path=store._version_metadata_files.path(identity);path.write_text('{invalid cache')
    damaged=Store(tmp_path);assert damaged.versions(identity)==expected
    assert json.loads(path.read_text())['revision']==project['revision']
    assert store.recover_version(identity,expected[-1]['sequence'])['name'].startswith(expected[-1]['name'])

def test_cache_write_failure_cannot_change_save_acknowledgement(tmp_path,monkeypatch):
    store=Store(tmp_path);project=store.create('Before');identity=project['id']
    def denied(*_):raise PermissionError('Synthetic cache directory failure')
    monkeypatch.setattr('alder.version_metadata.os.replace',denied)
    project['name']='Acknowledged';saved=store.update(identity,project,project['revision'])
    assert store.get(identity)==saved
    assert Store(tmp_path).versions(identity)[0]['name']=='Acknowledged'

def test_disposable_disk_cache_is_bounded(tmp_path):
    from alder.version_metadata import VersionMetadata
    cache=VersionMetadata(tmp_path)
    for i in range(70):cache.write(str(i),{'revision':1,'sourceUpdatedAt':'now','cursor':0,'rows':[{'sequence':0,'revision':1,'name':str(i),'updatedAt':'now'}]})
    assert len(list(cache.root.glob('*.json')))==64
    assert cache.read('69',1,'now')['rows'][0]['name']=='69'
    assert cache.read('69',2,'now') is None
