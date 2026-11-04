from copy import deepcopy
from pathlib import Path
import pytest
from alder.models import create_project,validate_project,document_text
from alder.document_revisions import review_document,revision_summary
from alder.document_comments import walk
from alder.publishing import build_export,import_document

STAMP={'id':'list_format','author':'List reviewer','date':'2026-11-04T01:00:00Z'}

def fixture():
    project=create_project(template='blank');project['settings'].update(documentKind='docx',includeTitle=False)
    blocks=[]
    for kind,old,new in [('ordered_list',{'order':3,'listStyle':'decimal'},{'order':7,'listStyle':'upper-roman'}),('bullet_list',{'listStyle':'disc'},{'listStyle':'square'})]:
        before,after={'type':kind,'attrs':old},{'type':kind,'attrs':new}
        log={'base':before,'records':[{'stamp':{**STAMP,'id':kind},'status':'pending','before':before,'after':after}]}
        items=[{'type':'list_item','content':[{'type':'paragraph','content':[{'type':'text','text':f'{kind} item {i}'}]}]} for i in range(3)]
        items[1]['content'].append({'type':'paragraph','content':[{'type':'text','text':'Continuation wording'}]})
        blocks.extend([{'type':kind,'attrs':{**new,'revisionProperties':log},'content':items},{'type':'paragraph','content':[{'type':'text','text':'Between lists'}]}])
    project['book']={'version':1,'chapters':[{'id':'main','title':'Lists','include':True,'document':{'type':'doc','content':blocks}}]}
    return validate_project(project)

def appearances(document):
    return [(n['type'],n.get('attrs',{}).get('order',1) if n['type']=='ordered_list' else None,n.get('attrs',{}).get('listStyle') or ('decimal' if n['type']=='ordered_list' else 'disc'),bool(n.get('attrs',{}).get('continuePrevious')),n.get('attrs',{}).get('listTemplate')) for n in walk(document) if n['type'] in ('ordered_list','bullet_list')]

def continuation_fixture(change='start'):
    project=fixture();doc=project['book']['chapters'][0]['document'];first=review_document(doc,'original')['content'][0]
    last=deepcopy(first);last['attrs'].update(order=6,continuePrevious=True)
    for n in walk(last):
        n.get('attrs',{}).pop('blockId',None)
        if n['type']=='text':n['text']='Later '+n['text']
    doc['content']=[first,doc['content'][1],last]
    target=last if change in ('restart','continue') else first
    if change=='continue':target['attrs'].update(continuePrevious=False,order=12)
    before={'type':'ordered_list','attrs':{k:deepcopy(v) for k,v in target['attrs'].items() if k!='blockId'}};after=deepcopy(before)
    if change=='start':after['attrs']['order']=7
    elif change=='marker':after['attrs']['listStyle']='upper-roman'
    else:after['attrs'].update(order=12 if change=='restart' else 6,continuePrevious=change=='continue')
    target['attrs']={**after['attrs'],'revisionProperties':{'base':before,'records':[{'stamp':STAMP,'status':'pending','before':before,'after':after}]}}
    return validate_project(project)

@pytest.mark.parametrize('change',['start','marker','restart','continue'])
@pytest.mark.parametrize('format',['html','epub','docx'])
def test_continued_numbering_retains_dependent_original_and_final_views(tmp_path,change,format):
    project=continuation_fixture(change);source=project['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        actual,expected=review_document(restored,view),review_document(source,view)
        assert document_text(actual)==document_text(expected)
        assert appearances(actual)==appearances(expected)

@pytest.mark.parametrize('format',['html','epub','docx'])
@pytest.mark.parametrize('compare',[False,True])
def test_list_formatting_and_comparison_keep_numbering_and_both_decisions(tmp_path,format,compare):
    project=fixture();source=project['book']['chapters'][0]['document']
    if compare:
        from alder.document_comparison import compare_documents
        source=compare_documents(review_document(source,'original'),review_document(source,'final'),STAMP['author'],STAMP['date']);project['book']['chapters'][0]['document']=source
    restored=import_document(Path(build_export(validate_project(project),format,tmp_path)['path']))['document']
    assert len(revision_summary(restored))==2
    for view in ('original','final'):
        actual,expected=review_document(restored,view),review_document(source,view)
        assert document_text(actual)==document_text(expected)
        assert appearances(actual)==appearances(expected)

@pytest.mark.parametrize('damage',['partial','levels','paragraph','kind'])
def test_native_partial_or_combined_numbering_changes_are_not_flattened(tmp_path,damage):
    from docx import Document
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    project=fixture();path=Path(build_export(project,'docx',tmp_path)['path']);word=Document(path)
    props=word.paragraphs[1]._p.pPr;change=props.find(qn('w:pPrChange'));old=change.find(qn('w:pPr'))
    if damage=='partial':props.remove(change)
    elif damage=='levels':old.find(qn('w:numPr')).find(qn('w:ilvl')).set(qn('w:val'),'1')
    elif damage=='kind':old.find(qn('w:numPr')).find(qn('w:numId')).set(qn('w:val'),word.paragraphs[-2]._p.pPr.numPr.numId.get(qn('w:val')))
    else:
        alignment=OxmlElement('w:jc');alignment.set(qn('w:val'),'right');old.append(alignment)
    word.save(path)
    with pytest.raises(ValueError):import_document(path)

def test_original_continuation_preview_recomputes_after_list_formatting():
    source=continuation_fixture('start')['book']['chapters'][0]['document']
    assert review_document(source,'original')['content'][-1]['attrs']['order']==6
    assert review_document(source,'final')['content'][-1]['attrs']['order']==10

@pytest.mark.parametrize('change',['start','marker','restart','continue'])
def test_comparison_does_not_treat_derived_list_numbers_as_an_independent_edit(tmp_path,change):
    from alder.document_comparison import compare_documents
    project=continuation_fixture(change);source=project['book']['chapters'][0]['document']
    old,new=review_document(source,'original'),review_document(source,'final')
    compared=compare_documents(old,new,STAMP['author'],STAMP['date'])
    assert len(revision_summary(compared))==1
    project['book']['chapters'][0]['document']=compared
    restored=import_document(Path(build_export(validate_project(project),'docx',tmp_path)['path']))['document']
    for view,expected in [('original',old),('final',new)]:assert appearances(review_document(restored,view))==appearances(expected)

def test_list_format_and_item_boundary_review_are_not_partially_exported(tmp_path):
    from test_tracked_list_items import fixture as item_fixture
    project=continuation_fixture();doc=project['book']['chapters'][0]['document']
    doc['content']+=item_fixture()['book']['chapters'][0]['document']['content']
    with pytest.raises(ValueError,match='item boundaries'):build_export(validate_project(project),'docx',tmp_path)
