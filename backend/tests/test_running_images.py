import base64
import copy
import io
from pathlib import Path
import pytest
from PIL import Image,ImageDraw
from pypdf import PdfReader
from alder.models import create_project,validate_project,ValidationError
from alder.publishing import build_export,import_document
from alder.publication_layout import prepare_layout

def fixture():
    image=Image.new('RGB',(120,60),'red');ImageDraw.Draw(image).rectangle((30,0,89,59),fill='#23405e')
    buffer=io.BytesIO();image.save(buffer,format='PNG')
    p=create_project(template='blank');p['settings'].update(documentKind='docx',includeTitle=False,footer=False,marginTopMm=55)
    p['assets']=[{'id':'logo','name':'Logo.png','mime':'image/png','data':base64.b64encode(buffer.getvalue()).decode()}]
    picture={'type':'inline_image','attrs':{'assetId':'logo','src':'asset:logo','width':64,'crop':{'left':25,'right':25,'top':0,'bottom':0},'alt':'Company logo','blockId':'logo-picture'}}
    paragraph=lambda text:{'type':'paragraph','content':[{'type':'text','text':text}]}
    p['settings']['runningMatter']={'header':{'default':{'type':'doc','content':[{'type':'table','content':[{'type':'table_row','content':[{'type':'table_cell','content':[{'type':'paragraph','content':[picture]}]},{'type':'table_cell','content':[paragraph('COMPANY')]}]}]}]}},'footer':{'default':None}}
    p['book']={'version':1,'chapters':[{'id':'main','title':'Document','include':True,'document':{'type':'doc','content':[paragraph('BODY ONE'),{'type':'page_break'},paragraph('BODY TWO')]}}]}
    return validate_project(p)

def images(node):
    if node['type'] in ('image','inline_image'):yield node
    for child in node.get('content',[]):yield from images(child)

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_running_images_roundtrip_with_original_crop_and_alt(tmp_path,format):
    p=fixture();before=copy.deepcopy(p)
    result=build_export(p,format,tmp_path)
    assert p==before
    restored=import_document(Path(result['path']))
    picture=next(images(restored['settings']['runningMatter']['header']['default']))
    assert picture['attrs']['alt']=='Company logo'
    assert picture['attrs']['width']==pytest.approx(64,abs=.001)
    assert picture['attrs']['crop']=={'left':25,'right':25,'top':0,'bottom':0}
    asset=next(a for a in restored['assets'] if a['id']==picture['attrs']['assetId'])
    assert Image.open(io.BytesIO(base64.b64decode(asset['data']))).size==(120,60)
    assert not list(images(restored['document']))
    assert not any('Complex DOCX' in w for w in restored['warnings'])

def test_running_images_are_collected_for_desktop_and_direct_pdf(tmp_path):
    p=fixture();prepared=prepare_layout(p)
    picture=next(images(prepared['settings']['runningMatter']['header']['default']))
    assert picture['attrs']['src'].startswith('data:image/')
    assert picture['attrs']['crop'] is None
    assert Image.open(io.BytesIO(base64.b64decode(picture['attrs']['src'].split(',')[1]))).size==(60,60)
    result=build_export(p,'pdf',tmp_path)
    pdf=PdfReader(result['path']);assert len(pdf.pages)==2
    for page in pdf.pages:
        assert len(page.images)==1
        assert page.images[0].image.size==(60,60)
        assert 'COMPANY' in page.extract_text()

def test_running_images_verify_assets_in_defaults_and_sections():
    p=fixture();p['assets']=[]
    with pytest.raises(ValidationError,match='missing project asset'):validate_project(p)
    p=fixture();matter=p['settings'].pop('runningMatter')
    p['book']['chapters'][0]['document']['content'].insert(1,{'type':'section_break','attrs':{'kind':'nextPage','page':{},'runningMatter':matter}})
    p['assets']=[]
    with pytest.raises(ValidationError,match='missing project asset'):validate_project(p)
