import copy
from pathlib import Path
from zipfile import ZipFile
import pytest
from lxml import etree as E
from alder.document_shapes import KINDS,properties
from alder.models import create_project,validate_project,validate_document,document_text
from alder.publishing import build_export,import_document

def fixture():
    p=create_project(template='blank');p['name']='Basic shapes';p['settings'].update(documentKind='docx',includeTitle=False)
    p['book']={'version':1,'chapters':[{'id':'main','title':'Shapes','include':True,'document':{'type':'doc','content':[
        {'type':'paragraph','content':[{'type':'text','text':f'SHAPE_{i} before '},{'type':'shape','attrs':properties({'kind':kind,'blockId':'shape_'+kind,'width':160+i*8,'height':80,'strokeWidth':2,'stroke':'#253f60','fill':'none' if kind=='line' else '#c9d8e8','alt':kind+' diagram','decorative':i==4})},{'type':'text','text':' after.'}]} for i,kind in enumerate(KINDS)]}}]}
    return validate_project(p)

def shapes(doc):
    return ([doc] if doc['type']=='shape' else [])+[n for child in doc.get('content',[]) for n in shapes(child)]

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_shapes_retain_editable_geometry_and_description(tmp_path,format):
    p=fixture();before=copy.deepcopy(p);exported=build_export(p,format,tmp_path);restored=import_document(Path(exported['path']))['document'];validate_document(restored)
    assert p==before and document_text(restored)==document_text(p['book']['chapters'][0]['document'])
    originals=shapes(p['book']['chapters'][0]['document']);actual=shapes(restored);assert len(actual)==5
    for a,b in zip(originals,actual):
        for key,value in a['attrs'].items():
            if key=='blockId':continue
            assert b['attrs'][key]==value
    if format=='docx':
        with ZipFile(exported['path']) as z:root=E.fromstring(z.read('word/document.xml'))
        assert len(root.xpath('//*[local-name()="wsp"]'))==5
    if format=='epub':
        with ZipFile(exported['path']) as z:
            opf=next(name for name in z.namelist() if name.endswith('.opf'));assert b'properties="svg"' in z.read(opf)

@pytest.mark.parametrize('change',[{'width':float('nan')},{'height':0},{'strokeWidth':13},{'kind':'script'},{'fill':'url(https://invalid)'},{'alt':2},{'decorative':'false'},{'onclick':'bad'}])
def test_invalid_shapes_fail_without_exporting(change):
    with pytest.raises(ValueError):properties(change)

@pytest.mark.parametrize('format',['odt','rtf','pdf','azw3'])
def test_unqualified_formats_do_not_drop_shapes(tmp_path,format):
    with pytest.raises(ValueError,match='editable shapes'):build_export(fixture(),format,tmp_path)
    assert not list(tmp_path.glob('*.'+format))

def test_word_shape_with_custom_geometry_is_not_silently_discarded(tmp_path):
    source=Path(build_export(fixture(),'docx',tmp_path)['path'])
    with ZipFile(source) as z:parts={name:z.read(name) for name in z.namelist()}
    root=E.fromstring(parts['word/document.xml']);root.xpath('//*[local-name()="prstGeom"]')[0].set('prst','heart');parts['word/document.xml']=E.tostring(root)
    broken=tmp_path/'custom.docx'
    with ZipFile(broken,'w') as z:
        for name,data in parts.items():z.writestr(name,data)
    with pytest.raises(ValueError,match='unsupported geometry'):import_document(broken)


@pytest.mark.parametrize('change',[{'width':2000},{'height':2000}])
def test_oversized_word_shapes_refuse_export(tmp_path,change):
    p=fixture();shapes(p['book']['chapters'][0]['document'])[0]['attrs'].update(change)
    with pytest.raises(ValueError,match='too large'):build_export(p,'docx',tmp_path)


def test_line_is_horizontal_within_its_inline_frame(tmp_path):
    from docx.oxml.ns import qn
    source=Path(build_export(fixture(),'docx',tmp_path)['path'])
    with ZipFile(source) as z:root=E.fromstring(z.read('word/document.xml'))
    path=root.xpath('//*[local-name()="custGeom"]/*[local-name()="pathLst"]/*[local-name()="path"]')[0]
    assert [step.find(qn('a:pt')).get('y') for step in path]==['50000','50000']
    assert [step.find(qn('a:pt')).get('x') for step in path]==['0','100000']
