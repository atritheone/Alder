from pathlib import Path
import pytest
from alder.models import create_project,text_document,validate_project,ValidationError,document_text
from alder.publishing import build_export,import_document


def fixture():
    p=create_project('Page borders',template='blank')
    border={'style':'single','width':1.5,'color':'#273e5b','distance':24,'display':'allPages'}
    p['settings'].update(documentKind='docx',includeTitle=False,footer=True,pageSize='A5',pageBorder=border)
    content=[]
    for index,(style,display) in enumerate((('single','allPages'),('double','firstPage'),('dashed','notFirstPage'),('dotted','allPages'),(None,'allPages'))):
        if index:content.append({'type':'section_break','attrs':{'kind':'nextPage','page':{'pageSize':'A5','pageBorder':{**border,'style':style,'display':display} if style else None}}})
        content.extend([*text_document(f'BORDER{index*2+1} Page decoration.')['content'],{'type':'page_break'},*text_document(f'BORDER{index*2+2} Second sheet.')['content']])
    p['book']={'version':1,'chapters':[{'id':'main','title':'Document','include':True,'document':{'type':'doc','content':content}}]}
    return validate_project(p)


@pytest.mark.parametrize('format',['docx','html','epub'])
def test_page_borders_round_trip_and_explicitly_disable_for_sections(tmp_path,format):
    p=fixture();result=build_export(p,format,tmp_path);imported=import_document(Path(result['path']))
    assert imported['settings']['pageBorder']==p['settings']['pageBorder']
    expected=[n['attrs']['page'].get('pageBorder') for n in p['book']['chapters'][0]['document']['content'] if n['type']=='section_break']
    assert [n['attrs']['page'].get('pageBorder') for n in imported['document']['content'] if n['type']=='section_break']==expected
    assert document_text(imported['document'])==document_text(p['book']['chapters'][0]['document'])
    if format!='docx':assert any('page-border' in warning for warning in result['warnings'])


@pytest.mark.parametrize('patch',[{'width':0},{'width':.3},{'width':float('nan')},{'width':True},{'distance':32},{'distance':1.5},{'color':'red'},{'style':'art'},{'display':'sometimes'},{'extra':1}])
def test_invalid_border_rejected(patch):
    p=fixture();p['settings']['pageBorder'].update(patch)
    with pytest.raises(ValidationError):validate_project(p)


def test_direct_pdf_borders_preserve_pages_and_text(tmp_path):
    from pypdf import PdfReader
    result=build_export(fixture(),'pdf',tmp_path);pdf=PdfReader(result['path'])
    assert len(pdf.pages)==10
    for index,page in enumerate(pdf.pages):
        assert f'BORDER{index+1} ' in page.extract_text()
        # Border rectangles exist on first/all/except-first choices only.
        count=sum(operation==b're' for _,operation in page.get_contents().operations)
        assert count==[1,1,2,0,0,1,1,1,0,0][index]


def test_unsupported_word_border_reports_conversion(tmp_path):
    from docx import Document
    from docx.oxml.ns import qn
    result=build_export(fixture(),'docx',tmp_path);d=Document(result['path'])
    d.sections[0]._sectPr.find(qn('w:pgBorders')).set(qn('w:offsetFrom'),'text');d.save(result['path'])
    imported=import_document(Path(result['path']))
    assert any('page borders' in warning for warning in imported['warnings'])
    assert 'BORDER1' in document_text(imported['document'])
