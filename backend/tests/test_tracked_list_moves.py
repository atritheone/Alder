import copy
from pathlib import Path
import pytest
from alder.models import create_project, validate_project, document_text
from alder.document_revisions import review_document
from alder.tracked_moves import validate_moves
from alder.publishing import build_export, import_document
from alder.list_formatting import resolve_list_orders

STAMP={'id':'list_move','author':'Reviewer','date':'2026-11-04T00:00:00Z','move':True}

def fixture():
    p=create_project(template='blank');p['name']='Moved list section';p['settings'].update(documentKind='docx',includeTitle=False)
    def para(text):return {'type':'paragraph','attrs':{'spaceAfter':7},'content':[{'type':'text','text':text,'marks':[{'type':'strong'}]}]}
    heading={'type':'heading','attrs':{'blockId':'title','level':1},'content':[{'type':'text','text':'Moved section'}]}
    listing={'type':'ordered_list','attrs':{'blockId':'list','order':3,'listStyle':'upper-alpha'},'content':[
        {'type':'list_item','content':[para('First item'),{'type':'bullet_list','attrs':{'listStyle':'square'},'content':[{'type':'list_item','content':[para('Nested item')]}]}]},
        {'type':'list_item','content':[para('Second item')]}]}
    sides=[]
    for kind in ('deletion','insertion'):
        side=copy.deepcopy([heading,listing])
        for part,n in enumerate(side):
            a=n['attrs'];a['revisionMove']={'kind':kind,'stamp':STAMP.copy(),'originalId':a['blockId'],'part':part,'count':2}
            if kind=='deletion':a['blockId']+='_ghost'
        sides.append(side)
    following={'type':'ordered_list','attrs':{'listStyle':'upper-alpha','continuePrevious':True,'order':5},'content':[{'type':'list_item','content':[para('Other item')]}]}
    doc={'type':'doc','content':[*sides[0],para('Other section'),following,*sides[1]]}
    p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':doc}]}
    return validate_project(p)


def test_list_review_preserves_structure_and_live_numbering():
    p=fixture();doc=p['book']['chapters'][0]['document'];resolve_list_orders(doc);validate_moves(doc)
    assert doc['content'][3]['attrs']['order']==1
    final=review_document(doc,'final');original=review_document(doc,'original')
    assert final['content'][1]['attrs']['order']==1
    assert original['content'][-1]['attrs']['order']==5
    for result in (original,final):
        assert document_text(result).count('First item')==1
        moved=next(n for n in result['content'] if n.get('attrs',{}).get('blockId')=='list')
        assert moved['content'][0]['content'][1]['attrs']['listStyle']=='square'
        assert moved['content'][0]['content'][0]['content'][0]['marks']==[{'type':'strong'}]


@pytest.mark.parametrize('format',['html','epub'])
def test_tracked_list_exchange(tmp_path,format):
    p=fixture();result=build_export(p,format,tmp_path);restored=import_document(Path(result['path']))['document'];validate_moves(restored)
    for view in ('original','final'):
        assert document_text(review_document(restored,view))==document_text(review_document(p['book']['chapters'][0]['document'],view))


def test_native_pending_list_moves_retain_dependent_numbering(tmp_path):
    p=fixture()
    restored=import_document(Path(build_export(p,'docx',tmp_path)['path']))['document']
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(p['book']['chapters'][0]['document'],view)
        assert document_text(actual)==document_text(expected)
        assert [n['attrs']['order'] for n in actual['content'] if n['type']=='ordered_list']==[n['attrs']['order'] for n in expected['content'] if n['type']=='ordered_list']
        clean=copy.deepcopy(p);clean['book']['chapters'][0]['document']=review_document(p['book']['chapters'][0]['document'],view)
        assert Path(build_export(clean,'docx',tmp_path)['path']).is_file()


@pytest.mark.parametrize('damage',['author','missing-part','old-number','new-start'])
def test_moved_numbering_does_not_hide_independent_native_edits(tmp_path,damage):
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    path=Path(build_export(fixture(),'docx',tmp_path)['path']);word=Document(path)
    targets=[p for p in word.paragraphs if p._p.find(qn('w:moveTo')) is not None and p._p.find(qn('w:pPr')+'/'+qn('w:pPrChange')) is not None]
    assert len(targets)==2
    for p in targets:
        change=p._p.pPr.find(qn('w:pPrChange'))
        if damage=='author':change.set(qn('w:author'),'Another reviewer')
        elif damage=='old-number':change[0].find(qn('w:numPr')+'/'+qn('w:numId')).set(qn('w:val'),'1')
    if damage=='missing-part':targets[0]._p.pPr.remove(targets[0]._p.pPr.find(qn('w:pPrChange')))
    if damage=='new-start':
        number=targets[0]._p.pPr.numPr.numId.val
        instance=next(n for n in word.part.numbering_part.element.num_lst if n.numId==number)
        override=OxmlElement('w:lvlOverride');override.set(qn('w:ilvl'),'0')
        start=OxmlElement('w:startOverride');start.set(qn('w:val'),'12');override.append(start);instance.append(override)
    word.save(path)
    with pytest.raises(ValueError):import_document(path)


@pytest.mark.parametrize('explicit_restart',[False,True])
def test_unmatched_top_level_outline_keeps_intent_but_honours_word_restart(tmp_path,explicit_restart):
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    p=outline_fixture(True);source=review_document(p['book']['chapters'][0]['document'],'final')
    source['content']=[source['content'][1]];p['book']['chapters'][0]['document']=source
    path=Path(build_export(validate_project(p),'docx',tmp_path)['path']);word=Document(path)
    if explicit_restart:
        number=word.paragraphs[0]._p.pPr.numPr.numId.val
        instance=next(n for n in word.part.numbering_part.element.num_lst if n.numId==number)
        override=OxmlElement('w:lvlOverride');override.set(qn('w:ilvl'),'0')
        start=OxmlElement('w:startOverride');start.set(qn('w:val'),'4');override.append(start);instance.append(override);word.save(path)
    restored=import_document(path)['document']['content'][0]['attrs']
    assert bool(restored.get('continuePrevious')) is not explicit_restart
    assert restored['order']==(4 if explicit_restart else 1)


@pytest.mark.parametrize('backward',[False,True])
@pytest.mark.parametrize('continued',[False,True])
@pytest.mark.parametrize('cell',[False,'table_cell','table_header'])
@pytest.mark.parametrize('restart',[False,True])
@pytest.mark.parametrize('outline',[False,True])
def test_native_list_move_keeps_preceding_and_following_chains(tmp_path,backward,continued,cell,restart,outline):
    from alder.document_revisions import revision_summary
    from alder.document_comments import walk
    p=outline_fixture(True) if outline else fixture();doc=p['book']['chapters'][0]['document'];nodes=doc['content']
    if restart:nodes[3]['attrs'].update(continuePrevious=False,order=20)
    if backward:nodes[:]=[*nodes[-2:],*nodes[2:-2],*nodes[:2]]
    if continued:
        for n in nodes:
            if n['type']=='ordered_list' and n.get('attrs',{}).get('revisionMove'):n['attrs']['continuePrevious']=True
        earlier=copy.deepcopy(nodes[3]);earlier['attrs']={**earlier['attrs'],'order':7,'continuePrevious':False};earlier['content'][0]['content'][0]['content'][0]['text']='Earlier item'
        nodes.insert(0,earlier)
    if cell:doc['content']=[{'type':'table','content':[{'type':'table_row','content':[{'type':cell,'content':nodes}]}]}]
    p=validate_project(p);doc=p['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(p,'docx',tmp_path)['path']))['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        actual,expected=review_document(restored,view),review_document(doc,view)
        assert document_text(actual)==document_text(expected)
        if outline:
            from test_outline_revisions import assert_appearance
            assert_appearance(actual,expected)
        else:assert [n['attrs']['order'] for n in walk(actual) if n['type']=='ordered_list']==[n['attrs']['order'] for n in walk(expected) if n['type']=='ordered_list']
    p['book']['chapters'][0]['document']=restored
    reopened=import_document(Path(build_export(validate_project(p),'docx',tmp_path)['path']))['document']
    for view in ('original','final'):
        assert document_text(review_document(reopened,view))==document_text(review_document(doc,view))
        if outline:assert_appearance(review_document(reopened,view),review_document(doc,view))
        else:assert [n['attrs']['order'] for n in walk(review_document(reopened,view)) if n['type']=='ordered_list']==[n['attrs']['order'] for n in walk(review_document(doc,view)) if n['type']=='ordered_list']


def fixed_fixture():
    p=fixture();p['book']['chapters'][0]['document']['content'][3]['attrs'].update(continuePrevious=False,order=7)
    return validate_project(p)


def outline_fixture(continued=False):
    from test_outline_lists import template
    p=fixture() if continued else fixed_fixture()
    rules=template();rules[0]['format']='upper-alpha'
    for n in p['book']['chapters'][0]['document']['content']:
        if n['type']=='ordered_list':
            n['attrs']['listTemplate']=copy.deepcopy(rules)
            if len(n['content'])>1:n['content'][0]['content'][1]['type']='ordered_list'
    return validate_project(p)


def test_native_fixed_list_move_exchange(tmp_path):
    p=fixed_fixture();result=build_export(p,'docx',tmp_path);restored=import_document(Path(result['path']))['document'];validate_moves(restored)
    for view in ('original','final'):
        expected=review_document(p['book']['chapters'][0]['document'],view);actual=review_document(restored,view)
        assert document_text(actual)==document_text(expected)
        lists=[n for n in actual['content'] if n['type']=='ordered_list']
        assert sorted(n['attrs']['order'] for n in lists)==[3,7]
        moved=next(n for n in lists if n['attrs']['order']==3)
        assert moved['content'][0]['content'][1]['attrs']['listStyle']=='square'
        assert moved['content'][0]['content'][0]['content'][0]['marks']==[{'type':'strong'}]


@pytest.mark.parametrize('format',['html','epub','docx'])
def test_moved_outline_template_preserves_markers_and_review(tmp_path,format):
    from test_outline_lists import labels
    p=outline_fixture();doc=p['book']['chapters'][0]['document']
    assert labels(doc)==['C.','C(a)','D.','G.','C.','C(a)','D.']
    restored=import_document(Path(build_export(p,format,tmp_path)['path']))['document']
    for view in ('original','final'):
        assert labels(review_document(restored,view))==labels(review_document(doc,view))
        assert document_text(review_document(restored,view))==document_text(review_document(doc,view))


def test_moved_outline_continuations_ignore_ghost_counts():
    from test_outline_lists import labels
    doc=outline_fixture(True)['book']['chapters'][0]['document'];resolve_list_orders(doc)
    assert labels(doc)==['C.','C(a)','D.','A.','C.','C(a)','D.']
    assert labels(review_document(doc,'original'))==['C.','C(a)','D.','E.']
    assert labels(review_document(doc,'final'))==['A.','C.','C(a)','D.']


def test_native_move_refuses_partial_list_reconstruction():
    from alder.tracked_block_moves import restore_word_list_moves
    node={'type':'paragraph','attrs':{'revisionMove':{'kind':'insertion','stamp':STAMP,'originalId':'item'}},'content':[{'type':'text','text':'Moved'}]}
    doc={'type':'doc','content':[{'type':'bullet_list','content':[{'type':'list_item','content':[node]},{'type':'list_item','content':[{'type':'paragraph'}]}]}]}
    with pytest.raises(ValueError,match='incomplete'):restore_word_list_moves(doc)


def multiparagraph_fixture(outline=False):
    p=outline_fixture() if outline else fixed_fixture()
    for n in p['book']['chapters'][0]['document']['content']:
        if n.get('attrs',{}).get('revisionMove') and n['type']=='ordered_list':
            n['content'][0]['content'].extend([{'type':'paragraph','content':[{'type':'text','text':'Second paragraph','marks':[{'type':'em'}]}]},{'type':'paragraph'}])
            n['content'][0]['content'][1]['content'][0]['content'].append({'type':'paragraph','content':[{'type':'text','text':'Nested continuation'}]})
    return validate_project(p)


@pytest.mark.parametrize('outline',[False,True])
@pytest.mark.parametrize('format',['html','epub','docx'])
def test_multi_paragraph_item_moves_retain_native_item_boundaries(tmp_path,outline,format):
    p=multiparagraph_fixture(outline);source=p['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(p,format,tmp_path)['path']))['document']
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(source,view)
        assert document_text(actual)==document_text(expected)
        listing=next(n for n in actual['content'] if n['type']=='ordered_list' and n['attrs']['order']==3)
        assert len(listing['content'])==2
        first=listing['content'][0]['content'];assert len(first)==4 and first[-1]['type']=='paragraph' and not first[-1].get('content')
        assert len(first[1]['content'][0]['content'])==2
        assert first[2]['content'][0]['marks']==[{'type':'em'}]


@pytest.mark.parametrize('mutation',['orphan','renumbered','invalid_level'])
def test_native_item_boundary_changes_refuse_silent_flattening(tmp_path,mutation):
    from docx import Document
    from docx.oxml.ns import qn
    source=multiparagraph_fixture();source['book']['chapters'][0]['document']=review_document(source['book']['chapters'][0]['document'],'original')
    path=Path(build_export(source,'docx',tmp_path)['path']);word=Document(path)
    continuation=next(p for p in word.paragraphs if p.style.style_id.startswith('AlderListContinuation'))
    if mutation=='orphan':word._element.body.insert(0,continuation._p)
    elif mutation=='renumbered':
        numbered=next(p for p in word.paragraphs if p._p.pPr is not None and p._p.pPr.numPr is not None)
        continuation._p.get_or_add_pPr().append(copy.deepcopy(numbered._p.pPr.numPr))
    else:
        style=continuation.style;style.name=style.name.replace('Continuation1_','Continuation9_')
    word.save(path)
    with pytest.raises(ValueError,match='paragraph boundaries'):import_document(path)


def test_empty_moved_continuation_survives_word_omitting_run_wrapper(tmp_path):
    from docx import Document
    from docx.oxml.ns import qn
    p=multiparagraph_fixture();source=p['book']['chapters'][0]['document']
    path=Path(build_export(p,'docx',tmp_path)['path']);word=Document(path)
    for paragraph in word.paragraphs:
        for wrapper in list(paragraph._p):
            if wrapper.tag in (qn('w:moveFrom'),qn('w:moveTo')) and not len(wrapper):paragraph._p.remove(wrapper)
    word.save(path);restored=import_document(path)['document']
    for view in ('original','final'):assert document_text(review_document(restored,view))==document_text(review_document(source,view))
