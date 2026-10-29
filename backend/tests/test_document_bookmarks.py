from pathlib import Path
import pytest
from alder.models import create_project,validate_project,document_text,ValidationError
from alder.publishing import build_export,import_document

def fixture():
    p=create_project(template='blank');p['settings'].update(documentKind='docx',includeTitle=False,footer=False)
    doc={'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':'First'},{'type':'bookmark','attrs':{'name':'MyTarget'}},{'type':'text','text':' last.'}]}]}
    p['book']={'version':1,'chapters':[{'id':'bookmarks','title':'Document','include':True,'document':doc,'text':document_text(doc)}]}
    return validate_project(p)

@pytest.mark.parametrize('format',['html','epub','docx'])
def test_named_point_survives_export_import_without_extra_text(tmp_path,format):
    p=fixture();result=build_export(p,format,tmp_path);opened=import_document(Path(result['path']))
    assert document_text(opened['document'])=='First last.'
    children=opened['document']['content'][0]['content'];bookmark=next(n for n in children if n['type']=='bookmark')
    assert bookmark['attrs']['name']=='MyTarget'
    assert children[0]['text']=='First'

def test_pdf_and_plain_outputs_keep_wording(tmp_path):
    from pypdf import PdfReader
    p=fixture()
    pdf=build_export(p,'pdf',tmp_path);assert 'First last.' in PdfReader(pdf['path']).pages[0].extract_text()
    txt=build_export(p,'txt',tmp_path);assert Path(txt['path']).read_text(encoding='utf-8').strip()=='First last.'
    md=build_export(p,'md',tmp_path);assert any('bookmarks' in warning for warning in md['warnings'])

def test_copies_receive_distinct_stable_identities_and_names():
    from copy import deepcopy
    p=fixture();doc=p['book']['chapters'][0]['document'];doc['content'].append(deepcopy(doc['content'][0]))
    p=validate_project(p);doc=p['book']['chapters'][0]['document']
    items=[n['content'][1]['attrs'] for n in doc['content']]
    assert [i['name'] for i in items]==['MyTarget','MyTarget_2'];assert items[0]['blockId']!=items[1]['blockId']
    assert validate_project(p)==p

def test_invalid_names_rejected():
    p=fixture();p['book']['chapters'][0]['document']['content'][0]['content'][1]['attrs']['name']='bad name'
    with pytest.raises(ValidationError):validate_project(p)


def linked_fixture():
    from copy import deepcopy
    p=fixture();p['settings']['documentKind']='book'
    first=p['book']['chapters'][0]
    second=deepcopy(first);second.update(id='second',title='Later chapter')
    second['document']['content'][0]['content'][1]['attrs']['blockId']='distant-target'
    first['document']['content'].append({'type':'paragraph','content':[{'type':'text','text':'Go to the later target','marks':[{'type':'link','attrs':{'href':'#distant-target'}}]}]})
    p['book']['chapters'].append(second)
    return validate_project(p)


@pytest.mark.parametrize('format',['html','epub','docx'])
def test_links_follow_identity_through_rename_and_duplicate_names(tmp_path,format):
    from copy import deepcopy
    p=linked_fixture();before=deepcopy(p)
    result=build_export(p,format,tmp_path);opened=import_document(Path(result['path']))
    def nodes(node):
        yield node
        for child in node.get('content',[]):yield from nodes(child)
    bookmarks=[n['attrs']['name'] for n in nodes(opened['document']) if n['type']=='bookmark']
    assert bookmarks==['MyTarget','MyTarget_2']
    link=next(n for n in nodes(opened['document']) if n.get('text')=='Go to the later target')
    assert next(m for m in link['marks'] if m['type']=='link')['attrs']['href']=='#MyTarget_2'
    assert p==before
    p['book']['chapters'][1]['document']['content'][0]['content'][1]['attrs']['name']='Renamed'
    result=build_export(p,format,tmp_path);opened=import_document(Path(result['path']))
    link=next(n for n in nodes(opened['document']) if n.get('text')=='Go to the later target')
    assert next(m for m in link['marks'] if m['type']=='link')['attrs']['href']=='#Renamed'
    if format=='epub':
        from zipfile import ZipFile
        with ZipFile(result['path']) as z:
            body=z.read(next(name for name in z.namelist() if name.endswith('/section-1.xhtml'))).decode()
            assert 'href="section-2.xhtml#Renamed"' in body


def test_pdf_bookmark_links_and_missing_targets(tmp_path):
    from pypdf import PdfReader
    p=linked_fixture();result=build_export(p,'pdf',tmp_path)
    pages=PdfReader(result['path']).pages
    assert any(a.get_object().get('/Dest') for page in pages for a in page.get('/Annots',[]))
    p['book']['chapters'][1]['include']=False
    result=build_export(p,'pdf',tmp_path)
    assert any('missing or excluded bookmark' in message for message in result['warnings'])
    assert 'Go to the later target' in '\n'.join(page.extract_text() for page in PdfReader(result['path']).pages)


def test_imported_named_links_bind_once_and_chapter_copies_get_local_targets():
    from copy import deepcopy
    p=fixture();doc=p['book']['chapters'][0]['document']
    doc['content'].append({'type':'paragraph','content':[{'type':'text','text':'See target','marks':[{'type':'link','attrs':{'href':'#MyTarget'}}]}]})
    p=validate_project(p);first=p['book']['chapters'][0]
    original=first['document']['content'][0]['content'][1]['attrs']['blockId']
    assert first['document']['content'][-1]['content'][0]['marks'][0]['attrs']['href']=='#'+original
    second=deepcopy(first);second['id']='copied';p['book']['chapters'].append(second)
    p=validate_project(p);second=p['book']['chapters'][1]
    copied=second['document']['content'][0]['content'][1]['attrs']['blockId']
    assert copied!=original
    assert second['document']['content'][-1]['content'][0]['marks'][0]['attrs']['href']=='#'+copied
    assert validate_project(p)==p


def range_fixture():
    p=fixture()
    p['book']['chapters'][0]['document']={'type':'doc','content':[
        {'type':'paragraph','content':[{'type':'text','text':'Before '},{'type':'bookmark','attrs':{'name':'Passage','blockId':'range-start','range':True}},{'type':'text','text':'First passage.'}]},
        {'type':'paragraph','content':[{'type':'text','text':'Last passage.'},{'type':'bookmark_end','attrs':{'targetId':'range-start','name':'Passage'}},{'type':'text','text':' After.'}]}]}
    return validate_project(p)


@pytest.mark.parametrize('format',['html','epub','docx'])
def test_bookmarked_passage_survives_exchange_with_both_endpoints(tmp_path,format):
    p=range_fixture();result=build_export(p,format,tmp_path)
    opened=import_document(Path(result['path']))
    p['book']['chapters'][0]['document']=opened['document'];p=validate_project(p)
    nodes=p['book']['chapters'][0]['document']['content']
    start=nodes[0]['content'][1];end=nodes[1]['content'][1]
    assert start['type']=='bookmark' and start['attrs']['range']
    assert end['type']=='bookmark_end' and end['attrs']['targetId']==start['attrs']['blockId']
    assert document_text(p['book']['chapters'][0]['document'])=='Before First passage.\nLast passage. After.'
    assert not any('range bookmarks are imported as point' in w for w in opened['warnings'])


def test_copied_chapters_and_duplicate_passages_keep_independent_ranges():
    from copy import deepcopy
    p=range_fixture();first=p['book']['chapters'][0]
    second=deepcopy(first);second['id']='second';p['book']['chapters'].append(second)
    p=validate_project(p)
    targets=[]
    for chapter in p['book']['chapters']:
        nodes=chapter['document']['content'];target=nodes[0]['content'][1]['attrs']['blockId'];targets.append(target)
        assert nodes[1]['content'][1]['attrs']['targetId']==target
    assert targets[0]!=targets[1]
    assert validate_project(p)==p


def test_incomplete_range_keeps_source_and_reports_export_conversion(tmp_path):
    from copy import deepcopy
    p=range_fixture();del p['book']['chapters'][0]['document']['content'][0]['content'][1]
    p=validate_project(p);before=deepcopy(p)
    result=build_export(p,'docx',tmp_path)
    assert any('incomplete bookmark range' in w for w in result['warnings'])
    assert p==before
    assert 'First passage.' in import_document(Path(result['path']))['text']
