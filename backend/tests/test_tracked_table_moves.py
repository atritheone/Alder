import copy
from pathlib import Path
import pytest
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from alder.models import create_project, validate_project, document_text
from alder.document_revisions import review_document
from alder.tracked_moves import validate_moves
from alder.publishing import build_export, import_document

def fixture():
    p=create_project(template='blank');p['name']='Tracked table section';p['settings'].update(documentKind='docx',includeTitle=False)
    def para(text):return {'type':'paragraph','content':[{'type':'text','text':text,'marks':[{'type':'strong'}]}]}
    def cell(text,header=False,**attrs):return {'type':'table_header' if header else 'table_cell','attrs':attrs,'content':[para(text)]}
    table={'type':'table','attrs':{'blockId':'grid','align':'center'},'content':[
        {'type':'table_row','content':[cell('Merged header',True,colspan=2,colwidth=[140,180],background='#ddeeff')]},
        {'type':'table_row','attrs':{'minHeight':40,'allowSplit':True},'content':[cell('Left cell',colwidth=[140],verticalAlign='bottom'),cell('Right cell',colwidth=[180])]},
    ]}
    heading={'type':'heading','attrs':{'level':1,'blockId':'heading'},'content':[{'type':'text','text':'Moved section'}]}
    caption={'type':'paragraph','attrs':{'blockId':'caption','captionLabel':'Table','captionTargetId':'grid'},'content':[{'type':'text','text':'Table '},{'type':'sequence','attrs':{'sequenceName':'Table','blockId':'number'},'content':[{'type':'text','text':'1'}]},{'type':'text','text':' Attached caption'}]}
    sides=[]
    for kind in ('deletion','insertion'):
        side=copy.deepcopy([heading,table,caption])
        for part,n in enumerate(side):
            a=n['attrs'];a['revisionMove']={'kind':kind,'stamp':{'id':'table_move','author':'Reviewer','date':'2026-11-04T00:00:00Z','move':True},'originalId':a['blockId'],'part':part,'count':3}
            if kind=='deletion':a['blockId']+='_ghost'
        if kind=='deletion':
            side[2]['attrs']['captionTargetId']='grid_ghost'
            side[2]['content'][1]['attrs']['blockId']='number_ghost'
        sides.append(side)
    p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':{'type':'doc','content':[*sides[0],para('Other section'),*sides[1]]}}]}
    return validate_project(p)


def nested_fixture(last=False):
    p=fixture()
    for n in p['book']['chapters'][0]['document']['content']:
        if n['type']!='table':continue
        nested={'type':'table','attrs':{'align':'right'},'content':[{'type':'table_row','content':[{'type':'table_cell','attrs':{'colwidth':[90],'paddingLeft':8},'content':[{'type':'paragraph','content':[{'type':'text','text':'Nested first'}]}]},{'type':'table_cell','attrs':{'colwidth':[90]},'content':[{'type':'paragraph','content':[{'type':'text','text':'Nested last'}]}]}]}]}
        children=n['content'][1]['content'][1]['content']
        children.insert(len(children) if last else 0,nested)
    return validate_project(p)


def rowspan_fixture():
    p=fixture()
    for n in p['book']['chapters'][0]['document']['content']:
        if n['type']!='table':continue
        n['content'][1]['content'][0]['attrs']['rowspan']=2
        n['content'].append({'type':'table_row','content':[{'type':'table_cell','attrs':{'colwidth':[180]},'content':[{'type':'paragraph','content':[{'type':'text','text':'Final cell'}]}]}]})
    return validate_project(p)


@pytest.mark.parametrize('format',['html','epub','docx'])
@pytest.mark.parametrize('nested',[False,True,'last'])
def test_table_move_exchange_retains_grid_and_caption(tmp_path,format,nested):
    p=nested_fixture(nested=='last') if nested else fixture();source=p['book']['chapters'][0]['document'];validate_moves(source)
    restored=import_document(Path(build_export(p,format,tmp_path)['path']))['document'];validate_moves(restored)
    for view in ('original','final'):
        doc=review_document(restored,view)
        assert document_text(doc)==document_text(review_document(source,view))
        table=next(n for n in doc['content'] if n['type']=='table')
        caption=next(n for n in doc['content'] if n.get('attrs',{}).get('captionLabel'))
        assert caption['attrs']['captionTargetId']==table['attrs']['blockId']
        assert table['content'][0]['content'][0]['attrs']['colspan']==2
        assert table['content'][0]['content'][0]['attrs']['background']=='#ddeeff'
        assert table['content'][1]['attrs']['allowSplit'] is True
        assert table['content'][1]['content'][0]['attrs']['verticalAlign']=='bottom'
        assert table['content'][1]['content'][0]['content'][0]['content'][0]['marks']==[{'type':'strong'}]
        if nested:
            contents=table['content'][1]['content'][1]['content']
            assert len(contents)==2
            inner=contents[-1 if nested=='last' else 0]
            assert inner['type']=='table' and inner['attrs']['align']=='right'
            assert document_text(inner)=='Nested first\tNested last'


def test_nested_scaffold_cannot_discard_new_word_content(tmp_path):
    path=Path(build_export(nested_fixture(True),'docx',tmp_path)['path']);word=Document(path)
    scaffold=word.tables[-1].rows[-1].cells[-1].paragraphs[-1]
    wrapper=scaffold._p.find(qn('w:moveTo'))
    run=OxmlElement('w:r');text=OxmlElement('w:t');text.text='Authored in Word';run.append(text);wrapper.append(run)
    word.save(path)
    with pytest.raises(ValueError):import_document(path)


@pytest.mark.parametrize('remove_bookmarks',[False,True])
def test_nested_scaffold_survives_word_removing_empty_move_wrappers(tmp_path,remove_bookmarks):
    source=nested_fixture(True);path=Path(build_export(source,'docx',tmp_path)['path']);word=Document(path)
    for table in word.tables:
        scaffold=table.rows[-1].cells[-1].paragraphs[-1]._p
        wrapper=next(n for n in scaffold if n.tag in (qn('w:moveFrom'),qn('w:moveTo')))
        for child in list(wrapper):wrapper.addprevious(child)
        scaffold.remove(wrapper)
        if remove_bookmarks:
            for child in list(scaffold):
                if child.tag in (qn('w:bookmarkStart'),qn('w:bookmarkEnd')):scaffold.remove(child)
    word.save(path);restored=import_document(path)['document']
    for view in ('original','final'):assert document_text(review_document(restored,view))==document_text(review_document(source['book']['chapters'][0]['document'],view))


@pytest.mark.parametrize('format',['html','epub','docx'])
def test_vertical_merged_move_retains_rows_and_each_word(tmp_path,format):
    source=rowspan_fixture();restored=import_document(Path(build_export(source,format,tmp_path)['path']))['document']
    for view in ('original','final'):
        reviewed=review_document(restored,view)
        assert document_text(reviewed)==document_text(review_document(source['book']['chapters'][0]['document'],view))
        table=next(n for n in reviewed['content'] if n['type']=='table')
        assert table['content'][1]['content'][0]['attrs']['rowspan']==2
        assert len(table['content'][2]['content'])==1


def test_reviewed_table_views_export(tmp_path):
    p=fixture()
    for view in ('original','final'):
        clean=copy.deepcopy(p);clean['book']['chapters'][0]['document']=review_document(p['book']['chapters'][0]['document'],view)
        restored=import_document(Path(build_export(clean,'docx',tmp_path)['path']))['document']
        assert document_text(restored)==document_text(clean['book']['chapters'][0]['document'])


@pytest.mark.parametrize('mutation',['partial','border','floating','row_alignment'])
def test_native_table_moves_refuse_missing_cells_or_lossy_properties(tmp_path,mutation):
    path=Path(build_export(fixture(),'docx',tmp_path)['path']);word=Document(path)
    for table in word.tables:
        if mutation=='partial':
            paragraph=table.rows[-1].cells[-1].paragraphs[0]._p
            marker=paragraph.find(qn('w:pPr')+'/'+qn('w:rPr'))
            for child in list(marker):
                if child.tag in (qn('w:moveFrom'),qn('w:moveTo')):marker.remove(child)
        elif mutation=='border':
            table.rows[0].cells[0]._tc.tcPr.find(qn('w:tcBorders')+'/'+qn('w:top')).set(qn('w:val'),'dashed')
        elif mutation=='floating':table._tbl.tblPr.append(OxmlElement('w:tblpPr'))
        else:
            alignment=OxmlElement('w:jc');alignment.set(qn('w:val'),'right');table.rows[0]._tr.get_or_add_trPr().append(alignment)
    word.save(path)
    with pytest.raises(ValueError):import_document(path)


def test_last_table_scaffold_and_relocated_native_range_preserve_authored_text(tmp_path):
    p=fixture();doc=p['book']['chapters'][0]['document'];doc['content']=[n for n in doc['content'] if n['type']=='table' or not n.get('attrs',{}).get('revisionMove')]
    for n in doc['content']:
        if n['type']=='table':n['attrs']['revisionMove'].update(part=0,count=1)
    path=Path(build_export(p,'docx',tmp_path)['path']);word=Document(path)
    end=word._element.body.find(qn('w:moveToRangeEnd'));last=word.paragraphs[-1]._p
    last.append(end) # Word moves this end into its required trailing paragraph.
    word.save(path)
    restored=import_document(path)['document']
    assert len(restored['content'])==3
    for view in ('original','final'):assert document_text(review_document(restored,view))==document_text(review_document(doc,view))
    # Text added by a Word user to the former scaffold must never be discarded.
    end.getparent().remove(end);word.tables[-1]._tbl.addnext(end)
    word.paragraphs[-1].add_run('Authored after table')
    word.save(path)
    assert document_text(import_document(path)['document']).endswith('Authored after table')


@pytest.mark.parametrize('after_text',[False,True])
def test_table_section_range_end_may_precede_next_heading_text_but_cannot_capture_it(tmp_path,after_text):
    source=fixture();path=Path(build_export(source,'docx',tmp_path)['path']);word=Document(path)
    end=word._element.body.find(qn('w:moveFromRangeEnd'));following=end.getnext()
    assert following.tag==qn('w:p')
    if after_text:following.append(end)
    else:
        offset=1 if len(following) and following[0].tag==qn('w:pPr') else 0
        following.insert(offset,end)
    word.save(path)
    if after_text:
        with pytest.raises(ValueError):import_document(path)
    else:
        restored=import_document(path)['document']
        for view in ('original','final'):
            assert document_text(review_document(restored,view))==document_text(review_document(source['book']['chapters'][0]['document'],view))
