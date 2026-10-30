from pathlib import Path
import pytest
from alder.models import create_project,text_document,validate_project,ValidationError
from alder.publishing import build_export,import_document
LINE_NUMBERS={'start':3,'step':2,'distance':6,'restart':'continuous'}
def fixture():
    p=create_project('Line numbering',template='blank');p['settings'].update(documentKind='docx',includeTitle=False,lineNumbering=dict(LINE_NUMBERS))
    p['styles'].append({'id':'no-lines','name':'No line labels','kind':'paragraph','suppressLineNumbers':True})
    content=text_document('FIRST\nSECOND\nTHIRD')['content']
    content[0]['attrs']={'suppressLineNumbers':True}
    content[1]['attrs']={'styleId':'no-lines'}
    content[2]['attrs']={'styleId':'no-lines','suppressLineNumbers':False}
    content+=[{'type':'section_break','attrs':{'kind':'nextPage','page':{'pageSize':'A5','lineNumbering':{'start':10,'step':5,'distance':8,'restart':'newSection'}}}},*text_document('SECTION')['content'],{'type':'section_break','attrs':{'kind':'nextPage','page':{'pageSize':'A5','lineNumbering':None}}},*text_document('DISABLED')['content']]
    p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':{'type':'doc','content':content}}]}
    return validate_project(p)

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_number_settings_and_suppression_survive_exchange(tmp_path,format):
    result=build_export(fixture(),format,tmp_path);restored=import_document(Path(result['path']))
    assert restored['settings']['lineNumbering']==LINE_NUMBERS
    content=restored['document']['content'];assert [node['attrs'].get('suppressLineNumbers') for node in content[:3]]==[True,True,False]
    sections=[n for n in content if n['type']=='section_break']
    assert sections[0]['attrs']['page']['lineNumbering']['restart']=='newSection'
    assert sections[1]['attrs']['page'].get('lineNumbering') is None

@pytest.mark.parametrize('patch',[{'start':0},{'step':0},{'start':True},{'distance':float('nan')},{'distance':101},{'restart':'random'},{'extra':True}])
def test_invalid_line_settings_rejected(patch):
    p=fixture();p['settings']['lineNumbering'].update(patch)
    with pytest.raises(ValidationError):validate_project(p)

def test_direct_pdf_requires_the_shared_line_layout(tmp_path):
    with pytest.raises(ValueError,match='desktop PDF'):build_export(fixture(),'pdf',tmp_path)
