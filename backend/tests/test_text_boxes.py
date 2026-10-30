import copy
from pathlib import Path
import pytest
from docx import Document
from docx.oxml.ns import qn
from alder.models import create_project, validate_project, validate_document, document_text, ValidationError
from alder.publishing import build_export, import_document


def fixture(side='none'):
    project=create_project(template='blank')
    project['settings'].update(documentKind='docx',includeTitle=False)
    box={'type':'text_box','attrs':{'blockId':'box_one','width':180,'minHeight':60,'wrap':side,'wrapGap':16},'content':[
        {'type':'text','text':'BOX_ALPHA','marks':[{'type':'strong'}]}, {'type':'hard_break'},
        {'type':'text','text':'BOX_OMEGA','marks':[{'type':'em'},{'type':'link','attrs':{'href':'https://example.com/'}}]}]}
    project['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':{'type':'doc','content':[
        {'type':'paragraph','content':[box,{'type':'text','text':' Following prose.'}]}]}}]}
    return validate_project(project)


@pytest.mark.parametrize('side',['none','left','right'])
@pytest.mark.parametrize('format',['docx','html','epub'])
def test_text_boxes_preserve_wording_formatting_and_geometry(tmp_path,side,format):
    project=fixture(side);before=copy.deepcopy(project)
    result=build_export(project,format,tmp_path,{'validate':False,'measuredTextBoxes':{'box_one':{'width':180,'height':60}}})
    restored=import_document(Path(result['path']))
    box=restored['document']['content'][0]['content'][0]
    assert box['type']=='text_box',restored['warnings']
    assert document_text(box).strip()=='BOX_ALPHA\nBOX_OMEGA'
    assert box['attrs']['wrap']==side
    assert box['attrs']['width']==pytest.approx(180)
    assert box['attrs']['wrapGap']==pytest.approx(16 if side!='none' or format!='docx' else 12)
    assert 'strong' in [m['type'] for m in box['content'][0]['marks']]
    assert 'link' in [m['type'] for m in box['content'][-1]['marks']]
    assert project==before
    if format=='docx':
        word=Document(result['path'])
        assert len(list(word.element.iter(qn('w:txbxContent'))))==1


def test_unsupported_word_position_converts_box_to_formatted_text(tmp_path):
    result=build_export(fixture('left'),'docx',tmp_path,{'measuredTextBoxes':{'box_one':{'width':180,'height':60}}})
    word=Document(result['path'])
    next(word.element.iter(qn('wp:positionV'))).find(qn('wp:posOffset')).text='9525'
    word.save(result['path'])
    restored=import_document(Path(result['path']))
    assert 'BOX_ALPHA\nBOX_OMEGA' in document_text(restored['document'])
    assert any('unsupported positioning' in w for w in restored['warnings'])


def test_unmeasured_word_and_headless_pdf_refuse_silent_clipping(tmp_path):
    for format in ('docx','pdf'):
        with pytest.raises(ValueError,match='desktop'):
            build_export(fixture(),format,tmp_path)


@pytest.mark.parametrize('patch',[{'width':0},{'padding':200},{'fill':'url(evil)'},{'fontFamily':"Cambria';display:none"},{'wrap':'behind'},{'minHeight':float('nan')}])
def test_invalid_box_properties_are_rejected(patch):
    doc=fixture()['book']['chapters'][0]['document']
    doc['content'][0]['content'][0]['attrs'].update(patch)
    with pytest.raises(ValidationError):validate_document(doc)
