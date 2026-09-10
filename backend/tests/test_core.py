from copy import deepcopy
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

import pytest

from alder.models import ValidationError, create_project, text_document, validate_project
from alder.store import ConflictError, Store


def test_validates_all_relationships_and_derived_text():
    p = create_project(template="demo")
    p["clips"][0]["text"] = "wrong derived field"
    assert validate_project(p)["clips"][0]["text"] == "I"
    p["placements"][0]["clipId"] = "missing"
    with pytest.raises(ValidationError, match="missing clip"):
        validate_project(p)


@pytest.mark.parametrize("mutation", [
    lambda p: p["tracks"].append(deepcopy(p["tracks"][0])),
    lambda p: p["clips"][0].update(trackId="missing"),
    lambda p: p["clips"][0].update(activeVariantId="missing"),
    lambda p: p["clips"][1].update(slot=p["clips"][0]["slot"]),
    lambda p: p.update(schemaVersion=99),
    lambda p: p["clips"][0].update(document={"type": "doc", "content": [{"type": "script"}]}),
    lambda p: p["clips"][0].update(document={"type": "doc", "content": [{"type": "image", "attrs": {"assetId": "missing"}}]}),
])
def test_invalid_project_is_rejected(mutation):
    p = create_project()
    mutation(p)
    with pytest.raises(ValidationError):
        validate_project(p)


def test_edit_conflict_undo_redo_and_branch(tmp_path):
    store = Store(tmp_path)
    p = store.create(template="blank")
    revision_one = deepcopy(p)
    p["clips"][0]["document"] = text_document("First edit\nSecond paragraph 😀")
    edited = store.update(p["id"], p, p["revision"])
    assert edited["revision"] == 2
    assert edited["clips"][0]["revision"] == 2
    with pytest.raises(ConflictError) as error:
        store.update(p["id"], revision_one, 1)
    assert error.value.current["revision"] == 2
    undo = store.history_step(p["id"], -1)
    assert undo["clips"][0]["text"] == ""
    assert undo["revision"] == 3
    redo = store.history_step(p["id"], 1)
    assert redo["clips"][0]["text"] == "First edit\nSecond paragraph 😀"
    assert redo["revision"] == 4
    undo = store.history_step(p["id"], -1)
    undo["clips"][0]["document"] = text_document("A new branch")
    branch = store.update(p["id"], undo, undo["revision"])
    assert not store.history_status(p["id"])["canRedo"]
    assert Store(tmp_path).get(p["id"]) == branch


def test_atomic_archive_assets_snapshot_and_open(tmp_path):
    store = Store(tmp_path / "one")
    p = store.create(template="blank")
    asset = store.store_asset(p["id"], "source.txt", b"the original material", "text/plain")
    p["assets"].append(asset)
    p["clips"][0]["document"] = text_document("A passage with smart “quotes”.")
    p = store.update(p["id"], p, p["revision"])
    archive = store.save_archive(p["id"], str(tmp_path / "book.alder"))
    with ZipFile(archive) as zipped:
        assert {"manifest.json", "project.json", "snapshot.sqlite3"} <= set(zipped.namelist())
        manifest = json.loads(zipped.read("manifest.json"))
        assert hashlib.sha256(zipped.read("project.json")).hexdigest() == manifest["files"]["project.json"]["sha256"]
    restored = Store(tmp_path / "two")
    new = restored.open_archive(str(archive))
    assert new["clips"][0]["text"] == p["clips"][0]["text"]
    path, metadata = restored.asset_path(new["id"], asset["id"])
    assert path.read_bytes() == b"the original material"
    assert metadata["name"] == "source.txt"


def test_reopening_old_archive_preserves_newer_autosave(tmp_path):
    store = Store(tmp_path / "store")
    p = store.create(template="blank")
    archive = store.save_archive(p["id"], str(tmp_path / "book.alder"))
    p["clips"][0]["document"] = text_document("Newer autosaved writing")
    current = store.update(p["id"], p, 1)
    imported = store.open_archive(str(archive))
    assert imported["id"] != current["id"]
    assert store.get(current["id"])["clips"][0]["text"] == "Newer autosaved writing"
    assert imported["clips"][0]["text"] == ""


def test_reopening_identical_archive_repairs_missing_collected_assets(tmp_path):
    store = Store(tmp_path / "store")
    p = store.create(template="blank")
    data = b"collected original source material"
    asset = store.store_asset(p["id"], "source.txt", data, "text/plain")
    p["assets"].append(asset)
    saved = store.update(p["id"], p, p["revision"])
    archive = store.save_archive(saved["id"], str(tmp_path / "collected.alder"))
    path, _ = store.asset_path(saved["id"], asset["id"])
    path.unlink()
    with pytest.raises(KeyError, match="missing"):
        store.asset_path(saved["id"], asset["id"])
    restored = store.open_archive(str(archive))
    assert restored == saved
    assert store.asset_path(saved["id"], asset["id"])[0].read_bytes() == data
    assert len(store.list_projects()) == 1


@pytest.mark.parametrize("version", ["99", "invalid", None])
def test_future_or_missing_database_schema_is_rejected_without_changes(tmp_path, version):
    import sqlite3
    store = Store(tmp_path)
    store.create(template="blank")
    with sqlite3.connect(store.db_path) as conn:
        if version is None:
            conn.execute("DELETE FROM metadata WHERE key='schema_version'")
        else:
            conn.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (version,))
        conn.commit()
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    before = store.db_path.read_bytes()
    with pytest.raises(ValidationError, match="unsupported schema"):
        Store(tmp_path)
    assert store.db_path.read_bytes() == before


def test_unreadable_database_is_preserved(tmp_path):
    path = tmp_path / "alder.sqlite3"
    path.write_bytes(b"unreadable database fixture")
    with pytest.raises(ValidationError, match="could not be read"):
        Store(tmp_path)
    assert path.read_bytes() == b"unreadable database fixture"


def test_external_change_is_not_overwritten(tmp_path):
    store = Store(tmp_path / "store")
    p = store.create(template="blank")
    archive = store.save_archive(p["id"], str(tmp_path / "book.alder"))
    archive.write_bytes(b"a competing saved version")
    with pytest.raises(ConflictError, match="outside Alder"):
        store.save_archive(p["id"], str(archive))
    assert archive.read_bytes() == b"a competing saved version"


def test_unsafe_archive_paths_and_integrity_rejected(tmp_path):
    store = Store(tmp_path / "store")
    malicious = tmp_path / "unsafe.alder"
    with ZipFile(malicious, "w") as archive:
        archive.writestr("../outside.txt", "not extracted")
    with pytest.raises(ValidationError, match="unsafe"):
        store.open_archive(str(malicious))
    assert not (tmp_path / "outside.txt").exists()
    p = store.create(template="blank")
    archive = store.save_archive(p["id"], str(tmp_path / "valid.alder"))
    corrupt = tmp_path / "corrupt.alder"
    with ZipFile(archive) as original, ZipFile(corrupt, "w", ZIP_DEFLATED) as edited:
        for name in original.namelist():
            edited.writestr(name, b"{}" if name == "project.json" else original.read(name))
    with pytest.raises(ValidationError, match="integrity"):
        store.open_archive(str(corrupt))


def test_api_end_to_end_and_auth(tmp_path):
    from fastapi.testclient import TestClient
    from alder.app import create_app
    app = create_app(tmp_path, session_token="test-session")
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 401
        headers = {"Authorization": "Bearer test-session"}
        assert client.get("/api/health", headers=headers).status_code == 200
        assert client.get("/api/health", headers={**headers, "Origin": "https://unknown.example"}).status_code == 403
        p = client.post("/api/projects", json={"template": "blank"}, headers=headers).json()
        p["clips"][0]["document"] = text_document("A complete API authoring loop.")
        response = client.put(f"/api/projects/{p['id']}", json={"project": p, "expectedRevision": 1}, headers=headers)
        assert response.status_code == 200
        assert response.json()["revision"] == 2
        assert client.put(f"/api/projects/{p['id']}", json={"project": p, "expectedRevision": 1}, headers=headers).status_code == 409
        assert client.get("/api/ideas?category=Prime", headers=headers).json()["ideas"][0]["word"] == "I"
        save = client.post(f"/api/projects/{p['id']}/save", json={"path": str(tmp_path / "api.alder")}, headers=headers)
        assert save.status_code == 200
        assert Path(save.json()["path"]).is_file()
        assert client.get(f"/api/projects/{p['id']}?token=test-session").status_code == 200


def test_uploaded_asset_cannot_be_served_from_another_project(tmp_path):
    store = Store(tmp_path)
    first = store.create(template="blank")
    second = store.create(template="blank")
    asset = store.store_asset(first["id"], "../relative.txt", b"text")
    first["assets"].append(asset)
    store.update(first["id"], first, first["revision"])
    assert asset["name"] == "relative.txt"
    with pytest.raises(KeyError):
        store.asset_path(second["id"], asset["id"])


def test_api_import_export_and_preview(tmp_path):
    from fastapi.testclient import TestClient
    from alder.app import create_app
    with TestClient(create_app(tmp_path, session_token="")) as client:
        p = client.post("/api/projects", json={"template": "blank"}).json()
        imported = client.post(f"/api/projects/{p['id']}/import", files={"file": ("notes.md", b"# An opening\n\nA paragraph with **emphasis**.", "text/markdown")})
        assert imported.status_code == 200, imported.text
        assert "An opening" in imported.json()["clips"][-1]["text"]
        broken_import = client.post(f"/api/projects/{p['id']}/import", files={"file": ("broken.docx", b"not a document archive", "application/octet-stream")})
        assert broken_import.status_code == 422
        assert client.get(f"/api/projects/{p['id']}").json()["revision"] == imported.json()["revision"]
        preview = client.get(f"/api/projects/{p['id']}/preview")
        assert preview.status_code == 200
        assert "An opening" in preview.text
        assert "script-src" not in preview.headers["content-security-policy"]
        for format in ("txt", "md", "html", "docx", "pdf", "epub"):
            exported = client.post(f"/api/projects/{p['id']}/export", json={"format": format})
            assert exported.status_code == 200, exported.text
            result = exported.json()
            assert result["sourceRevision"] == imported.json()["revision"]
            assert client.get(result["downloadUrl"]).status_code == 200


def test_archive_collects_and_restores_voice_reference(tmp_path):
    store = Store(tmp_path / "one")
    p = store.create(template="blank")
    reference = b"a controlled voice reference fixture"
    voice_id = "a" * 32
    directory = store.data_dir / "speech" / "voices" / voice_id
    directory.mkdir(parents=True)
    (directory / "reference.wav").write_bytes(reference)
    (directory / "voice.json").write_text(json.dumps({"id": voice_id, "name": "Reference", "hash": hashlib.sha256(reference).hexdigest()}))
    p["tracks"][0]["voiceId"] = voice_id
    store.update(p["id"], p, p["revision"])
    archive = store.save_archive(p["id"], str(tmp_path / "voices.alder"))
    second = Store(tmp_path / "two")
    opened = second.open_archive(str(archive))
    assert opened["tracks"][0]["voiceId"] == voice_id
    assert (second.data_dir / "speech" / "voices" / voice_id / "reference.wav").read_bytes() == reference


def test_definition_cards_api_exports_supported_formats(tmp_path):
    from fastapi.testclient import TestClient
    from alder.app import create_app
    from alder.definition_cards import font_directory
    from PIL import Image
    import io
    try:
        font_directory()
    except RuntimeError:
        pytest.skip("Rendered card API checks require the bundled fonts; these are mandatory in release verification.")
    with TestClient(create_app(tmp_path, session_token="")) as client:
        project = client.post("/api/projects", json={"template": "blank"}).json()
        entry = {"word": "Voyager", "ipa": "ˈvɔɪ.ɪ.dʒə", "partOfSpeech": "noun", "definition": "A person who travels in search of discovery."}
        for format in ("png", "jpg", "pdf"):
            result = client.post(f"/api/projects/{project['id']}/definition-export", json={"entry": entry, "format": format})
            assert result.status_code == 200, result.text
            download = client.get(result.json()["downloadUrl"])
            assert download.status_code == 200
            if format in ("png", "jpg"):
                with Image.open(io.BytesIO(download.content)) as image:
                    assert image.size == (800, 800)
            else:
                assert download.content.startswith(b"%PDF")
        invalid = client.post(f"/api/projects/{project['id']}/definition-export", json={"entry": {"word": ""}, "format": "png"})
        assert invalid.status_code == 422


def test_custom_rules_and_project_ignores_survive_save_reopen(tmp_path):
    from alder.language import analyze
    store = Store(tmp_path / "one")
    p = store.create(template="blank")
    p["settings"]["customRules"] = [{"id": "rule_term", "name": "Project term", "match": "utilise", "replacement": "use", "message": "Prefer this project's short form."}]
    p["settings"]["ignoredRuleIds"] = ["rule_term"]
    saved = store.update(p["id"], p, 1)
    assert saved["settings"]["customRules"][0]["wholeWord"] is True
    archive = store.save_archive(p["id"], str(tmp_path / "rules.alder"))
    restored = Store(tmp_path / "two").open_archive(str(archive))
    assert not analyze("We utilise this term.", restored, ["custom"])["annotations"]
    restored["settings"]["ignoredRuleIds"] = []
    assert analyze("We utilise this term.", restored, ["custom"])["annotations"][0]["suggestion"] == "use"
    restored["settings"]["customRules"][0]["match"] = " "
    with pytest.raises(ValidationError, match="nonempty literal"):
        validate_project(restored)


def test_named_styles_and_null_inheritance_survive_project_archive(tmp_path):
    store = Store(tmp_path / "one")
    p = store.create(template="blank")
    styles = [
        {"id": "body", "name": "Body", "kind": "paragraph", "fontFamily": "Georgia", "fontSize": 12, "lineHeight": 1.6, "spaceAfter": 8},
        {"id": "lead", "name": "Lead", "kind": "paragraph", "basedOn": "body", "fontFamily": None, "fontSize": 18, "spaceAfter": 0, "firstLineIndent": 12},
        {"id": "term", "name": "Term", "kind": "character", "fontSize": None, "color": "#225533"},
    ]
    document = {"type": "doc", "content": [{"type": "paragraph", "attrs": {"styleId": "lead", "align": "right"}, "content": [
        {"type": "text", "text": "A named term", "marks": [{"type": "text_style", "attrs": {"styleId": "term", "fontSize": 14}}]}
    ]}]}
    p["styles"] = styles
    p["clips"][0]["document"] = document
    saved = store.update(p["id"], p, p["revision"])
    assert saved["styles"] == styles
    archive = store.save_archive(saved["id"], str(tmp_path / "styles.alder"))
    reopened = Store(tmp_path / "two").open_archive(str(archive))
    assert reopened["styles"] == styles
    assert reopened["clips"][0]["document"] == document
    assert reopened["clips"][0]["text"] == "A named term"


def test_independent_store_connections_cannot_overwrite_each_other(tmp_path):
    first = Store(tmp_path)
    second = Store(tmp_path)
    p = first.create(template="blank")
    other = second.get(p["id"])
    p["clips"][0]["document"] = text_document("Acknowledged writing from window one.")
    acknowledged = first.update(p["id"], p, 1)
    other["clips"][0]["document"] = text_document("A stale window's conflicting edit.")
    with pytest.raises(ConflictError):
        second.update(other["id"], other, 1)
    assert second.get(p["id"]) == acknowledged


def test_authenticated_desktop_shutdown_is_idempotent_and_keeps_store_available(tmp_path):
    from fastapi.testclient import TestClient
    from alder.app import create_app
    app = create_app(tmp_path / "desktop", session_token="desktop-token")
    with TestClient(app) as client:
        headers = {"Authorization": "Bearer desktop-token"}
        p = client.post("/api/projects", json={"template": "blank"}, headers=headers).json()
        assert client.post("/api/lifecycle/shutdown").status_code == 401
        assert client.post("/api/lifecycle/shutdown?token=desktop-token").status_code == 401
        if app.state.speech:
            app.state.speech.shutdown()  # The already-closed-worker path is safe.
        first = client.post("/api/lifecycle/shutdown", headers=headers)
        assert first.status_code == 200
        assert first.json() == {"status": "stopping", "alreadyStopped": False}
        assert client.post("/api/lifecycle/shutdown", headers=headers).json()["alreadyStopped"] is True
        assert client.get(f"/api/projects/{p['id']}", headers=headers).json()["id"] == p["id"]
    with TestClient(create_app(tmp_path / "development", session_token="")) as client:
        assert client.post("/api/lifecycle/shutdown").status_code == 403


def test_speech_review_api_passes_manual_decision_and_reports_conflicts(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from alder.app import create_app
    app = create_app(tmp_path, session_token="review-token")
    received = []

    def review(job_id, body):
        received.append((job_id, body))
        if job_id == "pending":
            raise ValueError("Only a completed speech take can be reviewed.")
        if job_id == "missing":
            raise KeyError("Speech job does not exist.")
        return {"id": job_id, "manualReview": body}

    monkeypatch.setattr(app.state.speech, "review", review, raising=False)
    with TestClient(app) as client:
        path = "/api/speech/jobs/finished/review"
        decision = {"chunkId": "chunk-one", "accepted": True, "note": "Listened and checked."}
        assert client.post(path, json=decision).status_code == 401
        headers = {"Authorization": "Bearer review-token"}
        response = client.post(path, json=decision, headers=headers)
        assert response.status_code == 200
        assert response.json()["manualReview"] == decision
        assert received == [("finished", decision)]
        assert client.post("/api/speech/jobs/pending/review", json=decision, headers=headers).status_code == 409
        assert client.post("/api/speech/jobs/missing/review", json=decision, headers=headers).status_code == 404
