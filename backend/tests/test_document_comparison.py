from copy import deepcopy
from pathlib import Path
import random

import pytest
from alder.document_comparison import compare_documents,canonical
from alder.document_revisions import review_document,revision_summary
from alder.models import create_project,validate_project,document_text
from alder.publishing import build_export,import_document

DATE='2026-11-03T00:00:00Z'
def para(text,**attrs):
    return {'type':'paragraph',**({'attrs':attrs} if attrs else {}),'content':[{'type':'text','text':text}] if text else []}
def doc(*values):return {'type':'doc','content':[para(v) if isinstance(v,str) else v for v in values]}
def compare(a,b):
    snapshots=deepcopy((a,b));result=compare_documents(a,b,'Reviewer',DATE)
    assert (a,b)==snapshots
    for view,source in [('original',a),('final',b)]:assert canonical(review_document(result,view))==canonical(source)
    return result

@pytest.mark.parametrize('a,b',[
    (doc('Same.'),doc('Same.')),
    (doc('Old words.','Anchor.'),doc('New words.','Anchor.')),
    (doc('Anchor.'),doc('Added.','Anchor.')),
    (doc('Removed.','Anchor.'),doc('Anchor.')),
    (doc('First.','Second.','Third.'),doc('Second.','Third.','First.')),
    (doc('Same.','Same.','End.'),doc('Same.','End.','Same.')),
    (doc(''),doc('New 😀 e\u0301 ภาษาไทย words.')),
    (doc('Old words.'),doc('')),
    (doc('First.','Middle.','Last.'),doc('Last.','Changed.','First.')),
])
def test_comparison_preserves_both_inputs_and_both_decisions(a,b):compare(a,b)

def test_comparison_keeps_formatting_heading_and_identity_independent():
    a=doc(para('Both words.',blockId='source',align='left'))
    b=doc({'type':'heading','attrs':{'level':2,'align':'right','blockId':'imported'},'content':[{'type':'text','text':'Both ','marks':[{'type':'strong'}]},{'type':'text','text':'words.'}]})
    result=compare(a,b)
    assert result['content'][0]['attrs']['blockId']=='source'
    assert len(revision_summary(result))==1

def test_comparison_normalizes_only_equivalent_adjacent_text_runs():
    a=doc({'type':'paragraph','content':[{'type':'text','text':'Some '},{'type':'text','text':'words.'}]})
    assert not revision_summary(compare(a,doc('Some words.')))

def test_unique_paragraph_move_is_paired_without_manufacturing_duplicate_moves():
    result=compare(doc('A','B','C'),doc('B','C','A'))
    assert len(revision_summary(result))==1 and revision_summary(result)[0]['move']
    compare(doc('A','A','B'),doc('A','B','A'))

def test_comparison_random_edits_keep_two_exact_views():
    rng=random.Random(901)
    for _ in range(80):
        before=[para(rng.choice(['Alpha.','Beta words.','😀 joined e\u0301.','']),align=rng.choice(['left','right'])) for _ in range(rng.randint(1,8))]
        after=deepcopy(before);rng.shuffle(after)
        for _ in range(rng.randint(1,5)):
            operation=rng.randrange(3)
            if operation==0:after.insert(rng.randrange(len(after)+1),para('New '+str(rng.randrange(3))))
            elif operation==1 and len(after)>1:after.pop(rng.randrange(len(after)))
            else:after[rng.randrange(len(after))]=para('Edited '+str(rng.randrange(3)))
        compare(doc(*before),doc(*after))

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_complete_paragraph_changes_exchange_without_phantom_paragraphs(tmp_path,format):
    source=compare(doc('Deleted.','Kept.'),doc('Kept.','Inserted.'))
    p=create_project(template='blank');p['settings'].update(documentKind='docx',includeTitle=False)
    p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':source}]};p=validate_project(p)
    assert validate_project(p)==p
    exported=build_export(p,format,tmp_path);restored=import_document(Path(exported['path']))['document']
    assert len(revision_summary(restored))==2
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(source,view)
        assert document_text(actual)==document_text(expected)
        assert len(actual['content'])==len(expected['content'])

def test_pending_or_unsupported_comparison_does_not_change_sources():
    a=doc('Old');b=doc({'type':'paragraph','content':[{'type':'inline_image','attrs':{'src':'https://example.test/picture.png'}}]})
    with pytest.raises(ValueError,match='structured'):compare(a,b)
    reviewed=compare(a,doc('New'))
    with pytest.raises(ValueError,match='pending revision'):compare(reviewed,doc('Newer'))

def project_fixture(name,text):
    p=create_project(name,'blank');p['settings'].update(documentKind='docx',includeTitle=False)
    p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':doc(*text)}]}
    return validate_project(p)

def test_project_comparison_api_preserves_sources_and_requires_current_revisions(tmp_path):
    from fastapi.testclient import TestClient
    from alder.app import create_app
    app=create_app(tmp_path,session_token='comparison-test');store=app.state.store
    a=store.insert(project_fixture('Original',['Deleted','Kept']));b=store.insert(project_fixture('Revised',['Kept','Added']))
    request={'originalId':a['id'],'revisedId':b['id'],'originalRevision':a['revision'],'revisedRevision':b['revision'],'author':'Reviewer'}
    with TestClient(app) as client:
        assert client.post('/api/document-comparison',json=request).status_code==401
        client.headers['Authorization']='Bearer comparison-test'
        assert client.post('/api/document-comparison',json={**request,'originalRevision':0,'create':True}).status_code==409
        preview=client.post('/api/document-comparison',json=request);assert preview.status_code==200,preview.text
        assert preview.json()['changes']==2 and len(store.list_projects())==2
        result=client.post('/api/document-comparison',json={**request,'create':True});assert result.status_code==200,result.text
        copy=result.json()['project'];assert copy['id'] not in (a['id'],b['id']) and len(copy['styles'])==len(a['styles'])
        assert len(store.list_projects())==3 and store.get(a['id'])==a and store.get(b['id'])==b
        for view,source in [('original',a),('final',b)]:assert canonical(review_document(copy['book']['chapters'][0]['document'],view))==canonical(source['book']['chapters'][0]['document'])

def test_comparison_retains_conflicting_named_styles(tmp_path):
    from alder.store import Store
    from alder.document_comparison import compare_projects
    store=Store(tmp_path);a=project_fixture('Original',['Same']);b=deepcopy(a);b['id']='other';b['name']='Revised'
    a['book']['chapters'][0]['document']['content'][0]['attrs']['styleId']=a['styles'][0]['id']
    b['book']['chapters'][0]['document']['content'][0]['attrs']['styleId']=b['styles'][0]['id'];b['styles'][0]['fontSize']=16
    a=store.insert(a);b=store.insert(b)
    result=compare_projects(store,{'originalId':a['id'],'revisedId':b['id'],'originalRevision':1,'revisedRevision':1,'author':'Reviewer'},True)['project']
    original=review_document(result['book']['chapters'][0]['document'],'original');final=review_document(result['book']['chapters'][0]['document'],'final')
    styles={s['id']:s for s in result['styles']}
    assert styles[original['content'][0]['attrs']['styleId']]['fontSize']==12
    assert styles[final['content'][0]['attrs']['styleId']]['fontSize']==16

def test_long_unchanged_documents_do_not_become_thousands_of_moves():
    source=doc(*[f'Paragraph {i}' for i in range(2200)])
    assert not revision_summary(compare(source,deepcopy(source)))
    edited=deepcopy(source);edited['content'][1100]=para('Changed paragraph')
    assert len(revision_summary(compare(source,edited)))==1

def commented(text,identity='thread',message='Check wording.',author='Reader',resolved=False):
    thread={'resolved':resolved,'entries':[{'id':'entry','author':author,'text':message,'date':DATE}]}
    anchor=lambda edge:{'type':'comment_anchor','attrs':{'threadId':identity,'edge':edge,'thread':deepcopy(thread)}}
    return {'type':'paragraph','content':[anchor('start'),{'type':'text','text':text},anchor('end')]}

def threads(document):
    from alder.document_comments import walk
    return [n['attrs'] for n in walk(document) if n['type']=='comment_anchor']

def test_comparison_merges_shared_threads_and_preserves_both_authors_and_new_anchor():
    a=doc(commented('Old wording.'));b=doc(commented('New wording.',message='Revised comment.',author='Other reader',resolved=True))
    result=compare_documents(a,b,'Editor',DATE);anchors=threads(result)
    assert [v['edge'] for v in anchors]==['start','end'] and anchors[0]['thread']==anchors[1]['thread']
    assert [v['text'] for v in anchors[0]['thread']['entries']]==['Check wording.','Revised comment.']
    assert [v['author'] for v in anchors[0]['thread']['entries']]==['Reader','Other reader']
    assert anchors[0]['thread']['resolved'] is False
    assert document_text(review_document(result,'final'))=='New wording.' and document_text(review_document(result,'original'))=='Old wording.'
    assert result['content'][0]['content'][0]['text']=='Old'
    assert len({v['id'] for v in anchors[0]['thread']['entries']})==2

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_comparison_comments_in_changed_and_removed_paragraphs_exchange(tmp_path,format):
    a=doc(commented('Removed paragraph.'),'Anchor.',commented('Old wording.','second','Old comment.'))
    b=doc('Anchor.',commented('New wording.','new','New comment.'),commented('Added paragraph.','added','Added comment.'))
    result=compare_documents(a,b,'Editor',DATE)
    p=project_fixture('Review',[]);p['book']['chapters'][0]['document']=result;p=validate_project(p)
    exported=build_export(p,format,tmp_path);restored=import_document(Path(exported['path']))['document']
    anchors=threads(restored);assert len(anchors)==8
    assert sorted({e['text'] for v in anchors for e in v['thread']['entries']})==['Added comment.','Check wording.','New comment.','Old comment.']
    for view in ('original','final'):assert document_text(review_document(restored,view))==document_text(review_document(result,view))

def test_comparison_deduplicates_identical_imported_comments_at_the_same_range():
    result=compare_documents(doc(commented('Same.')),doc(commented('Same.','imported')),'Editor',DATE)
    assert len(threads(result))==2 and not revision_summary(result)
    b=doc(commented('Same.','imported'),'Other.')
    result=compare_documents(doc('Same.',commented('Other.')),b,'Editor',DATE)
    assert len(threads(result))==4

def test_comparison_rejects_incomplete_comment_without_losing_evidence():
    a=doc(commented('Word'));a['content'][0]['content'].pop()
    with pytest.raises(ValueError,match='incomplete'):compare_documents(a,doc('Word'),'Editor',DATE)

def test_comparison_tracks_hard_breaks_without_converting_them_to_text_newlines():
    a=doc({'type':'paragraph','content':[{'type':'text','text':'One'},{'type':'hard_break'},{'type':'text','text':'Two'}]})
    for b in (doc('One Two'),doc('One\nTwo'),doc({'type':'paragraph','content':[{'type':'text','text':'One'},{'type':'hard_break'},{'type':'text','text':'Edited'}]})):
        compare(a,b);compare(b,a)

def test_comparison_preserves_unchanged_lists_with_surrounding_prose_edits():
    listing={'type':'bullet_list','content':[{'type':'list_item','content':[para('List item')]}]}
    compare(doc('Before',listing,'After'),doc('Edited before',deepcopy(listing),'Edited after'))

def test_native_word_comment_markers_outside_paragraph_revision_are_retained(tmp_path):
    from zipfile import ZipFile
    from lxml import etree
    from alder.document_revisions import WordRevisionReader,W
    p=project_fixture('Review',[]);p['book']['chapters'][0]['document']=compare_documents(doc(commented('Removed'),'Kept'),doc('Kept'),'Editor',DATE)
    exported=build_export(p,'docx',tmp_path)
    with ZipFile(exported['path']) as archive:root=etree.fromstring(archive.read('word/document.xml'))
    wrapper=next(n for n in root.iter(f'{{{W}}}del') if len(n));start=wrapper.find(f'{{{W}}}commentRangeStart');wrapper.addprevious(start)
    reader=WordRevisionReader(root)
    assert len(reader.block_changes)==1 and len(list(root.iter(f'{{{W}}}commentRangeStart')))==1
