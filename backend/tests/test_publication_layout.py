import base64
from copy import deepcopy
import io
import pytest
from alder.publication_layout import prepare_layout, validate_rendered_pdf


def test_print_snapshot_is_final_wording_and_never_mutates_review_history():
    from test_document_revisions import project_fixture
    p = project_fixture(); before = deepcopy(p)
    result = prepare_layout(p)
    assert result['sourceRevision'] == p['revision']
    assert result['text'].startswith('New wording.')
    assert 'Old' not in result['text']
    assert result['sourceIdentity'] == prepare_layout(p)['sourceIdentity']
    assert prepare_layout(p, {'reviewView': 'original'})['text'].startswith('Old wording.')
    assert 'assetRoot' not in result['settings']
    assert p == before


def test_print_snapshot_freezes_collected_pixels_and_applies_crop_once():
    from alder.models import create_project
    from PIL import Image
    p = create_project(template='blank'); pixels = io.BytesIO()
    Image.new('RGB', (40, 20), 'blue').save(pixels, 'PNG')
    p['assets'] = [{'id': 'image', 'data': base64.b64encode(pixels.getvalue()).decode('ascii')}]
    node = {'type': 'image', 'attrs': {'assetId': 'image', 'crop': {'left': 50, 'right': 0, 'top': 0, 'bottom': 0}}}
    p['book'] = {'chapters': [{'id': 'chapter', 'title': 'Document', 'text': '', 'document': {'type': 'doc', 'content': [node]}}]}
    before = deepcopy(p)
    result = prepare_layout(p)
    image = next(n for n in result['document']['content'] if n['type'] == 'image')
    assert image['attrs']['crop'] is None
    assert Image.open(io.BytesIO(base64.b64decode(image['attrs']['src'].split(',')[1]))).size == (20, 20)
    assert p == before
    node['attrs']['assetId'] = 'missing'
    with pytest.raises(ValueError, match='image is missing'): prepare_layout(p)


def test_rendered_pdf_must_match_the_captured_page_map():
    from pypdf import PdfWriter
    writer = PdfWriter(); writer.add_blank_page(width=600, height=800)
    output = io.BytesIO(); writer.write(output); data = output.getvalue()
    assert validate_rendered_pdf(data, [{'width': 800, 'height': 800 / .75}])['pages'] == 1
    with pytest.raises(ValueError, match='geometry differs'): validate_rendered_pdf(data, [{'width': 1000, 'height': 1000}])
    with pytest.raises(ValueError, match='page count'): validate_rendered_pdf(data, [{'width': 800, 'height': 1000}] * 2)


def test_print_destinations_keep_editor_identities_without_word_only_attributes():
    from alder.models import create_project
    p = create_project(template='blank')
    p['settings'].update(documentKind='docx', includeTitle=False)
    p['book'] = {'version': 1, 'chapters': [{'id': 'chapter', 'title': 'Document', 'include': True, 'text': ''}]}
    p['book']['chapters'][0]['document'] = {'type': 'doc', 'content': [
        {'type': 'paragraph', 'content': [
            {'type': 'bookmark', 'attrs': {'name': 'Passage', 'blockId': 'passage', 'range': True}},
            {'type': 'text', 'text': 'Target words'},
            {'type': 'bookmark_end', 'attrs': {'targetId': 'passage', 'name': 'Passage'}},
        ]},
        {'type': 'paragraph', 'content': [
            {'type': 'cross_reference', 'attrs': {'targetId': 'passage'}, 'content': [{'type': 'text', 'text': 'Old result'}]},
        ]},
    ]}
    before = deepcopy(p)
    nodes = prepare_layout(p)['document']['content']
    reference = nodes[1]['content'][0]
    assert reference['content'][0]['text'] == 'Target words'
    assert reference['attrs']['targetId'] == 'passage'
    assert 'targetName' not in reference['attrs']
    assert 'targetName' not in nodes[0]['content'][2]['attrs']
    assert p == before


def test_publication_api_preserves_a_frozen_revision_and_verifies_the_renderer_output(tmp_path):
    import json
    from pypdf import PdfWriter
    from fastapi.testclient import TestClient
    from alder.app import create_app
    app = create_app(tmp_path, session_token='layout-test')
    with TestClient(app) as client:
        client.headers['Authorization'] = 'Bearer layout-test'
        p = client.post('/api/projects', json={'template': 'blank'}).json()
        draft = deepcopy(p); draft['name'] = 'Pending local edits'
        route = f"/api/projects/{p['id']}/publication-layout"
        ephemeral = client.post(route, json={'project':draft,'ephemeral':True})
        assert ephemeral.status_code == 200, ephemeral.text
        assert ephemeral.json()['name'] == 'Pending local edits' and 'id' not in ephemeral.json()
        assert client.get(f"/api/projects/{p['id']}").json()['name'] == p['name']
        draft['id'] = 'other_project'
        assert client.post(route, json={'project':draft,'ephemeral':True}).status_code == 422
        snapshot = client.post(f"/api/projects/{p['id']}/publication-layout", json={}).json()
        p['name'] = 'Changed after snapshot'
        assert client.put(f"/api/projects/{p['id']}", json={'project': p, 'expectedRevision': p['revision']}).status_code == 200
        writer = PdfWriter(); writer.add_blank_page(width=600, height=800)
        stream = io.BytesIO(); writer.write(stream)
        route = f"/api/exports/{snapshot['id']}/rendered-pdf"
        files = {'file': ('rendered.pdf', stream.getvalue(), 'application/pdf')}
        metadata = {'sourceIdentity': snapshot['sourceIdentity'], 'pages': [{'width': 800, 'height': 800 / .75}]}
        assert client.post(route, files=files, data={'metadata': '[]'}).status_code == 422
        wrong = {**metadata, 'sourceIdentity': 'stale'}
        assert client.post(route, files=files, data={'metadata': json.dumps(wrong)}).status_code == 422
        result = client.post(route, files=files, data={'metadata': json.dumps(metadata)})
        assert result.status_code == 200, result.text
        result = result.json()
        assert result['sourceRevision'] == snapshot['sourceRevision']
        assert result['name'] == snapshot['name'] != p['name']
        assert result['validation']['layoutEngine'] == 'alder-page-map'
        assert client.get(result['downloadUrl']).content == stream.getvalue()
        assert client.post(route, files=files, data={'metadata': json.dumps(metadata)}).json() == result
