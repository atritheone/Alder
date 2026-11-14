from alder.store import Store

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
