from copy import deepcopy
import pytest
from alder.models import ValidationError, text_document
from alder.store import Store, ConflictError
from alder.templates import Templates


def source(store):
    project = store.create('Source manuscript', 'blank')
    asset = store.store_asset(project['id'], 'figure.png', b'collected fixture image', 'image/png')
    unused = store.store_asset(project['id'], 'unused.png', b'unused image', 'image/png')
    project['assets'] = [asset, unused]
    project['settings'].update(documentKind='docx', pageNumberFormat='lowerRoman', firstPageNumber=3)
    project['book'] = {'version':1, 'chapters':[{'id':'source-chapter','title':'Document','include':True,'document':{'type':'doc','content':[
        {'type':'paragraph','attrs':{'styleId':project['styles'][0]['id']},'content':[{'type':'text','text':'Reusable letter opening'}]},
        {'type':'image','attrs':{'assetId':asset['id'],'alt':'Diagram','width':180}},
        {'type':'section_break','attrs':{'page':{'pageSize':'A5'},'kind':'oddPage','numberingStart':1}},
        {'type':'paragraph'}]}}]}
    project['clips'][0]['document'] = text_document('PRIVATE SANDBOX DRAFT')
    project['book']['chapters'][0]['rawSource'] = {'format':'html', 'text':f'<p>Reusable letter opening</p><img src="/api/projects/{project["id"]}/assets/{asset["id"]}"/>'}
    return store.update(project['id'], project, project['revision'])


def test_template_collects_only_document_assets_and_creates_independent_copies(tmp_path):
    store = Store(tmp_path)
    project = source(store)
    before = deepcopy(store.get(project['id']))
    library = Templates(store)
    template = library.save(project['id'], 'Letter')
    assert store.get(project['id']) == before
    assert len(store.list_projects()) == 1
    # Collected templates remain usable after original assets disappear.
    store.asset_path(project['id'], project['assets'][0]['id'])[0].unlink()
    first = Templates(Store(tmp_path)).create(template['id'], 'First letter')
    second = library.create(template['id'], 'Second letter')
    assert len({first['id'],second['id'],project['id']}) == 3
    assert first['book']['chapters'][0]['id'] != second['book']['chapters'][0]['id']
    assert first['book']['chapters'][0]['document']['content'][0]['attrs']['blockId'] != second['book']['chapters'][0]['document']['content'][0]['attrs']['blockId']
    assert first['settings']['pageNumberFormat'] == 'lowerRoman'
    assert first['clips'][0]['text'] == ''
    assert len(first['assets']) == 1
    assert store.asset_path(first['id'], first['assets'][0]['id'])[0].read_bytes() == b'collected fixture image'
    assert first['book']['chapters'][0]['document']['content'][0]['attrs']['styleId'] == first['styles'][0]['id']
    assert first['styles'][2]['basedOn'] == first['styles'][0]['id']
    assert first['styles'][2]['nextStyle'] == first['styles'][0]['id']
    assert f'/api/projects/{first["id"]}/assets/{first["assets"][0]["id"]}' in first['book']['chapters'][0]['rawSource']['text']
    assert project['id'] not in first['book']['chapters'][0]['rawSource']['text']
    assert first['revision'] == 1 and len(store.versions(first['id'])) == 1
    first['book']['chapters'][0]['document'] = text_document('Changed only the new letter')
    store.update(first['id'], first, first['revision'])
    assert library.create(template['id'], 'Third letter')['book']['chapters'][0]['text'].startswith('Reusable letter opening')


def test_formatting_only_and_reversible_template_removal(tmp_path):
    store = Store(tmp_path)
    project = source(store)
    library = Templates(store)
    template = library.save(project['id'], 'Formatting', False)
    copy = library.create(template['id'], 'Blank letter')
    assert copy['book']['chapters'][0]['text'] == ''
    assert copy['assets'] == []
    assert copy['settings']['firstPageNumber'] == 3
    library.remove(template['id'])
    assert library.list() == []
    with pytest.raises(KeyError):
        library.create(template['id'], 'Unavailable')
    library.remove(template['id'], False)
    assert library.list() == [template]
    with pytest.raises(ConflictError):
        library.save(project['id'], ' formatting ', False)


def test_template_relocates_bookmark_link_identities(tmp_path):
    store=Store(tmp_path);project=source(store)
    project['book']['chapters'][0]['document']['content'].append({'type':'paragraph','content':[{'type':'bookmark','attrs':{'name':'Target','blockId':'template-target'}},{'type':'text','text':'Go','marks':[{'type':'link','attrs':{'href':'#template-target'}}]}]})
    project=store.update(project['id'],project,project['revision'])
    library=Templates(store);template=library.save(project['id'],'Bookmarked template')
    created=library.create(template['id'],'Independent target')
    content=created['book']['chapters'][0]['document']['content'][-1]['content']
    assert content[0]['attrs']['blockId']!='template-target'
    assert content[1]['marks'][0]['attrs']['href']=='#'+content[0]['attrs']['blockId']


def test_missing_or_corrupt_template_asset_never_publishes_broken_project(tmp_path):
    store = Store(tmp_path)
    project = source(store)
    library = Templates(store)
    template = library.save(project['id'], 'Collected')
    path = library.assets / project['assets'][0]['path']
    path.write_bytes(b'corrupt')
    with pytest.raises(ValidationError, match='integrity'):
        library.create(template['id'], 'Corrupt')
    path.unlink()
    with pytest.raises(ValidationError, match='missing'):
        library.create(template['id'], 'Missing')
    assert len(store.list_projects()) == 1


def test_template_api_preserves_source_and_validates_input(tmp_path):
    from fastapi.testclient import TestClient
    from alder.app import create_app
    app = create_app(tmp_path, session_token='templates-test')
    project = source(app.state.store)
    with TestClient(app) as client:
        assert client.get('/api/document-templates').status_code == 401
        client.headers['Authorization'] = 'Bearer templates-test'
        result = client.post(f"/api/projects/{project['id']}/document-template", json={'name':'API template'} )
        assert result.status_code == 200, result.text
        template = result.json()
        assert client.get('/api/document-templates').json()['templates'] == [template]
        copy = client.post(f"/api/document-templates/{template['id']}/create", json={'name':'New from API'})
        assert copy.status_code == 200, copy.text
        assert copy.json()['id'] != project['id']
        assert client.post(f"/api/document-templates/{template['id']}/create", json={'name':''}).status_code == 422
        assert client.delete(f"/api/document-templates/{template['id']}").status_code == 200
        assert client.get('/api/document-templates').json()['templates'] == []
        assert client.post(f"/api/document-templates/{template['id']}/restore").status_code == 200
        assert app.state.store.get(project['id']) == project


def test_template_persistence_failure_keeps_the_library_and_source_intact(tmp_path, monkeypatch):
    store = Store(tmp_path)
    project = source(store)
    library = Templates(store)
    def fail(*args):
        raise OSError('Simulated image write failure')
    monkeypatch.setattr(store, '_atomic_bytes', fail)
    with pytest.raises(OSError):
        library.save(project['id'], 'Broken write')
    assert library.list() == []
    assert store.get(project['id']) == project


def test_legacy_collation_keeps_authored_text(tmp_path):
    store = Store(tmp_path)
    project = store.create('Legacy collation', 'demo')
    library = Templates(store)
    template = library.save(project['id'], 'Collected legacy')
    copy = library.create(template['id'], 'Independent legacy')
    from alder.publishing import project_document
    assert [section['text'] for section in project_document(copy)] == [section['text'] for section in project_document(project)]
