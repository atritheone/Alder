import copy
import pytest
from fastapi.testclient import TestClient
from alder.app import create_app
from alder.models import ValidationError
from alder.project_changes import apply_project_changes
from test_save_changes import apply


def test_partial_save_matches_full_snapshot_normalisation_and_durable_history(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        original = client.post('/api/projects',json={'template':'blank'}).json()
        path = '/api/projects/' + original['id']
        changes = [{'path':['name'],'value':'Unicode 🦉'},
                   {'path':['clips',0,'document'],'value':{'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':'café'}]}]}}]
        submitted = apply_project_changes(copy.deepcopy(original), changes)
        response = client.put(path,json={'changes':changes,'expectedRevision':original['revision'],'responseMode':'changes'})
        assert response.status_code == 200
        saved = client.get(path).json()
        assert apply(submitted,response.json()) == saved
        assert saved['clips'][0]['text'] == 'café'
        assert client.put(path,json={'changes':changes,'expectedRevision':original['revision']}).status_code == 409
        # Recovery still stores the complete snapshot, not client deltas.
        restored = client.post(path+'/undo').json()
        assert restored['name'] == original['name']
        assert client.post(path+'/redo').json()['clips'][0]['text'] == 'café'
        for changes in [[{'path':['id'],'value':'different'}],[{'path':['name'],'value':''}],[{'path':['clips',999],'value':{}}]]:
            before = client.get(path).json()
            assert client.put(path,json={'changes':changes,'expectedRevision':before['revision']}).status_code == 422
            assert client.get(path).json() == before


@pytest.mark.parametrize('changes', [None, {}, [{'path':[],'value':2}], [{'path':['x']}],
    [{'path':['a',True],'value':1}], [{'path':['missing','x'],'value':1}],
    [{'path':['a',0],'remove':True}], [{'path':['a',-1],'value':1}],
    [{'path':['a',0],'remove':'true'}]])
def test_invalid_paths_are_rejected(changes):
    with pytest.raises(ValidationError): apply_project_changes({'a':[1]},changes)


def test_concurrent_commit_between_read_and_validation_is_rejected(tmp_path, monkeypatch):
    app = create_app(tmp_path)
    with TestClient(app) as client:
        original = app.state.store.create(template='blank')
        update = app.state.store.update
        advanced = False
        def concurrent(project_id, project, expected):
            nonlocal advanced
            if not advanced:
                advanced = True
                winner = app.state.store.get(project_id); winner['name'] = 'Concurrent winner'
                update(project_id,winner,expected)
            return update(project_id,project,expected)
        monkeypatch.setattr(app.state.store,'update',concurrent)
        response=client.put('/api/projects/'+original['id'],json={'expectedRevision':original['revision'],'changes':[{'path':['name'],'value':'Stale edit'}]})
        assert response.status_code==409
        assert app.state.store.get(original['id'])['name']=='Concurrent winner'
