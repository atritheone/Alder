from copy import deepcopy
from pathlib import Path
import pytest
from alder.models import create_project,validate_project,document_text
from alder.document_revisions import review_document,revision_summary
from alder.document_comments import walk
from alder.publishing import build_export,import_document

def fixture(kind='ordinary',comments=False):
    from test_outline_revisions import paragraph_fixture
    from test_cell_revisions import fixture as cell_fixture
    table=review_document(cell_fixture()['book']['chapters'][0]['document'],'original')['content'][0]
    table['content'][0]['content'][0]['attrs']['rowspan']=2
    lower=deepcopy(table['content'][0]['content'][1]);lower['content'][0]['content'][0]['text']='Lower wording'
    table['content'].append({'type':'table_row','content':[lower]})
    p=lambda text:{'type':'paragraph','content':[{'type':'text','text':text}]}
    listing={'type':'ordered_list','attrs':{'order':3},'content':[{'type':'list_item','content':[p('Item before table'),table,p('Item after table')]},{'type':'list_item','content':[p('Last item'),deepcopy(table)]}]}
    for node in walk(listing):node.get('attrs',{}).pop('blockId',None)
    project=create_project(template='blank');project['settings'].update(documentKind='docx',includeTitle=False)
    content=[listing]
    if kind=='cell':content=[{'type':'table','content':[{'type':'table_row','content':[{'type':'table_cell','content':[listing]}]}]}]
    elif kind=='review':
        project=paragraph_fixture();content=project['book']['chapters'][0]['document']['content']
        content[-1]['content'][-1]['content'].extend([deepcopy(table),p('Item after table')])
    project['book']={'version':1,'chapters':[{'id':'main','title':'List tables','include':True,'document':{'type':'doc','content':content}}]}
    if comments:
        from test_tracked_comment_moves import THREAD
        item,table=next((item,child) for item in walk(project['book']['chapters'][0]['document']) if item['type']=='list_item' for child in item['content'] if child['type']=='table')
        last=[n for n in walk(table) if n['type']=='paragraph'][-1]
        for paragraph,edge in ((item['content'][0],'start'),(last,'end')):
            paragraph['content'].insert(0 if edge=='start' else len(paragraph['content']),{'type':'comment_anchor','attrs':{'threadId':'list_table_comment','edge':edge,'thread':deepcopy(THREAD)}})
    return validate_project(project)

def structure(node):
    spans=tuple(node.get('attrs',{}).get(k,1) for k in ('colspan','rowspan')) if node['type'] in ('table_cell','table_header') else None
    return (node['type'],node.get('text',''),spans,tuple(structure(c) for c in node.get('content',[])))

@pytest.mark.parametrize('kind',['ordinary','cell','review'])
@pytest.mark.parametrize('format',['html','epub','docx'])
@pytest.mark.parametrize('comments',[False,True])
def test_list_tables_keep_their_item_membership(tmp_path,kind,format,comments):
    project=fixture(kind,comments);source=project['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    assert len(revision_summary(restored))==len(revision_summary(source))
    for view in ('original','final'):
        actual,expected=review_document(restored,view),review_document(source,view)
        assert document_text(actual)==document_text(expected)
        assert structure(actual)==structure(expected)

@pytest.mark.parametrize('damage',['level','content','lock','partial-rows','no-parent'])
def test_incomplete_list_table_boundaries_are_not_flattened(tmp_path,damage):
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    project=fixture();path=Path(build_export(project,'docx',tmp_path)['path']);word=Document(path)
    wrapper=next(n for n in word.element.body if n.tag==qn('w:sdt'));props=wrapper.find(qn('w:sdtPr'));body=wrapper.find(qn('w:sdtContent'))
    if damage=='level':props.find(qn('w:tag')).set(qn('w:val'),'AlderListTable:8')
    elif damage=='content':body.append(OxmlElement('w:p'))
    elif damage=='lock':lock=OxmlElement('w:lock');lock.set(qn('w:val'),'sdtLocked');props.append(lock)
    elif damage=='no-parent':word.element.body.remove(word.paragraphs[0]._p)
    else:
        table=body[0];position=word.element.body.index(wrapper);rows=list(table.findall(qn('w:tr')))
        word.element.body.remove(wrapper);body.remove(table);word.element.body.insert(position,table);body.append(rows[0]);table.append(wrapper)
    word.save(path)
    with pytest.raises(ValueError):import_document(path)

@pytest.mark.parametrize('format',['html','epub','docx'])
def test_comparison_keeps_list_tables_and_spanning_comments(tmp_path,format):
    from alder.document_comparison import compare_documents
    from test_list_revisions import STAMP
    project=fixture('review',True);source=project['book']['chapters'][0]['document']
    old,new=review_document(source,'original'),review_document(source,'final')
    compared=compare_documents(old,new,STAMP['author'],STAMP['date']);project['book']['chapters'][0]['document']=compared
    restored=import_document(Path(build_export(validate_project(project),format,tmp_path)['path']))['document']
    for view,expected in [('original',old),('final',new)]:assert structure(review_document(restored,view))==structure(expected)
