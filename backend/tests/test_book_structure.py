from copy import deepcopy
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import pytest
from alder.models import create_project, validate_project, text_document, document_text, ValidationError
from alder.publishing import build_export, import_document, project_document
from alder.publication_layout import prepare_layout

def fixture():
    p=create_project('Structured book',template='blank')
    p['settings'].update(documentKind='book',includeTitle=False,includeToc=False,chapterPageBreaks=True)
    p['book']={'version':1,'chapters':[{'id':'part_'+str(i),'title':title,'role':role,'showTitle':show,'include':True,'document':text_document('BODY_'+str(i)+' authored content.')} for i,(title,role,show) in enumerate([('The title','titlepage',False),('Opening words','preface',True),('The story','chapter',True),('Extra material','appendix',True)])]}
    p['book']['chapters'][1]['matter']='frontmatter'
    return validate_project(p)

@pytest.mark.parametrize('format',['html','epub','docx'])
def test_structured_book_round_trip_retains_roles_hidden_titles_and_body(tmp_path,format):
    p=fixture();before=deepcopy(p)
    result=build_export(p,format,tmp_path)
    imported=import_document(Path(result['path']))
    assert p==before
    assert [(c['title'],c['role'],c['showTitle']) for c in imported['chapters']]==[(c['title'],c['role'],c['showTitle']) for c in p['book']['chapters']]
    assert [document_text(c['document']) for c in imported['chapters']]==[c['text'] for c in p['book']['chapters']]
    assert [c['matter'] for c in imported['chapters']]==['frontmatter','frontmatter','bodymatter','backmatter']
    if format=='epub':
        from xml.etree import ElementTree as ET
        with ZipFile(result['path']) as z:
            root=ET.fromstring(z.read('EPUB/nav.xhtml'))
            ns={'h':'http://www.w3.org/1999/xhtml'}
            links=root.findall('.//h:nav[@id="toc"]//h:a',ns)
            assert [link.text for link in links]==[c['title'] for c in p['book']['chapters']]
            types=[a.get('{http://www.idpf.org/2007/ops}type') for a in root.findall('.//h:nav//h:a',ns)]
            assert types.count('bodymatter')==1 and 'titlepage' in types and 'appendix' in types
            assert b'epub:type="frontmatter titlepage"' in z.read('EPUB/section-1.xhtml')

def test_import_endpoint_retains_book_structure_without_an_empty_first_chapter(tmp_path):
    from fastapi.testclient import TestClient
    from alder.app import create_app
    path=Path(build_export(fixture(),'html',tmp_path)['path'])
    with TestClient(create_app(tmp_path/'data',session_token='')) as client:
        project=client.post('/api/projects',json={'template':'blank'}).json()
        result=client.post('/api/projects/'+project['id']+'/import',files={'file':('book.html',path.read_bytes(),'text/html')})
        assert result.status_code==200,result.text
        value=result.json()
        assert len(value['book']['chapters'])==4
        assert value['lastImport']['bookStructure'] is True
        assert [c['text'] for c in value['book']['chapters']]==[c['text'] for c in fixture()['book']['chapters']]

def test_hidden_title_does_not_disappear_from_navigation_or_leak_into_pdf(tmp_path):
    p=fixture();sections=project_document(p)
    assert sections[0]['title']=='' and sections[0]['navigationTitle']=='The title'
    layout=prepare_layout(p)
    assert 'The title' not in document_text(layout['document'])
    assert all(document_text(layout['document']).count('BODY_'+str(i))==1 for i in range(4))
    p['book']['chapters'][1]['include']=False
    assert 'Opening words' not in document_text(prepare_layout(p)['document'])

@pytest.mark.parametrize('value',[{'matter':'outside'},{'matter':[]},{'showTitle':'yes'},{'role':{}},{'role':''}])
def test_invalid_structure_is_rejected(value):
    p=fixture();p['book']['chapters'][0].update(value)
    with pytest.raises(ValidationError):validate_project(p)

def test_unassigned_html_and_epub_content_is_never_dropped(tmp_path):
    p=fixture()
    html=Path(build_export(p,'html',tmp_path)['path'])
    html.write_text(html.read_text('utf-8').replace('<main>','<main><p>UNASSIGNED WORDING</p>'),encoding='utf-8')
    restored=import_document(html)
    assert not restored.get('chapters') and 'UNASSIGNED WORDING' in restored['text']
    epub=Path(build_export(p,'epub',tmp_path)['path'])
    with ZipFile(epub) as z: entries={name:z.read(name) for name in z.namelist()}
    # An unlabelled first spine item cannot be lost when later items have metadata.
    entries['EPUB/section-1.xhtml']=b'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title></head><body><p>UNASSIGNED COVER</p></body></html>'
    altered=tmp_path/'mixed.epub'
    with ZipFile(altered,'w',compression=ZIP_DEFLATED) as z:
        for name,data in entries.items():z.writestr(name,data)
    restored=import_document(altered)
    assert not restored.get('chapters') and 'UNASSIGNED COVER' in restored['text'] and 'BODY_3' in restored['text']
