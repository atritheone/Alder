import concurrent.futures
import json

from fastapi.testclient import TestClient
from alder.deferred import DeferredService


def test_health_and_document_opening_do_not_initialize_optional_services(tmp_path, monkeypatch):
    from alder.app import create_app
    from alder import language, speech_pipeline
    def forbidden(*args, **kwargs):
        raise AssertionError("Optional resource loaded before first use")
    monkeypatch.setattr(language, "_wordnet", forbidden)
    monkeypatch.setattr(language, "_speller", forbidden)
    monkeypatch.setattr(speech_pipeline, "SpeechPipeline", forbidden)
    with TestClient(create_app(tmp_path)) as client:
        assert client.get("/api/health").json()["status"] == "ok"
        assert client.get("/api/projects").json() == {"projects": []}
        assert client.post("/api/projects", json={"template": "blank"}).status_code == 200


def test_deferred_service_initializes_once_under_concurrent_requests():
    made = []
    class Service:
        def shutdown(self): made.append("closed")
    def factory():
        made.append("created")
        return Service()
    service = DeferredService(factory)
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        values = list(pool.map(lambda _: service.get(), range(32)))
    assert all(value is values[0] for value in values)
    assert made == ["created"]
    service.shutdown()
    service.shutdown()
    assert made == ["created", "closed"]


def test_unused_service_shutdown_never_calls_factory():
    service = DeferredService(lambda: (_ for _ in ()).throw(AssertionError("initialized")))
    assert service.has_active_generation() is False
    service.shutdown()


def test_speech_index_tracks_changed_manifests_and_preserves_damaged_files(tmp_path):
    from alder.speech_library import SpeechLibrary
    folder = tmp_path / "job_one"
    folder.mkdir()
    manifest = folder / "manifest.json"
    manifest.write_text(json.dumps({"id": "job_one", "projectId": "first", "createdAt": "2026"}))
    library = SpeechLibrary(tmp_path)
    assert library.ids_for_project("first") == ["job_one"]
    manifest.write_text(json.dumps({"id": "job_one", "projectId": "second", "createdAt": "2026"}))
    assert library.ids_for_project("first") == []
    assert library.ids_for_project("second") == ["job_one"]
    manifest.write_text("damaged")
    assert library.ids_for_project("second") == []
    assert manifest.read_text() == "damaged"


def test_project_payload_and_proofreading_context_preserve_language_settings(tmp_path):
    from alder.store import Store
    from alder.proofreading.contracts import configuration
    store = Store(tmp_path)
    project = store.create(template="blank")
    project['settings'].update(proofreadingStyle=True, longSentenceWords=45,
                               customRules=[{'id':'test','match':'test','message':'Test'}])
    saved = store.update(project['id'], project, project['revision'])
    assert json.loads(store.project_payload(saved['id'])) == saved
    context = store.proofreading_context(saved['id'])
    assert configuration(context) == configuration(saved)
    assert context['settings']['customRules'] == saved['settings']['customRules']
    assert context['settings']['longSentenceWords'] == 45
    assert 'clips' not in context and 'book' not in context


def test_proofreading_uses_validated_unsaved_configuration_without_saving(tmp_path):
    from alder.app import create_app
    app = create_app(tmp_path)
    project = app.state.store.create(template='blank')
    received = []
    app.state.proofreading.start = lambda data, context: received.append(context) or {'status':'completed'}
    context = {'language':'en-GB','dictionary':[], 'ideas':[],
               'settings':{'customRules':[{'id':'live','match':'word','message':'Live'}]}}
    with TestClient(app) as client:
        response=client.post('/api/proofreading/check',json={'projectId':project['id'],'projectContext':context})
        assert response.status_code == 200
        assert received[-1]['settings']['customRules'][0]['id']=='live'
        assert app.state.store.get(project['id'])['revision']==project['revision']
        context['settings']['customRules'][0]['match']=''
        assert client.post('/api/proofreading/check',json={'projectId':project['id'],'projectContext':context}).status_code==422
