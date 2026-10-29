import base64
import copy
import io
import json
from pathlib import Path

import pytest
from PIL import Image, ImageDraw
from docx import Document
from docx.oxml.ns import qn
from pypdf import PdfReader

from alder.image_crop import validate_crop, cached_crop
from alder.models import create_project, validate_project, ValidationError
from alder.publishing import build_export, import_document

CROP = {'left':25, 'top':0, 'right':25, 'bottom':0}


def pixels():
    image = Image.new('RGB', (120, 60), 'red')
    ImageDraw.Draw(image).rectangle((30,0,89,59), fill='#23405e')
    result = io.BytesIO()
    image.save(result, format='PNG')
    return result.getvalue()


def fixture():
    project = create_project(template='blank')
    project['settings'].update(documentKind='docx',includeTitle=False,footer=False)
    project['assets'] = [{'id':'picture','name':'Crop.png','mime':'image/png','data':base64.b64encode(pixels()).decode()}]
    picture = {'type':'inline_image','attrs':{'src':'/api/projects/'+project['id']+'/assets/picture','assetId':'picture','crop':CROP,'width':96,'alt':'Crop fixture'}}
    project['book'] = {'version':1,'chapters':[{'id':'crop','title':'Document','include':True,'text':'Before  after.','document':{'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':'Before '},picture,{'type':'text','text':' after.'}]}]}}]}
    return project


@pytest.mark.parametrize('format',['html','epub','docx'])
def test_crop_roundtrip_keeps_the_complete_original_and_placement(tmp_path,format):
    project = fixture()
    before = copy.deepcopy(project)
    exported = build_export(project,format,tmp_path,{'validate':False})
    assert project == before
    imported = import_document(Path(exported['path']))
    image = imported['document']['content'][0]['content'][1]
    assert image['type'] == 'inline_image'
    assert image['attrs']['crop'] == CROP
    assert image['attrs']['width'] == pytest.approx(96,abs=.001)
    asset = next(a for a in imported['assets'] if a['id']==image['attrs']['assetId'])
    with Image.open(io.BytesIO(base64.b64decode(asset['data']))) as original:
        assert original.size == (120,60)
        assert original.getpixel((0,0)) == (255,0,0)
    if format == 'docx':
        shape=Document(exported['path']).inline_shapes[0]
        assert abs(shape.width-shape.height) < 2
        assert next(shape._inline.iter(qn('a:srcRect'))).get('l') == '25000'
    elif format == 'html':
        from bs4 import BeautifulSoup
        picture=BeautifulSoup(Path(exported['path']).read_text(encoding='utf-8'),'html.parser').find('img')
        with Image.open(io.BytesIO(base64.b64decode(picture['src'].split(',')[1]))) as display:
            assert display.size == (60,60)
            assert display.getpixel((0,0)) == (35,64,94)


def test_pdf_uses_the_cropped_pixels(tmp_path):
    exported = build_export(fixture(),'pdf',tmp_path)
    doc = PdfReader(exported['path'])
    image = doc.pages[0].images[0].image
    assert image.size == (60,60)
    assert image.getpixel((0,0))[:3] == (35,64,94)


def test_cache_never_changes_the_source_and_reuses_unchanged_crops(tmp_path):
    source = tmp_path/'original.png'
    source.write_bytes(pixels())
    cache = tmp_path/'cache'
    result = cached_crop(source,CROP,cache)
    before=result.stat().st_mtime_ns
    assert Image.open(result).size == (60,60)
    assert cached_crop(source,CROP,cache).stat().st_mtime_ns == before
    assert source.read_bytes() == pixels()
    assert cached_crop(source,None,cache) == source


@pytest.mark.parametrize('crop',[{'left':-1},{'top':float('nan')},{'right':True},{'top':50,'bottom':50},[],{'left':100},{'unexpected':10}])
def test_invalid_crop_is_rejected_without_mutation(crop):
    with pytest.raises(ValueError): validate_crop(crop)
    project=fixture();project['book']['chapters'][0]['document']['content'][0]['content'][1]['attrs']['crop']=crop
    with pytest.raises(ValidationError): validate_project(project)


def test_crop_route_authentication_validation_and_original_asset(tmp_path):
    from fastapi.testclient import TestClient
    from alder.app import create_app
    app=create_app(tmp_path,session_token='crop-test')
    project=app.state.store.create('Crop','blank')
    asset=app.state.store.store_asset(project['id'],'picture.png',pixels(),'image/png')
    project['assets']=[asset]
    app.state.store.update(project['id'],project,project['revision'])
    url=f'/api/projects/{project["id"]}/assets/{asset["id"]}'
    with TestClient(app) as client:
        assert client.get(url+'?crop=25,0,25,0').status_code==401
        client.headers['Authorization']='Bearer crop-test'
        response=client.get(url+'?crop=25,0,25,0')
        assert response.status_code==200
        assert Image.open(io.BytesIO(response.content)).size==(60,60)
        assert client.get(url+'?crop=90,0,90,0').status_code==422
        assert client.get(url).content==pixels()
