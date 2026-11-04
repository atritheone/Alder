from copy import deepcopy
from pathlib import Path
import pytest
from alder.document_comparison import compare_documents,canonical
from alder.document_combination import combine_documents
from alder.document_revisions import review_document,revision_summary
from alder.models import document_text,validate_project
from alder.publishing import build_export,import_document
from test_document_comparison import doc,para,project_fixture,commented,threads,DATE

def reviewed(base,final,author):return compare_documents(base,final,author,DATE)
def check_original(result,base):assert canonical(review_document(result,'original'))==canonical(base)

def test_combines_separate_paragraph_edits_preserving_both_authors_and_inputs():
    base=doc('First.','Second.','Third.')
    a=reviewed(base,doc('First edit.','Second.','Third.'),'Alice');b=reviewed(base,doc('First.','Second edit.','Third.'),'Bob');snapshots=deepcopy((a,b))
    combined=combine_documents(a,b);assert not combined['conflicts'];result=combined['document'];check_original(result,base)
    assert document_text(review_document(result,'final'))=='First edit.\nSecond edit.\nThird.'
    assert {c['author'] for c in revision_summary(result)}=={'Alice','Bob'} and (a,b)==snapshots

def test_overlapping_paragraph_changes_require_an_explicit_choice():
    base=doc('Words.');a=reviewed(base,doc('Alice words.'),'Alice');b=reviewed(base,doc('Bob words.'),'Bob')
    preview=combine_documents(a,b);assert len(preview['conflicts'])==1 and preview['conflicts'][0]['choice'] is None
    key=preview['conflicts'][0]['id']
    for side,expected,author in [('original','Alice words.','Alice'),('revised','Bob words.','Bob')]:
        chosen=combine_documents(a,b,{key:side});assert chosen['conflicts'][0]['id']==key
        assert document_text(review_document(chosen['document'],'final'))==expected;check_original(chosen['document'],base)
        assert {c['author'] for c in revision_summary(chosen['document'])}=={author}

def test_equivalent_reviews_deduplicate_even_after_revision_ids_change():
    base=doc('Words.');a=reviewed(base,doc('Edited words.'),'Alice');b=reviewed(base,doc('Edited words.'),'Alice')
    result=combine_documents(a,b);assert not result['conflicts'] and len(revision_summary(result['document']))==1

def test_move_and_independent_edit_combine_without_splitting_move_evidence():
    base=doc('Moved.','Anchor.','Edited.')
    a=reviewed(base,doc('Anchor.','Edited.','Moved.'),'Alice');b=reviewed(base,doc('Moved.','Anchor.','Bob edited.'),'Bob')
    result=combine_documents(a,b);assert not result['conflicts'];check_original(result['document'],base)
    assert document_text(review_document(result['document'],'final'))=='Anchor.\nBob edited.\nMoved.'
    assert len(revision_summary(result['document']))==2

def test_conflicting_move_decision_keeps_or_removes_both_ends():
    base=doc('Moved.','Anchor.','End.')
    a=reviewed(base,doc('Anchor.','End.','Moved.'),'Alice');b=reviewed(base,doc('Changed source.','Anchor.','End.'),'Bob')
    preview=combine_documents(a,b);assert len(preview['conflicts'])==1
    for side,expected in [('original','Anchor.\nEnd.\nMoved.'),('revised','Changed source.\nAnchor.\nEnd.')]:
        result=combine_documents(a,b,{preview['conflicts'][0]['id']:side})['document'];check_original(result,base)
        assert document_text(review_document(result,'final'))==expected and len(revision_summary(result))==1

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_combined_review_retains_authors_and_views_through_exchange(tmp_path,format):
    base=doc('One.','Two.','Three.');a=reviewed(base,doc('One changed.','Two.','Three.'),'Alice');b=reviewed(base,doc('One.','Two.','Three changed.'),'Bob')
    result=combine_documents(a,b)['document'];p=project_fixture('Combined',[]);p['book']['chapters'][0]['document']=result;p=validate_project(p)
    restored=import_document(Path(build_export(p,format,tmp_path)['path']))['document']
    assert {c['author'] for c in revision_summary(restored)}=={'Alice','Bob'}
    for view in ('original','final'):assert document_text(review_document(restored,view))==document_text(review_document(result,view))

def test_combining_comments_keeps_threads_from_both_reviewers():
    base=doc('One.','Two.')
    a=reviewed(base,doc(commented('One edited.',message='Alice comment.'),'Two.'),'Alice')
    b=reviewed(base,doc('One.',commented('Two edited.','other','Bob comment.')),'Bob')
    result=combine_documents(a,b)['document']
    assert len(threads(result))==4
    assert {e['text'] for t in threads(result) for e in t['thread']['entries']}=={'Alice comment.','Bob comment.'}

def test_conflicting_comments_survive_when_their_wording_is_removed():
    base=doc('Old.')
    a=reviewed(base,doc(commented('Alice.','alice','Alice comment.')),'Alice');b=reviewed(base,doc(commented('Bob.','bob','Bob comment.')),'Bob')
    preview=combine_documents(a,b);key=preview['conflicts'][0]['id'];result=combine_documents(a,b,{key:'revised'})
    assert result['reanchoredComments']>0 and len(threads(result['document']))==4
    assert document_text(review_document(result['document'],'final'))=='Bob.'

def test_rejects_unrelated_originals_without_inventing_authorship():
    a=reviewed(doc('One'),doc('Edited'),'Alice');b=reviewed(doc('Two'),doc('Edited'),'Bob')
    with pytest.raises(ValueError,match='same original'):combine_documents(a,b)

def test_combines_disjoint_word_edits_inside_the_same_paragraph():
    base=doc('First word and last word.')
    a=reviewed(base,doc('Changed word and last word.'),'Alice');b=reviewed(base,doc('First word and final word.'),'Bob')
    result=combine_documents(a,b);assert not result['conflicts'];check_original(result['document'],base)
    assert document_text(review_document(result['document'],'final'))=='Changed word and final word.'
    assert {c['author'] for c in revision_summary(result['document'])}=={'Alice','Bob'}

def test_combines_paragraph_appearance_with_an_independent_word_edit():
    base=doc('Words.');a=reviewed(base,doc(para('Words.',align='right')),'Alice');b=reviewed(base,doc('New words.'),'Bob')
    result=combine_documents(a,b);assert not result['conflicts'];check_original(result['document'],base)
    final=review_document(result['document'],'final');assert final['content'][0]['attrs']['align']=='right' and document_text(final)=='New words.'

def test_independent_character_formats_keep_both_review_records():
    base=doc('Word');a=doc({'type':'paragraph','content':[{'type':'text','text':'Word','marks':[{'type':'strong'}]}]});b=doc({'type':'paragraph','content':[{'type':'text','text':'Word','marks':[{'type':'em'}]}]})
    combined=combine_documents(reviewed(base,a,'Alice'),reviewed(base,b,'Bob'));assert not combined['conflicts'];check_original(combined['document'],base)
    final=review_document(combined['document'],'final');assert {m['type'] for m in final['content'][0]['content'][0]['marks']}=={'strong','em'}
    assert len(revision_summary(combined['document']))==2

def test_combine_api_creates_nothing_until_every_conflict_has_a_choice(tmp_path):
    from alder.app import create_app
    from fastapi.testclient import TestClient
    app=create_app(tmp_path,session_token='combine');store=app.state.store
    base=doc('Original.');a=project_fixture('Alice',[]);b=project_fixture('Bob',[])
    a['book']['chapters'][0]['document']=reviewed(base,doc('Alice.'),'Alice');b['book']['chapters'][0]['document']=reviewed(base,doc('Bob.'),'Bob')
    a=store.insert(a);b=store.insert(b)
    request={'mode':'combine','originalId':a['id'],'revisedId':b['id'],'originalRevision':1,'revisedRevision':1}
    with TestClient(app) as client:
        client.headers['Authorization']='Bearer combine'
        preview=client.post('/api/document-comparison',json=request);assert preview.status_code==200,preview.text
        assert len(preview.json()['conflicts'])==1
        assert client.post('/api/document-comparison',json={**request,'create':True}).status_code==422
        assert len(store.list_projects())==2
        key=preview.json()['conflicts'][0]['id']
        created=client.post('/api/document-comparison',json={**request,'choices':{key:'revised'},'create':True});assert created.status_code==200,created.text
        copy=created.json()['project'];assert document_text(copy['book']['chapters'][0]['document'])=='Bob.'
        assert store.get(a['id'])==a and store.get(b['id'])==b
