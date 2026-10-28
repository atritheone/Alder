from copy import deepcopy
import pytest
from alder.models import create_project, validate_project, ValidationError, text_document
from alder.store import Store


def test_migration_is_deterministic_and_does_not_change_authored_text():
    old = create_project(template="blank")
    old["schemaVersion"] = 1
    old["clips"][0]["document"] = text_document("Alpha\nBeta")
    original = deepcopy(old)
    first = validate_project(old)
    assert first == validate_project(old) == validate_project(first)
    assert old == original
    assert first["schemaVersion"] == 2
    nodes = first["clips"][0]["document"]["content"]
    assert nodes[0]["attrs"]["blockId"] != nodes[1]["attrs"]["blockId"]
    assert first["clips"][0]["text"] == "Alpha\nBeta"


def test_moving_and_copying_blocks_preserves_original_identities():
    project = create_project(template="blank")
    project["clips"][0]["document"] = text_document("Alpha\nBeta")
    project = validate_project(project)
    nodes = project["clips"][0]["document"]["content"]
    first, second = nodes
    identity = first["attrs"]["blockId"]
    project["clips"][0]["document"]["content"] = [text_document("New")["content"][0], second, first, deepcopy(first)]
    result = validate_project(project)["clips"][0]["document"]["content"]
    assert result[2]["attrs"]["blockId"] == identity
    assert len({node["attrs"]["blockId"] for node in result}) == 4
    with pytest.raises(ValidationError, match="schema"):
        validate_project({**project, "schemaVersion": 99})


def test_recovering_version_creates_independent_copy(tmp_path):
    store = Store(tmp_path)
    project = store.create(template="blank")
    original = deepcopy(project)
    project["clips"][0]["document"] = text_document("Latest edit")
    saved = store.update(project["id"], project, project["revision"])
    versions = store.versions(project["id"])
    assert versions[0]["current"] and not versions[1]["current"]
    recovered = store.recover_version(project["id"], 0)
    assert recovered["id"] != project["id"]
    assert recovered["clips"] == original["clips"]
    assert store.get(project["id"]) == saved
    with pytest.raises(KeyError):
        store.recover_version(project["id"], 99999)


def test_recovery_collects_snapshot_images_and_missing_assets_leave_no_partial_project(tmp_path):
    store = Store(tmp_path)
    project = store.create(template='blank')
    content = b'original image fixture bytes'
    asset = store.store_asset(project['id'], 'figure.png', content, 'image/png')
    project['assets'] = [asset]
    project['clips'][0]['document'] = {'type': 'doc', 'content': [{'type': 'image', 'attrs': {'assetId': asset['id']}}]}
    project = store.update(project['id'], project, project['revision'])
    recovered = store.recover_version(project['id'], 1)
    target, _ = store.asset_path(recovered['id'], asset['id'])
    assert target.read_bytes() == content
    assert target.parent == store.asset_dir(recovered['id'])
    assert recovered['clips'][0]['document']['content'][0]['attrs']['src'].startswith(f"/api/projects/{recovered['id']}/")
    original, _ = store.asset_path(project['id'], asset['id'])
    original.unlink()
    assert target.read_bytes() == content
    before = store.list_projects()
    with pytest.raises(ValidationError, match='asset is missing'):
        store.recover_version(project['id'], 1)
    assert store.list_projects() == before
