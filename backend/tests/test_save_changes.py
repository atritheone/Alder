import copy
import json
from fastapi.testclient import TestClient
from alder.app import create_app
from alder.save_changes import canonical_changes


def apply(source, reply):
    result = copy.deepcopy(source)
    for change in reply['changes']:
        parent = result
        for key in change['path'][:-1]: parent = parent[key]
        key = change['path'][-1]
        if change.get('remove'): del parent[key]
        else: parent[key] = change['value']
    return result


def test_corrections_preserve_json_types_lists_and_removals():
    source = {'revision':1,'value':True,'removed':3,'array':[{'text':'old'},2]}
    saved = {'revision':2,'value':1,'added':'🦉','array':[{'text':'new'}]}
    assert apply(source, canonical_changes(source, saved)) == saved


def test_large_normalisation_uses_the_full_response_fallback():
    source = {'revision':1,'values':list(range(200))}
    saved = {'revision':2,'values':list(range(1,201))}
    assert canonical_changes(source, saved) is saved


def test_save_corrections_equal_full_canonical_snapshot_and_keep_conflicts(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        project = client.post('/api/projects', json={'template':'blank'}).json()
        path = '/api/projects/' + project['id']
        # Normalisation must return generated ids, derived text, timestamps and
        # removed stale source, rather than merely an acknowledgement revision.
        project['clips'][0]['document'] = {'type':'doc','content':[
            {'type':'paragraph','content':[{'type':'text','text':'🦉 café\nNew'}]}]}
        project['clips'][0]['text'] = 'stale derived text'
        response = client.put(path, json={'project':project,'expectedRevision':project['revision'],'responseMode':'changes'})
        assert response.status_code == 200
        reply = response.json()
        assert apply(project, reply) == client.get(path).json()
        assert len(json.dumps(reply)) < len(json.dumps(project))
        assert client.put(path, json={'project':project,'expectedRevision':project['revision'],'responseMode':'changes'}).status_code == 409
        assert client.get(path).json() == apply(project, reply)
        invalid = copy.deepcopy(apply(project, reply)); invalid['name'] = ''
        assert client.put(path, json={'project':invalid,'expectedRevision':reply['savedRevision'],'responseMode':'changes'}).status_code == 422
        assert client.get(path).json() == apply(project, reply)
        # Older callers still receive the complete canonical project.
        full = client.put(path, json={'project':apply(project, reply),'expectedRevision':reply['savedRevision']})
        assert full.status_code == 200
        assert full.json() == client.get(path).json()
