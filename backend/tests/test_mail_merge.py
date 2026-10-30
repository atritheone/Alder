import base64
import copy
import io
import json
from pathlib import Path

import pytest
from PIL import Image

from alder.mail_merge import read_csv,create_documents,merge_keys
from alder.models import create_project,validate_project,document_text
from alder.publishing import build_export,import_document
from alder.store import Store,ConflictError


def field(name,marks=None):
    return {'type':'document_field','attrs':{'fieldKind':'merge','mergeKey':name},'content':[{'type':'text','text':'\u00ab'+name+'\u00bb'}],**({'marks':marks} if marks else {})}


def paragraph(*content):return {'type':'paragraph','content':list(content)}


def fixture():
    p=create_project('Letter','blank');p['settings'].update(documentKind='docx',includeTitle=False,footer=False)
    p['book']={'version':1,'chapters':[{'id':'letter','title':'Document','include':True,'document':{'type':'doc','content':[
        paragraph({'type':'text','text':'Dear '},field('Name',[{'type':'strong'}]),{'type':'text','text':','}),
        paragraph(field('Address')),
        {'type':'table','content':[{'type':'table_row','content':[{'type':'table_cell','content':[paragraph({'type':'text','text':'Account'})]},{'type':'table_cell','content':[paragraph(field('Account'))]}]}]},
        paragraph({'type':'text','text':'Your note'},{'type':'document_note','attrs':{'kind':'footnote','blockId':'note','body':{'type':'doc','content':[paragraph(field('Name'))]}}}),
    ]}}]}
    p['settings']['runningMatter']={'header':{'default':{'type':'doc','content':[paragraph(field('Name'))]}}}
    return validate_project(p)


def request(p):return {'expectedRevision':p['revision'],'records':[1,3],'mapping':{'Name':'Full name','Address':'Address','Account':'Account'},'rows':[
    {'Full name':'A & B <literal>','Address':'First line\r\nSecond line','Account':'00123'},
    {'Full name':'\u0e44\u0e17\u0e22 \U0001f600','Address':'','Account':'=2+3'},
]}


def test_csv_quotes_newlines_utf8_bom_and_literal_values():
    result=read_csv('\ufeffName,Address,Number\r\n"A, B","line 1\r\nline ""2""",00123\r\nC,,=2+3\r\n')
    assert result['headers']==['Name','Address','Number']
    assert result['rows']==[['A, B','line 1\r\nline "2"','00123'],['C','','=2+3']]
    assert read_csv('Name;Value\n\u0e44\u0e17\u0e22;\U0001f600',';')['rows']==[['\u0e44\u0e17\u0e22','\U0001f600']]


@pytest.mark.parametrize('text,match',[('A,A\n1,2','unique'),('A,B\n1','expected'),('A\n"unclosed','quoting'),('A\n','no records'),(',B\n1,2','nonempty'),('A\n\x00','invalid text')])
def test_invalid_csv_is_actionable(text,match):
    with pytest.raises(ValueError,match=match):read_csv(text)


def test_merge_preserves_source_formatting_nested_fields_images_and_literal_values(tmp_path):
    store=Store(tmp_path);p=store.insert(fixture());image=io.BytesIO();Image.new('RGB',(40,20),'blue').save(image,format='PNG')
    asset=store.store_asset(p['id'],'logo.png',image.getvalue(),'image/png')
    p['assets'].append(asset);p['book']['chapters'][0]['document']['content'].append({'type':'image','attrs':{'assetId':asset['id'],'src':'asset:'+asset['id'],'alt':'Logo'}})
    p['book']['chapters'][0]['rawSource']={'format':'html','text':'Stale template'}
    p=store.update(p['id'],p,p['revision']);before=copy.deepcopy(p)
    result=create_documents(store,p['id'],request(p));assert len(result['projects'])==2
    assert store.get(p['id'])==before
    one,two=[store.get(item['id']) for item in result['projects']]
    doc=one['book']['chapters'][0]['document'];text=document_text(doc)
    assert 'A & B <literal>' in text and 'First line\nSecond line' in text and '00123' in text
    assert not merge_keys(one) and not merge_keys(two)
    assert doc['content'][0]['content'][1]['marks']==[{'type':'strong'}]
    assert '=2+3' in document_text(two['book']['chapters'][0]['document'])
    assert 'rawSource' not in one['book']['chapters'][0]
    assert one['clips'][0]['text']==''
    assert store.asset_path(one['id'],one['assets'][0]['id'])[0].read_bytes()==image.getvalue()
    assert one['assets'][0]['id']!=two['assets'][0]['id']
    assert one['id'] in doc['content'][-1]['attrs']['src'] and p['id'] not in doc['content'][-1]['attrs']['src']
    note=doc['content'][3]['content'][1]
    assert document_text(note['attrs']['body'])=='A & B <literal>'
    assert document_text(one['settings']['runningMatter']['header']['default'])=='A & B <literal>'
    store=Store(tmp_path);assert store.get(one['id'])==one


def test_merged_title_and_text_references_refresh_to_the_new_copy(tmp_path):
    store=Store(tmp_path);p=fixture();content=p['book']['chapters'][0]['document']['content']
    content.insert(0,{'type':'heading','attrs':{'level':1,'blockId':'recipient'},'content':[field('Name')]})
    content.append(paragraph({'type':'document_field','attrs':{'fieldKind':'title'},'content':[{'type':'text','text':'Old title'}]},
        {'type':'cross_reference','attrs':{'targetId':'recipient'},'content':[{'type':'text','text':'Old name'}]}))
    p=store.insert(p);item=create_documents(store,p['id'],request(p))['projects'][0];copy=store.get(item['id'])
    tail=copy['book']['chapters'][0]['document']['content'][-1]['content']
    assert document_text(tail[0])=='Letter - 1' and document_text(tail[1])=='A & B <literal>'


@pytest.mark.parametrize('problem',['revision','mapping','tracked','invalid-record','excess','asset-write','transaction'])
def test_failed_merge_creates_no_partial_documents(tmp_path,monkeypatch,problem):
    store=Store(tmp_path);p=store.insert(fixture());data=request(p)
    if problem=='revision':data['expectedRevision']-=1
    if problem=='mapping':del data['mapping']['Address']
    if problem=='tracked':
        p['book']['chapters'][0]['document']['content'][0]['content'][0]['marks']=[{'type':'revision_insertion','attrs':{'id':'edit','author':'Editor','date':'2026-10-30T00:00:00Z'}}]
        p=store.update(p['id'],p,p['revision']);data['expectedRevision']=p['revision']
    if problem=='invalid-record':data['records']=[1,1]
    if problem=='excess':data['rows']*=51
    if problem=='asset-write':
        asset=store.store_asset(p['id'],'test.png',b'fake image','image/png');p['assets'].append(asset)
        p['book']['chapters'][0]['document']['content'].append({'type':'image','attrs':{'assetId':asset['id']}})
        p=store.update(p['id'],p,p['revision']);data['expectedRevision']=p['revision']
        def fail(*args):raise OSError('Disk full')
        monkeypatch.setattr(store,'_atomic_bytes',fail)
    if problem=='transaction':
        with store.connection() as conn:
            conn.execute("CREATE TRIGGER fail_second BEFORE INSERT ON projects WHEN NEW.name LIKE '% - 3' BEGIN SELECT RAISE(ABORT,'Disk full'); END;")
            conn.commit()
    before=copy.deepcopy(store.get(p['id']))
    with pytest.raises((ValueError,OSError)):create_documents(store,p['id'],data)
    assert len(store.list_projects())==1 and store.get(p['id'])==before


@pytest.mark.parametrize('format',['docx','html','epub'])
def test_native_merge_fields_exchange_without_data_source_execution(tmp_path,format):
    p=fixture();original=copy.deepcopy(p)
    result=build_export(p,format,tmp_path,{'validate':False})
    assert p==original
    imported=import_document(Path(result['path']))
    assert merge_keys(imported['document'])==['Account','Address','Name']
    assert merge_keys(imported['settings']['runningMatter'])==['Name']
    if format=='docx':
        from zipfile import ZipFile
        with ZipFile(result['path']) as archive:
            assert b'MERGEFIELD "Name"' in archive.read('word/document.xml')
            assert b'mailMerge' not in archive.read('word/settings.xml')


def test_mail_merge_api_requires_auth_valid_mapping_and_current_revision(tmp_path):
    from fastapi.testclient import TestClient
    from alder.app import create_app
    app=create_app(tmp_path,session_token='merge-test');project=app.state.store.insert(fixture())
    with TestClient(app) as client:
        assert client.post('/api/mail-merge/csv',json={'text':'Name\nOne'}).status_code==401
        client.headers['Authorization']='Bearer merge-test'
        assert client.post('/api/mail-merge/csv',json={'text':'Name\nOne'}).json()['rows']==[['One']]
        bad=request(project);bad['expectedRevision']-=1
        assert client.post(f"/api/projects/{project['id']}/mail-merge",json=bad).status_code==409
        result=client.post(f"/api/projects/{project['id']}/mail-merge",json=request(project))
        assert result.status_code==200,result.text
        assert len(result.json()['projects'])==2
        assert app.state.store.get(project['id'])==project
