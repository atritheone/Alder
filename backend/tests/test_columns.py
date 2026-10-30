from pathlib import Path
import pytest
from docx import Document
from docx.oxml.ns import qn
from pypdf import PdfReader
from alder.models import create_project,validate_project
from alder.publishing import build_export,import_document
from alder.columns import validate_columns

def fixture():
    p=create_project(template='blank')
    p['settings'].update(documentKind='docx',includeTitle=False,pageSize='A5',marginMm=15,columns={'count':2,'gapMm':8,'separator':True})
    para=lambda text:{'type':'paragraph','content':[{'type':'text','text':text}]}
    p['book']={'version':1,'chapters':[{'id':'main','title':'Document','include':True,'document':{'type':'doc','content':[para('LEFT COLUMN'),{'type':'column_break'},para('RIGHT COLUMN'),{'type':'page_break'},para('NEXT PAGE'),{'type':'section_break','attrs':{'kind':'nextPage','page':{'pageSize':'A4','marginMm':20,'columns':{'count':3,'gapMm':6,'separator':False}}}},para('THREE COLUMN SECTION'),{'type':'column_break'},para('SECOND OF THREE')]}}]}
    return validate_project(p)

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_columns_and_explicit_breaks_roundtrip(tmp_path,format):
    result=build_export(fixture(),format,tmp_path)
    restored=import_document(Path(result['path']))
    columns=restored['settings']['columns'];assert columns['count']==2 and columns['separator']
    assert columns['gapMm']==pytest.approx(8,abs=.01)
    nodes=restored['document']['content'];assert sum(n['type']=='column_break' for n in nodes)==2
    assert sum(n['type']=='page_break' for n in nodes)==1
    section=next(n for n in nodes if n['type']=='section_break')
    assert section['attrs']['page']['columns']['count']==3
    if format=='docx':
        word=Document(result['path']);assert len(word.sections)==2
        assert word.sections[0]._sectPr.find(qn('w:cols')).get(qn('w:num'))=='2'

def test_direct_pdf_columns_and_page_breaks(tmp_path):
    result=build_export(fixture(),'pdf',tmp_path)
    pages=PdfReader(result['path']).pages;assert len(pages)==3
    assert 'LEFT COLUMN' in pages[0].extract_text() and 'RIGHT COLUMN' in pages[0].extract_text()
    assert 'NEXT PAGE' in pages[1].extract_text()
    assert 'THREE COLUMN SECTION' in pages[2].extract_text() and 'SECOND OF THREE' in pages[2].extract_text()
    positions={}
    def visitor(text,cm,tm,font,size):
        if text.strip() in ('LEFT COLUMN','RIGHT COLUMN'):positions[text.strip()]=cm[4]+tm[4]
    pages[0].extract_text(visitor_text=visitor)
    assert positions['RIGHT COLUMN']>positions['LEFT COLUMN']+100

@pytest.mark.parametrize('value',[{'count':0,'gapMm':8},{'count':True,'gapMm':8},{'count':2,'gapMm':float('nan')},{'count':2,'gapMm':4,'separator':1}])
def test_columns_reject_invalid_settings(value):
    with pytest.raises(ValueError):validate_columns(value)
