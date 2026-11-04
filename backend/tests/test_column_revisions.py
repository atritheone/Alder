from copy import deepcopy
from pathlib import Path
import pytest
from test_cell_revisions import fixture as cell_fixture,merged_fixture,STAMP
from alder.models import validate_project,document_text
from alder.document_revisions import review_document,revision_summary
from alder.document_comments import walk
from alder.docx_support import table_grid
from alder.publishing import build_export,import_document


def fixture(merged=False,horizontal=False,automatic=False,appearance=False):
    p=merged_fixture(horizontal) if merged else cell_fixture()
    rows=p['book']['chapters'][0]['document']['content'][0]['content']
    if not merged:rows.append(deepcopy(rows[0]))
    columns,cells=table_grid(rows)
    old=[200,240] if columns==2 else [100,100,240]
    new=[120,320] if columns==2 else [60,140,240]
    for _,col,_,span,cell in cells:
        a=cell['attrs'];log=a['revisionProperties']
        for before in [log['base'],log['records'][0]['before']]:
            if not automatic:before['attrs']['colwidth']=old[col:col+span]
        if not appearance:
            after=deepcopy(log['base']);after['attrs']['colwidth']=new[col:col+span]
            log['records'][0]['after']=after
            cell['attrs']={**deepcopy(after['attrs']),'revisionProperties':log}
        else:
            a['colwidth']=new[col:col+span];log['records'][0]['after']['attrs']['colwidth']=new[col:col+span]
        if log['records'][0]['before']==log['records'][0]['after']:cell['attrs'].pop('revisionProperties',None)
    return validate_project(p)


@pytest.mark.parametrize('merged,horizontal',[(False,False),(True,False),(True,True)])
@pytest.mark.parametrize('format',['docx','html','epub'])
@pytest.mark.parametrize('appearance',[False,True])
def test_column_width_review_preserves_both_logical_grids(tmp_path,merged,horizontal,format,appearance):
    p=fixture(merged,horizontal,appearance=appearance);source=p['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(p,format,tmp_path)['path']))['document']
    for view in ('original','final'):
        expected,actual=review_document(source,view),review_document(restored,view)
        assert document_text(expected)==document_text(actual)
        a=[n['attrs'] for n in walk(expected) if n['type']=='table_cell'];b=[n['attrs'] for n in walk(actual) if n['type']=='table_cell']
        for left,right in zip(a,b):
            for key in ('colspan','rowspan','colwidth','background'):
                assert left.get(key)==right.get(key),(view,key,left,right)
    # A column is shared by rows and must remain one decision.
    assert len(revision_summary(restored))==1


@pytest.mark.parametrize('merged,horizontal',[(False,False),(True,False),(True,True)])
def test_comparison_groups_shared_column_widths(tmp_path,merged,horizontal):
    from alder.document_comparison import compare_documents
    p=fixture(merged,horizontal);source=p['book']['chapters'][0]['document']
    result=compare_documents(review_document(source,'original'),review_document(source,'final'),'Compare',STAMP['date'])
    assert len(revision_summary(result))==1
    p['book']['chapters'][0]['document']=result
    restored=import_document(Path(build_export(p,'docx',tmp_path)['path']))['document']
    assert len(revision_summary(restored))==1


@pytest.mark.parametrize('damage',['author','inconsistent','span','missing-history'])
def test_inconsistent_column_review_is_refused(tmp_path,damage):
    p=fixture();rows=p['book']['chapters'][0]['document']['content'][0]['content'];a=rows[1]['content'][0]['attrs'];log=a['revisionProperties']
    if damage=='author':log['records'][0]['stamp']={**STAMP,'id':'different','author':'Another reviewer'}
    elif damage=='inconsistent':a['colwidth']=[160];log['records'][0]['after']['attrs']['colwidth']=[160]
    elif damage=='span':log['base']['attrs']['colspan']=2;log['base']['attrs']['colwidth']=[100,100]
    else:a.pop('revisionProperties')
    with pytest.raises(ValueError):build_export(validate_project(p),'docx',tmp_path)


def test_automatic_original_grid_is_retained_in_native_review(tmp_path):
    p=fixture(automatic=True)
    doc=import_document(Path(build_export(p,'docx',tmp_path)['path']))['document']
    before=[n['attrs']['colwidth'] for n in walk(review_document(doc,'original')) if n['type']=='table_cell']
    assert len({tuple(w) for w in before})==1
    assert all(w[0]>0 for w in before)
    after=[n['attrs']['colwidth'] for n in walk(review_document(doc,'final')) if n['type']=='table_cell']
    assert after==[[120],[320],[120],[320]]


@pytest.mark.parametrize('damage',['missing-grid','old-width','new-width','author','merge','missing-cell'])
def test_incomplete_native_width_evidence_is_refused(tmp_path,damage):
    from docx import Document
    from docx.oxml.ns import qn
    p=fixture();path=Path(build_export(p,'docx',tmp_path)['path']);word=Document(path)
    table=word.tables[0];props=table.rows[0].cells[0]._tc.tcPr;change=props.find(qn('w:tcPrChange'))
    if damage=='missing-grid':table._tbl.tblGrid.remove(table._tbl.tblGrid.find(qn('w:tblGridChange')))
    elif damage=='old-width':change[0].find(qn('w:tcW')).set(qn('w:w'),'2999')
    elif damage=='new-width':props.find(qn('w:tcW')).set(qn('w:w'),'1801')
    elif damage=='author':change.set(qn('w:author'),'Another reviewer')
    elif damage=='merge':
        from docx.oxml import OxmlElement
        change[0].append(OxmlElement('w:vMerge'))
    else:props.remove(change)
    word.save(path)
    with pytest.raises(ValueError):import_document(path)


def test_unaffected_column_retains_its_independent_appearance_author(tmp_path):
    p=fixture(True,True)
    cell=p['book']['chapters'][0]['document']['content'][0]['content'][0]['content'][1]
    before={'type':cell['type'],'attrs':deepcopy(cell['attrs'])};before['attrs'].pop('blockId',None)
    after=deepcopy(before);after['attrs']['background']='#123456'
    cell['attrs'].update(background='#123456',revisionProperties={'base':before,'records':[{'stamp':{**STAMP,'id':'shade','author':'Shade reviewer'},'status':'pending','before':before,'after':after}]})
    # The right column is also vertically adjacent to an unchanged cell.
    doc=import_document(Path(build_export(validate_project(p),'docx',tmp_path)['path']))['document']
    assert {r['author'] for r in revision_summary(doc)}=={'Cell reviewer','Shade reviewer'}
    p['book']['chapters'][0]['document']=doc
    reopened=import_document(Path(build_export(validate_project(p),'docx',tmp_path)['path']))['document']
    assert {r['author'] for r in revision_summary(reopened)}=={'Cell reviewer','Shade reviewer'}
