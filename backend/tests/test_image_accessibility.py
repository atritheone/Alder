import base64,io
from pathlib import Path
import pytest
from PIL import Image
from docx import Document
from alder.models import create_project,validate_project,ValidationError
from alder.publishing import build_export,import_document
from alder.image_accessibility import read_decorative


def fixture():
    p=create_project(template='blank');p['settings'].update(documentKind='docx',includeTitle=False,footer=False)
    data=io.BytesIO();Image.new('RGB',(40,20),'navy').save(data,format='PNG')
    p['book']={'version':1,'chapters':[{'id':'decorative','title':'Document','text':'','include':True,'document':{'type':'doc','content':[{'type':'image','attrs':{'src':'data:image/png;base64,'+base64.b64encode(data.getvalue()).decode(),'alt':'Retained description','title':'Retained title','decorative':True}}]}}]}
    return p


@pytest.mark.parametrize('format',['html','docx','epub'])
def test_decorative_status_and_authored_description_roundtrip(tmp_path,format):
    p=fixture();result=build_export(p,format,tmp_path,{'validate':False})
    reopened=import_document(Path(result['path']))
    images=[]
    def walk(node):
        if node['type']=='image': images.append(node)
        for child in node.get('content',[]):walk(child)
    walk(reopened['document'])
    assert images[0]['attrs']['decorative'] is True
    assert images[0]['attrs']['alt']=='Retained description'
    assert images[0]['attrs']['title']=='Retained title'
    if format=='docx': assert read_decorative(Document(result['path']).inline_shapes[0]._inline.docPr)
    if format=='html':
        from bs4 import BeautifulSoup
        image=BeautifulSoup(Path(result['path']).read_text(encoding='utf-8'),'html.parser').find('img')
        assert image['alt']=='' and image['role']=='presentation' and image['title']==''


def test_invalid_decorative_status_rejected():
    p=fixture();attrs=p['book']['chapters'][0]['document']['content'][0]['attrs'];attrs['src']='';attrs['decorative']='yes'
    with pytest.raises(ValidationError):validate_project(p)
