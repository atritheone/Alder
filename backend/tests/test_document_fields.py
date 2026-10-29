from copy import deepcopy
from datetime import date
from pathlib import Path
from zipfile import ZipFile
import pytest
from alder.models import create_project,validate_project,document_text,ValidationError
from alder.document_fields import refresh_fields,read_field
from alder.publishing import build_export,import_document

def fixture():
    p=create_project(template='blank');p['name']='Field manuscript';p['settings'].update(documentKind='docx',includeTitle=False,author='A. Writer',subject='Test subject')
    p['book']={'version':1,'chapters':[{'id':'chapter','title':'Document','include':True,'document':{'type':'doc','content':[
        {'type':'paragraph','content':[{'type':'document_field','attrs':{'fieldKind':kind},'marks':[{'type':'strong'}],'content':[{'type':'text','text':'Old result'}]}]} for kind in ('title','author','subject','date')
    ]}}]}
    return validate_project(p)

def walk(node):
    yield node
    for child in node.get('content',[]):yield from walk(child)

@pytest.mark.parametrize('format',['html','epub','docx'])
def test_document_fields_and_metadata_survive_exchange(tmp_path,format):
    p=fixture();before=deepcopy(p);result=build_export(p,format,tmp_path)
    assert p==before
    opened=import_document(Path(result['path']))
    fields=[n for n in walk(opened['document']) if n['type']=='document_field']
    assert [n['attrs']['fieldKind'] for n in fields]==['title','author','subject','date']
    assert [document_text(n) for n in fields]==['Field manuscript','A. Writer','Test subject',date.today().isoformat()]
    assert all({'type':'strong'} in n.get('marks',[]) for n in fields)
    assert opened['title']=='Field manuscript'
    assert opened['settings']['author']=='A. Writer' and opened['settings']['subject']=='Test subject'
    if format=='docx':
        assert all({'type':'strong'} in n.get('marks',[]) for n in fields)
        with ZipFile(result['path']) as archive:
            xml=archive.read('word/document.xml').decode()
            assert xml.count(' DOCPROPERTY ')==3 and ' DATE ' in xml

@pytest.mark.parametrize('format',['txt','md','pdf'])
def test_plain_outputs_use_refreshed_document_fields(tmp_path,format):
    result=build_export(fixture(),format,tmp_path)
    if format=='pdf':
        from pypdf import PdfReader
        text='\n'.join(page.extract_text() for page in PdfReader(result['path']).pages)
    else: text=Path(result['path']).read_text(encoding='utf-8')
    assert 'Old result' not in text
    for value in ('Field manuscript','A. Writer','Test subject',date.today().isoformat()):assert value in text

def test_missing_properties_are_explicit_and_refresh_is_local():
    p=fixture();p['settings']['author']='';document=p['book']['chapters'][0]['document'];warnings=[]
    refresh_fields([document],p,warnings,date(2020,2,29))
    assert document_text(document['content'][1])=='[Author not set]'
    assert document['content'][1]['content'][0]['attrs']['unresolved'] is True
    assert document_text(document['content'][3])=='2020-02-29'
    assert len(warnings)==1
    assert read_field('DOCPROPERTY Title \\* CHARFORMAT')=='title'
    assert read_field('DOCPROPERTY Filename') is None
    assert read_field('DATE \\@ "dd MMMM yyyy"') is None
    assert read_field('INCLUDETEXT "https://example.invalid/file"') is None

def test_invalid_document_fields_are_rejected():
    p=fixture();p['book']['chapters'][0]['document']['content'][0]['content'][0]['attrs']['fieldKind']='filename'
    with pytest.raises(ValidationError):validate_project(p)


@pytest.mark.parametrize('format',['html','epub','docx'])
def test_page_fields_keep_cached_values_and_native_field_types(tmp_path,format):
    p=fixture();doc=p['book']['chapters'][0]['document']
    doc['content']=[{'type':'paragraph','content':[{'type':'document_field','attrs':{'fieldKind':kind,'blockId':kind},'content':[{'type':'text','text':text}]}]} for kind,text in [('page','iv'),('pageCount','20')]]
    validate_project(p)
    result=build_export(p,format,tmp_path)
    fields=[n for n in walk(import_document(Path(result['path']))['document']) if n['type']=='document_field']
    assert [(n['attrs']['fieldKind'],document_text(n)) for n in fields]==[('page','iv'),('pageCount','20')]
    assert read_field('PAGE \\* CHARFORMAT')=='page'
    assert read_field('NUMPAGES')=='pageCount'
    assert read_field('PAGE \\* ROMAN') is None  # An explicit display override is not section numbering.
    if format=='docx':
        with ZipFile(result['path']) as archive:
            xml=archive.read('word/document.xml').decode()
            assert ' PAGE ' in xml and ' NUMPAGES ' in xml
