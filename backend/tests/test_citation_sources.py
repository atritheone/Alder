from copy import deepcopy
from pathlib import Path
import pytest
from alder.citation_sources import CitationSources, validate_source
from alder.store import Store, ConflictError
from alder.models import create_project, validate_project, document_text
from alder.publishing import build_export, import_document
from alder.document_comments import walk

def source():
    return {'id':'source_'+'a'*32,'type':'book','title':'A study of examples','author':[{'family':'Smith','given':'Alex'}],'issued':{'date-parts':[[2020,3,2]]},'publisher':'Example Press','DOI':'10.1234/example'}
def fixture():
    project=create_project(template='blank');project['settings'].update(documentKind='docx',includeTitle=False,citationStyle='apa')
    project['book']={'version':1,'chapters':[{'id':'main','title':'Document','include':True,'document':{'type':'doc','content':[
        {'type':'paragraph','content':[{'type':'text','text':'FIRST CITATION '},{'type':'citation','attrs':{'items':[{'source':source(),'locator':'12–14','label':'page'}],'renderedStyle':'apa'},'content':[{'type':'text','text':'(Smith, 2020, pp. 12–14)'}]},{'type':'text','text':' END BODY.'}]},
        {'type':'bibliography','attrs':{'title':'References','entryStyle':None,'entryIds':[[source()['id']]],'renderedStyle':'apa'},'content':[{'type':'paragraph','content':[{'type':'text','text':'References'}]},{'type':'paragraph','content':[{'type':'text','text':'Smith, A. (2020). '},{'type':'text','text':'A study of examples.','marks':[{'type':'em'}]},{'type':'text','text':' Example Press.'}]}]}
    ]}}]};return validate_project(project)

def test_local_library_conflicts_import_deduplication_and_removal_leave_documents_intact(tmp_path):
    library=CitationSources(Store(tmp_path));record=library.save(source());assert record['revision']==1
    with pytest.raises(ConflictError):library.save(source(),0)
    changed={**source(),'title':'Edited'};updated=library.save(changed,1);assert updated['revision']==2
    imported=library.import_items([source(),{**source(),'id':'external'}]);assert imported['added']==1 and imported['duplicates']==1
    removed=library.remove(changed['id'],2);assert len(library.list())==1
    restored=library.save(removed['source'],removed['revision']);assert restored['revision']==4
    assert len(library.list())==2
    before=deepcopy(library.list())
    with pytest.raises(ValueError):library.import_items([source(),{'id':'x','type':'invalid'}])
    assert library.list()==before

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_citations_and_source_metadata_survive_portable_exchange(tmp_path,format):
    result=build_export(fixture(),format,tmp_path);restored=import_document(Path(result['path']))
    citations=[node for node in walk(restored['document']) if node['type']=='citation'];assert len(citations)==1
    assert citations[0]['attrs']['items'][0]['source']==source();assert citations[0]['attrs']['items'][0]['locator']=='12–14'
    assert document_text(citations[0])=='(Smith, 2020, pp. 12–14)'
    bibliography=next(node for node in walk(restored['document']) if node['type']=='bibliography')
    assert document_text(bibliography).count('A study of examples.')==1
    assert any(mark['type']=='em' for node in walk(bibliography) for mark in node.get('marks',[]))
    assert restored['settings']['citationStyle']=='apa'

@pytest.mark.parametrize('format',['txt','md','pdf'])
def test_plain_and_pdf_outputs_keep_citation_and_bibliography_wording(tmp_path,format):
    result=build_export(fixture(),format,tmp_path)
    if format=='pdf':
        from pypdf import PdfReader
        text='\n'.join(page.extract_text() for page in PdfReader(result['path']).pages)
    else:text=Path(result['path']).read_text('utf-8')
    assert '(Smith, 2020' in text and text.count('A study of examples')==1

def test_invalid_source_and_citation_data_is_rejected():
    for value in ({**source(),'title':'bad\x00text'},{**source(),'__proto__':{}},{**source(),'type':'invalid'}):
        with pytest.raises(ValueError):validate_source(value)
    project=fixture();project['book']['chapters'][0]['document']['content'][0]['content'][1]['attrs']['items']=[]
    with pytest.raises(ValueError):validate_project(project)
