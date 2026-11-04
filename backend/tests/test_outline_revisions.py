from copy import deepcopy
from pathlib import Path
import pytest
from alder.models import validate_project,document_text
from alder.document_revisions import review_document,revision_summary
from alder.document_comments import walk
from alder.publishing import build_export,import_document
from test_outline_lists import fixture as outline_fixture,labels
from test_list_revisions import STAMP

def fixture():
    project=outline_fixture();doc=project['book']['chapters'][0]['document'];doc['content']=doc['content'][:1];root=doc['content'][0]
    before={'type':root['type'],'attrs':{k:deepcopy(v) for k,v in root['attrs'].items() if k!='blockId'}};after=deepcopy(before)
    after['attrs']['order']=7;template=after['attrs']['listTemplate']
    template[0].update(format='upper-roman',pattern='Article %1.',indent=30,hanging=24)
    template[1].update(pattern='%1-%2.',indent=60,hanging=22)
    template[2].update(restart=2,pattern='%1/%2/%3',indent=80,hanging=15)
    root['attrs'].update(**after['attrs'],revisionProperties={'base':before,'records':[{'stamp':STAMP,'status':'pending','before':before,'after':after}]})
    for node in walk(doc):
        if node['type']=='paragraph':node.setdefault('attrs',{}).update(leftIndent=2,firstLineIndent=1)
    return validate_project(project)

def assert_appearance(actual,expected):
    assert labels(actual)==labels(expected)
    left=[n for n in walk(actual) if n['type']=='paragraph'];right=[n for n in walk(expected) if n['type']=='paragraph']
    assert len(left)==len(right)
    for a,b in zip(left,right):
        for key in ('leftIndent','firstLineIndent'):assert (a.get('attrs',{}).get(key) or 0)==pytest.approx(b.get('attrs',{}).get(key) or 0,abs=.051)
    a=[n['attrs']['listTemplate'] for n in walk(actual) if n.get('attrs',{}).get('listTemplate')];b=[n['attrs']['listTemplate'] for n in walk(expected) if n.get('attrs',{}).get('listTemplate')]
    assert len(a)==len(b)
    for before,after in zip(a,b):
        for level,(x,y) in enumerate(zip(before,after)):
            for key in ('indent','hanging','pattern','format','restart',*(['start'] if level else [])):assert x[key]==y[key],(level,key,x[key],y[key])

def continuation_fixture(change='template'):
    project=outline_fixture();doc=project['book']['chapters'][0]['document']
    updated=fixture()['book']['chapters'][0]['document']['content'][0]['attrs']['listTemplate']
    roots=[doc['content'][0],doc['content'][2]]
    for index,root in enumerate(roots):
        if change=='start' and index==1 or change=='restart' and index==0:continue
        before={'type':root['type'],'attrs':{k:deepcopy(v) for k,v in root['attrs'].items() if k!='blockId'}};after=deepcopy(before)
        if change=='template':after['attrs']['listTemplate']=deepcopy(updated)
        elif change=='start':after['attrs']['order']=7
        else:after['attrs'].update(order=11,continuePrevious=False)
        root['attrs'].update(**after['attrs'],revisionProperties={'base':before,'records':[{'stamp':STAMP,'status':'pending','before':before,'after':after}]})
    return validate_project(project)

@pytest.mark.parametrize('change',['template','start','restart'])
@pytest.mark.parametrize('format',['html','epub','docx'])
@pytest.mark.parametrize('compare',[False,True])
def test_outline_review_keeps_all_nine_continuation_counters(tmp_path,change,format,compare):
    project=continuation_fixture(change);source=project['book']['chapters'][0]['document']
    if compare:
        from alder.document_comparison import compare_documents
        source=compare_documents(review_document(source,'original'),review_document(source,'final'),STAMP['author'],STAMP['date']);project['book']['chapters'][0]['document']=source
        assert len(revision_summary(source))==1
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        actual,expected=review_document(restored,view),review_document(source,view)
        assert document_text(actual)==document_text(expected)
        assert_appearance(actual,expected)

@pytest.mark.parametrize('format',['html','epub','docx'])
@pytest.mark.parametrize('compare',[False,True])
def test_outline_format_review_keeps_patterns_indentation_restarts_and_wording(tmp_path,format,compare):
    project=fixture();source=project['book']['chapters'][0]['document']
    if compare:
        from alder.document_comparison import compare_documents
        source=compare_documents(review_document(source,'original'),review_document(source,'final'),STAMP['author'],STAMP['date']);project['book']['chapters'][0]['document']=source
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        actual,expected=review_document(restored,view),review_document(source,view)
        assert document_text(actual)==document_text(expected)
        assert_appearance(actual,expected)

@pytest.mark.parametrize('damage',['block-object'])
def test_pending_outline_boundaries_need_complete_native_representation(tmp_path,damage):
    project=fixture();root=project['book']['chapters'][0]['document']['content'][0];log=root['attrs']['revisionProperties']
    if damage=='ordinary-conversion':log['base']['attrs'].pop('listTemplate');log['records'][0]['before']['attrs'].pop('listTemplate',None)
    elif damage=='block-object':root['content'][0]['content'].append({'type':'blockquote','content':[{'type':'paragraph','content':[{'type':'text','text':'Extra wording'}]}]})
    with pytest.raises(ValueError):build_export(validate_project(project),'docx',tmp_path)


def kind_fixture(level=1, reverse=False, continued=False):
    from alder.outline_lists import outline_layout
    from alder.document_comparison import compare_documents
    project=outline_fixture();base=project['book']['chapters'][0]['document']
    if not continued:base['content']=base['content'][:1]
    for record in outline_layout(base):
        if reverse:
            record['template'][level].update(format='square',pattern='▪')
            if record['level']==level:record['node']['type']='bullet_list'
    revised=deepcopy(base)
    for record in outline_layout(revised):
        rule=record['template'][level]
        rule.update(format='upper-alpha' if reverse else 'square',pattern=f'%{level+1}.' if reverse else '▪')
        if record['level']==level:record['node']['type']='ordered_list' if reverse else 'bullet_list'
    source=compare_documents(base,revised,STAMP['author'],STAMP['date'])
    project['book']['chapters'][0]['document']=source
    return validate_project(project)


@pytest.mark.parametrize('level',[0,1])
@pytest.mark.parametrize('reverse',[False,True])
@pytest.mark.parametrize('continued',[False,True])
@pytest.mark.parametrize('format',['html','epub','docx'])
def test_outline_kind_conversion_keeps_one_review_with_all_dependent_levels(tmp_path,level,reverse,continued,format):
    project=kind_fixture(level,reverse,continued);source=project['book']['chapters'][0]['document']
    assert len(revision_summary(source))==1
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        actual,expected=review_document(restored,view),review_document(source,view)
        assert document_text(actual)==document_text(expected)
        assert_appearance(actual,expected)
        assert [n['type'] for n in walk(actual) if n['type'] in ('ordered_list','bullet_list')]==[n['type'] for n in walk(expected) if n['type'] in ('ordered_list','bullet_list')]

def test_native_outline_property_change_cannot_discard_independent_prose_indentation(tmp_path):
    from docx import Document
    from docx.oxml.ns import qn
    project=fixture();path=Path(build_export(project,'docx',tmp_path)['path']);word=Document(path)
    old=word.paragraphs[0]._p.pPr.find(qn('w:pPrChange')).find(qn('w:pPr'));old.find(qn('w:ind')).set(qn('w:left'),'1234');word.save(path)
    with pytest.raises(ValueError,match='list formatting'):import_document(path)

def test_native_sequence_keeps_independent_authorship_explicit(tmp_path):
    project=continuation_fixture();second=project['book']['chapters'][0]['document']['content'][2]
    second['attrs']['revisionProperties']['records'][0]['stamp']={**STAMP,'id':'independent'}
    with pytest.raises(ValueError,match='independent changes'):build_export(project,'docx',tmp_path)

def paragraph_fixture():
    project=continuation_fixture();doc=project['book']['chapters'][0]['document']
    for index,listing in enumerate([n for n in walk(doc) if n['type']=='ordered_list']):
        listing['content'][0]['content'].insert(1,{'type':'paragraph','attrs':{'leftIndent':5,'firstLineIndent':3},'content':[{'type':'text','text':f'Continuation wording {index}'}]})
    return validate_project(project)

@pytest.mark.parametrize('format',['html','epub','docx'])
@pytest.mark.parametrize('compare',[False,True])
def test_outline_format_review_retains_continuation_paragraph_indents(tmp_path,format,compare):
    project=paragraph_fixture();source=project['book']['chapters'][0]['document']
    if compare:
        from alder.document_comparison import compare_documents
        source=compare_documents(review_document(source,'original'),review_document(source,'final'),STAMP['author'],STAMP['date']);project['book']['chapters'][0]['document']=source
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        actual,expected=review_document(restored,view),review_document(source,view)
        assert document_text(actual)==document_text(expected)
        assert_appearance(actual,expected)

def test_native_continuation_does_not_hide_an_independent_paragraph_indent(tmp_path):
    from docx import Document
    from docx.oxml.ns import qn
    project=paragraph_fixture();path=Path(build_export(project,'docx',tmp_path)['path']);word=Document(path)
    paragraph=next(p for p in word.paragraphs if p.text.startswith('Continuation wording'))
    old=paragraph._p.pPr.find(qn('w:pPrChange')).find(qn('w:pPr'));old.find(qn('w:ind')).set(qn('w:left'),'1234');word.save(path)
    with pytest.raises(ValueError,match='continuation revision'):import_document(path)
