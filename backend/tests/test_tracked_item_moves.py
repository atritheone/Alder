from copy import deepcopy
from pathlib import Path
import pytest
from alder.models import create_project,validate_project,document_text
from alder.publishing import build_export,import_document
from alder.document_revisions import review_document,revision_summary
from alder.tracked_moves import validate_moves
from alder.document_comments import walk
from alder.list_formatting import resolve_list_orders
from alder.outline_lists import outline_layout
from test_tracked_comment_moves import THREAD

def fixture(outline=False,comments=False,continued=False):
    project=create_project(template='blank');project['name']='Tracked item move';project['settings'].update(documentKind='docx',includeTitle=False)
    def para(text):return {'type':'paragraph','content':[{'type':'text','text':text,'marks':[{'type':'strong'}]}]}
    def item(text):return {'type':'list_item','content':[para(text)]}
    moved={'type':'list_item','content':[para('Moved item'),para('Continuation'),{'type':'ordered_list','content':[item('Nested first'),item('Nested last')]},para('After nested')]}
    if comments:
        for p,edge in ((moved['content'][0],'start'),(moved['content'][-1],'end')):
            p['content'].insert(0 if edge=='start' else len(p['content']),{'type':'comment_anchor','attrs':{'threadId':'thread','edge':edge,'thread':deepcopy(THREAD)}})
    sides=[]
    for kind in ('deletion','insertion'):
        side=deepcopy(moved);side['attrs']={'blockId':'moved'+('_ghost' if kind=='deletion' else ''),'revisionMove':{'kind':kind,'stamp':{'id':'item_move','author':'Reviewer','date':'2026-11-04T00:00:00Z','move':True},'originalId':'moved'}};sides.append(side)
    attrs={'order':3,'listStyle':'upper-alpha'}
    if outline:attrs['listTemplate']=[{'format':'decimal','pattern':'.'.join('%'+str(n+1) for n in range(level+1))+'.','start':1,'restart':level,'indent':24*(level+1),'hanging':18} for level in range(9)]
    content=[{'type':'ordered_list','attrs':attrs,'content':[item('First item'),sides[0],item('Last item'),sides[1]]}]
    if continued:content.extend([para('Between'),{'type':'ordered_list','attrs':{**deepcopy(attrs),'continuePrevious':True,'order':6},'content':[item('Continued item')]}])
    project['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':{'type':'doc','content':content}}]}
    return validate_project(project)

@pytest.mark.parametrize('outline',[False,True])
@pytest.mark.parametrize('comments',[False,True])
@pytest.mark.parametrize('format',['html','epub','docx'])
def test_complete_item_move_exchange_keeps_continuations_nested_lists_and_both_decisions(tmp_path,outline,comments,format):
    project=fixture(outline,comments);source=project['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document'];validate_moves(restored)
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(source,view)
        assert document_text(actual)==document_text(expected)
        items=actual['content'][0]['content'];assert len(items)==3
        moved=items[1 if view=='original' else 2]
        assert [n['type'] for n in moved['content']]==['paragraph','paragraph','ordered_list','paragraph']
        if comments:
            anchors=[n['attrs'] for n in walk(actual) if n['type']=='comment_anchor']
            assert [a['edge'] for a in anchors]==['start','end'];assert anchors[0]['thread']==anchors[1]['thread']
    if outline:
        for view in ('original','final'):
            labels=lambda doc:[i['label'] for record in outline_layout(doc) for i in record['items']]
            assert labels(review_document(restored,view))==labels(review_document(source,view))

def test_pending_item_does_not_count_its_source_in_continued_numbering():
    project=fixture(continued=True);doc=project['book']['chapters'][0]['document']
    resolve_list_orders(doc);assert doc['content'][-1]['attrs']['order']==6
    for view in ('original','final'):assert review_document(doc,view)['content'][-1]['attrs']['order']==6

@pytest.mark.parametrize('outline',[False,True])
def test_word_item_move_keeps_following_list_continuation(tmp_path,outline):
    project=fixture(outline=outline,continued=True);source=project['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(project,'docx',tmp_path)['path']))['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        actual=review_document(restored,view)
        assert document_text(actual)==document_text(review_document(source,view))
        assert actual['content'][-1]['attrs']['continuePrevious']
        assert actual['content'][-1]['attrs']['order']==6

@pytest.mark.parametrize('container',['nested-list','cell'])
def test_native_move_within_nested_list_or_cell_preserves_the_container(tmp_path,container):
    project=fixture(comments=True);source=project['book']['chapters'][0]['document']
    p={'type':'paragraph','content':[{'type':'text','text':'Container'}]}
    content=[p,*source['content']]
    source['content']=[{'type':'bullet_list','content':[{'type':'list_item','content':content}]}] if container=='nested-list' else [{'type':'table','content':[{'type':'table_row','content':[{'type':'table_cell','content':content}]}]}]
    project=validate_project(project);source=project['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(project,'docx',tmp_path)['path']))['document'];validate_moves(restored)
    for view in ('original','final'):assert document_text(review_document(restored,view))==document_text(review_document(source,view))

@pytest.mark.parametrize('damage',['missing-pair','cross-list','changed-content'])
def test_item_move_refuses_incomplete_or_divergent_pairs(damage):
    project=fixture();doc=project['book']['chapters'][0]['document'];items=doc['content'][0]['content']
    if damage=='missing-pair':items.pop()
    elif damage=='cross-list':doc['content'].append({'type':'ordered_list','content':[items.pop()]})
    else:items[1]['content'][0]['content'][0]['text']='Different wording'
    with pytest.raises(ValueError):validate_project(project)

@pytest.mark.parametrize('authored_before_end',[False,True])
def test_word_cell_ending_stays_outside_the_item_move(tmp_path,authored_before_end):
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    project=fixture();source=project['book']['chapters'][0]['document']
    source['content']=[{'type':'table','content':[{'type':'table_row','content':[{'type':'table_cell','content':source['content']}]}]}]
    project=validate_project(project);source=project['book']['chapters'][0]['document']
    path=Path(build_export(project,'docx',tmp_path)['path']);native=Document(path)
    cell=native.tables[0].cell(0,0)._tc;ending=cell[-1]
    assert ending.tag==qn('w:p') and ending.find('.//'+qn('w:moveTo')) is None
    end=ending.getprevious();assert end.tag==qn('w:moveToRangeEnd')
    if authored_before_end:
        run=OxmlElement('w:r');text=OxmlElement('w:t');text.text='Extra wording';run.append(text);ending.append(run)
    ending.append(end);native.save(path)
    if authored_before_end:
        with pytest.raises(ValueError,match='paragraph move'):import_document(path)
    else:
        restored=import_document(path)['document']
        for view in ('original','final'):assert document_text(review_document(restored,view))==document_text(review_document(source,view))
