from copy import deepcopy
from pathlib import Path
import pytest
from alder.models import create_project,validate_project,document_text
from alder.document_revisions import review_document,revision_summary
from alder.document_comments import walk
from alder.publishing import build_export,import_document

STAMP={'id':'cell_format','author':'Cell reviewer','date':'2026-11-04T00:00:00Z'}
def fixture():
    project=create_project(template='blank');project['settings'].update(documentKind='docx',includeTitle=False)
    before={'type':'table_cell','attrs':{'colspan':1,'rowspan':1,'paddingTop':5.25,'paddingBottom':5.25,'paddingLeft':5.25,'paddingRight':5.25,'verticalAlign':'top','borderWidth':.75,'borderColor':'#999999'}}
    after=deepcopy(before);after['attrs'].update(background='#d6e2ef',paddingTop=12,paddingBottom=9,paddingLeft=15,verticalAlign='bottom',borderWidth=1.5,borderColor='#203854')
    cells=[]
    for text in ('Left wording','Right wording'):
        log={'base':deepcopy(before),'records':[{'stamp':deepcopy(STAMP),'status':'pending','before':deepcopy(before),'after':deepcopy(after)}]}
        cells.append({'type':'table_cell','attrs':{**deepcopy(after['attrs']),'revisionProperties':log},'content':[{'type':'paragraph','content':[{'type':'text','text':text}]}]})
    document={'type':'doc','content':[{'type':'table','content':[{'type':'table_row','content':cells}]}]}
    project['book']={'version':1,'chapters':[{'id':'main','title':'Cells','include':True,'document':document}]}
    return validate_project(project)


def merged_fixture(horizontal=False):
    project=fixture();table=project['book']['chapters'][0]['document']['content'][0]
    first,right=table['content'][0]['content']
    for attrs in [first['attrs'],first['attrs']['revisionProperties']['base']['attrs'],*[r[side]['attrs'] for r in first['attrs']['revisionProperties']['records'] for side in ('before','after')]]:
        attrs['rowspan']=2;attrs['colspan']=2 if horizontal else 1
    lower=deepcopy(right);lower['attrs'].pop('blockId',None);lower['content']=[{'type':'paragraph','content':[{'type':'text','text':'Lower right wording'}]}]
    table['content'].append({'type':'table_row','content':[lower]})
    if horizontal:
        bottom=[]
        for index in range(3):
            cell=deepcopy(right);cell['attrs'].pop('blockId',None);cell['content']=[{'type':'paragraph','content':[{'type':'text','text':f'Bottom cell {index+1}'}]}];bottom.append(cell)
        table['content'].append({'type':'table_row','content':bottom})
    from test_tracked_comment_moves import THREAD
    for paragraph,edge in ((first['content'][0],'start'),(lower['content'][0],'end')):
        paragraph['content'].insert(0 if edge=='start' else len(paragraph['content']),{'type':'comment_anchor','attrs':{'threadId':'merged_comment','edge':edge,'thread':deepcopy(THREAD)}})
    return validate_project(project)


@pytest.mark.parametrize('horizontal',[False,True])
@pytest.mark.parametrize('format',['html','epub','docx'])
@pytest.mark.parametrize('compare',[False,True])
def test_merged_cell_appearance_review_retains_one_grid_and_both_views(tmp_path,horizontal,format,compare):
    project=merged_fixture(horizontal);source=project['book']['chapters'][0]['document']
    if compare:
        from alder.document_comparison import compare_documents
        source=compare_documents(review_document(source,'original'),review_document(source,'final'),STAMP['author'],STAMP['date']);project['book']['chapters'][0]['document']=source
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    assert len(revision_summary(restored))==len(revision_summary(source))
    for view in ('original','final'):
        actual,expected=review_document(restored,view),review_document(source,view)
        assert document_text(actual)==document_text(expected)
        anchors=[n['attrs'] for n in walk(actual) if n['type']=='comment_anchor']
        assert [a['edge'] for a in anchors]==['start','end']
        assert anchors[0]['thread']==anchors[1]['thread'] and anchors[0]['thread']['resolved']
        left=[n for n in walk(actual) if n['type']=='table_cell'];right=[n for n in walk(expected) if n['type']=='table_cell']
        assert len(left)==len(right)
        for a,b in zip(left,right):
            for key in ('background','paddingTop','paddingBottom','paddingLeft','paddingRight','verticalAlign','borderWidth','borderColor','colspan','rowspan'):
                assert a['attrs'].get(key)==b['attrs'].get(key),(view,key)


@pytest.mark.parametrize('damage',['missing','author','old-shade','merge'])
def test_native_partial_merged_cell_history_is_refused(tmp_path,damage):
    from docx import Document
    from docx.oxml.ns import qn
    project=merged_fixture();path=Path(build_export(project,'docx',tmp_path)['path']);word=Document(path)
    cell=word.tables[0].rows[1]._tr.tc_lst[0];props=cell.tcPr;change=props.find(qn('w:tcPrChange'))
    assert change is not None
    if damage=='missing':props.remove(change)
    elif damage=='author':change.set(qn('w:author'),'Another reviewer')
    elif damage=='old-shade':change[0].find(qn('w:tcBorders'))[0].set(qn('w:color'),'000000')
    else:change[0].find(qn('w:vMerge')).set(qn('w:val'),'restart')
    word.save(path)
    with pytest.raises(ValueError):import_document(path)


def test_pending_cell_review_refuses_unused_grid_columns_word_would_consolidate(tmp_path):
    project=merged_fixture(True);project['book']['chapters'][0]['document']['content'][0]['content'].pop()
    with pytest.raises(ValueError,match='unused internal table columns'):build_export(project,'docx',tmp_path)


def test_pending_cell_formatting_fixes_native_grid_in_both_property_views(tmp_path):
    from docx import Document
    from docx.oxml.ns import qn
    word=Document(build_export(merged_fixture(True),'docx',tmp_path)['path'])
    props=word.tables[0]._tbl.tblPr
    assert props.find(qn('w:tblLayout')).get(qn('w:type'))=='fixed'
    assert props.find(qn('w:tblPrChange'))[0].find(qn('w:tblLayout')).get(qn('w:type'))=='fixed'

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_cell_appearance_review_exchange_keeps_content_grid_and_both_decisions(tmp_path,format):
    project=fixture();source=project['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(source,view)
        assert document_text(actual)==document_text(expected)
        for a,b in zip([n for n in walk(actual) if n['type']=='table_cell'],[n for n in walk(expected) if n['type']=='table_cell']):
            for key in ('background','paddingTop','paddingBottom','paddingLeft','paddingRight','verticalAlign','borderWidth','borderColor','colspan','rowspan'):
                assert a['attrs'].get(key)==b['attrs'].get(key),(view,key,a['attrs'],b['attrs'])
    assert {r['author'] for r in revision_summary(restored)}=={'Cell reviewer'}

@pytest.mark.parametrize('damage',['grid','header','overlap','unequal-padding'])
def test_unsafe_cell_formatting_refuses_before_export(tmp_path,damage):
    project=fixture();row=project['book']['chapters'][0]['document']['content'][0]['content'][0];cell=row['content'][0];log=cell['attrs']['revisionProperties']
    if damage=='grid':log['records'][0]['after']['attrs']['colspan']=2
    elif damage=='header':log['records'][0]['after']['type']='table_header'
    elif damage=='overlap':
        other=deepcopy(log['records'][0]);other['stamp']['id']='second';log['records'].append(other)
    elif damage=='unequal-padding':row['content'][1]['attrs'].pop('revisionProperties');row['content'][1]['attrs']['paddingTop']=3
    with pytest.raises(ValueError):build_export(validate_project(project),'docx',tmp_path)

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_comparison_retains_cell_appearance_and_nested_wording_changes(tmp_path,format):
    from alder.document_comparison import compare_documents
    project=fixture();source=project['book']['chapters'][0]['document']
    before,after=review_document(source,'original'),review_document(source,'final')
    after['content'][0]['content'][0]['content'][1]['content'][0]['content'][0]['text']='Changed right wording'
    project['book']['chapters'][0]['document']=compare_documents(before,after,'Comparison',STAMP['date'])
    result=import_document(Path(build_export(validate_project(project),format,tmp_path)['path']))['document']
    for view,expected in [('original',before),('final',after)]:
        actual=review_document(result,view);assert document_text(actual)==document_text(expected)
        for a,b in zip([n for n in walk(actual) if n['type']=='table_cell'],[n for n in walk(expected) if n['type']=='table_cell']):
            assert a['attrs'].get('background')==b['attrs'].get('background')

@pytest.mark.parametrize('damage',[None,'width','row-properties','border-spacing'])
def test_native_margin_grid_normalization_is_bounded_to_equivalent_cells(tmp_path,damage):
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    project=fixture();path=Path(build_export(project,'docx',tmp_path)['path']);word=Document(path);table=word.tables[0]
    oldgrid=table._tbl.tblGrid.find(qn('w:tblGridChange'))[0]
    original_widths=[int(c.get(qn('w:w'))) for c in oldgrid];oldgrid.clear()
    for width in [195,*[part for width in original_widths for part in (width-195,195)]]:
        column=OxmlElement('w:gridCol');column.set(qn('w:w'),str(width));oldgrid.append(column)
    oldrow=table.rows[0]._tr.trPr.find(qn('w:trPrChange'))[0]
    before=OxmlElement('w:gridBefore');before.set(qn('w:val'),'1');oldrow.insert(0,before)
    for cell in table.rows[0].cells:
        old=cell._tc.tcPr.find(qn('w:tcPrChange'))[0];span=OxmlElement('w:gridSpan');span.set(qn('w:val'),'2');old.append(span)
    if damage=='width':oldgrid[1].set(qn('w:w'),str(original_widths[0]-194))
    elif damage=='row-properties':oldrow.append(OxmlElement('w:tblHeader'))
    elif damage=='border-spacing':table.rows[0].cells[0]._tc.tcPr.find(qn('w:tcBorders'))[0].set(qn('w:space'),'2')
    word.save(path)
    if damage:
        with pytest.raises(ValueError,match='grid|properties'):import_document(path)
    else:
        restored=import_document(path)['document']
        for view in ('original','final'):
            result=review_document(restored,view);assert document_text(result)==document_text(project['book']['chapters'][0]['document'])
            assert [n['attrs']['colspan'] for n in walk(result) if n['type']=='table_cell']==[1,1]
