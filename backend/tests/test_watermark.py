from pathlib import Path
import pytest
from alder.models import create_project,text_document,validate_project,ValidationError,document_text
from alder.publishing import build_export,import_document

WATERMARK={'text':'DRAFT','fontFamily':'Cambria','color':'#d0d0d0','widthMm':90,'heightMm':18,'angle':315}
def fixture():
    p=create_project('Watermark fixture',template='blank')
    p['settings'].update(documentKind='docx',includeTitle=False,footer=True,pageSize='A5',watermark=dict(WATERMARK),runningMatter={'header':{'default':text_document('RUNNING DEFAULT'),'first':text_document('RUNNING FIRST'),'even':text_document('RUNNING EVEN')},'differentFirst':True,'differentEven':True,'headerDistanceMm':10})
    content=[]
    for index in range(3):
        if index:content.append({'type':'section_break','attrs':{'kind':'nextPage','page':{'pageSize':'A5','watermark':{**WATERMARK,'text':'PRIVATE','angle':0,'widthMm':70,'heightMm':10} if index==1 else None}}})
        content.extend([*text_document(f'WATERMARK{index*2+1} Ordinary authored text.')['content'],{'type':'page_break'},*text_document(f'WATERMARK{index*2+2} Second sheet.')['content']])
    p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':{'type':'doc','content':content}}]}
    return validate_project(p)

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_watermark_is_separate_from_authored_text_and_round_trips(tmp_path,format):
    p=fixture();result=build_export(p,format,tmp_path);restored=import_document(Path(result['path']))
    assert restored['settings']['watermark']==WATERMARK
    original=p['book']['chapters'][0]['document'];assert document_text(restored['document'])==document_text(original)
    assert [n['attrs']['page'].get('watermark') for n in restored['document']['content'] if n['type']=='section_break']==[n['attrs']['page'].get('watermark') for n in original['content'] if n['type']=='section_break']
    if format=='docx':
        assert 'RUNNING DEFAULT' in document_text(restored['settings']['runningMatter']['header']['default'])
        assert 'RUNNING FIRST' in document_text(restored['settings']['runningMatter']['header']['first'])
        assert 'RUNNING EVEN' in document_text(restored['settings']['runningMatter']['header']['even'])
    else:assert any('watermark' in warning for warning in result['warnings'])

@pytest.mark.parametrize('patch',[{'text':''},{'text':'x\ny'},{'text':'x'*121},{'angle':360},{'angle':True},{'angle':1.5},{'widthMm':0},{'heightMm':float('nan')},{'fontFamily':'x;foo'},{'color':'red'},{'unknown':1}])
def test_watermark_validation(patch):
    p=fixture();p['settings']['watermark'].update(patch)
    with pytest.raises(ValidationError):validate_project(p)

def test_unsupported_native_watermark_reports_conversion(tmp_path):
    from docx import Document
    from alder.watermark import _shapes
    result=build_export(fixture(),'docx',tmp_path);d=Document(result['path'])
    shape=_shapes(d.sections[0].header)[0];shape.set('style',shape.get('style').replace('mso-position-horizontal:center','mso-position-horizontal:left'));d.save(result['path'])
    restored=import_document(Path(result['path']))
    assert restored['settings'].get('watermark') is None
    assert any('watermark' in warning for warning in restored['warnings'])
    assert 'WATERMARK1' in document_text(restored['document'])

def test_headless_pdf_does_not_silently_omit_watermark(tmp_path):
    with pytest.raises(ValueError,match='desktop PDF'):build_export(fixture(),'pdf',tmp_path)

def test_inspecting_missing_watermarks_does_not_create_header_stories():
    from docx import Document
    from alder.watermark import read_watermark,write_watermarks
    d=Document();before=d._element.xml
    assert read_watermark(d.sections[0],[]) is None
    write_watermarks(d,[None])
    assert d._element.xml==before
    assert d.sections[0].header.is_linked_to_previous

@pytest.mark.parametrize('family',['font"quote',r'font\escape'])
def test_watermark_fonts_cannot_change_when_serialised_as_vml(family):
    p=fixture();p['settings']['watermark']['fontFamily']=family
    with pytest.raises(ValidationError):validate_project(p)
