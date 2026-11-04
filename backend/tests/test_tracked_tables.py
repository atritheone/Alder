from copy import deepcopy
from pathlib import Path
import pytest
from alder.models import validate_project, document_text
from alder.document_revisions import review_document
from alder.document_comments import walk
from alder.publishing import build_export, import_document
from test_tracked_table_rows import merged_fixture


def fixture(kind='deletion',nested=False):
    project=merged_fixture(kind);doc=project['book']['chapters'][0]['document'];table=doc['content'][0]
    change=deepcopy(table['content'][1]['attrs']['revisionBlock'])
    for key in ('part','count'):change.pop(key,None)
    change['originalId']=table['attrs']['blockId'];table['attrs']['revisionBlock']=change
    for row in table['content']:row['attrs'].pop('revisionBlock',None)
    if nested:
        table['content'][0]['content'][0]['content'].append({'type':'table','content':[{'type':'table_row','content':[{'type':'table_cell','content':[{'type':'paragraph','content':[{'type':'text','text':'Nested content'}]}]}]}]})
    return validate_project(project)


@pytest.mark.parametrize('kind',['insertion','deletion'])
@pytest.mark.parametrize('nested',[False,True])
@pytest.mark.parametrize('format',['html','epub','docx'])
def test_complete_table_change_roundtrip_retains_grid_and_both_decisions(tmp_path,kind,nested,format):
    project=fixture(kind,nested);source=project['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    assert restored['content'][0]['attrs']['revisionBlock']['kind']==kind
    assert sum(bool(n.get('attrs',{}).get('revisionBlock')) for n in walk(restored))==1
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(source,view)
        assert document_text(actual)==document_text(expected)
        if (kind=='insertion')==(view=='final'):
            table=actual['content'][0]
            assert table['content'][1]['content'][0]['attrs']['rowspan']==2
            assert len(table['content'][2]['content'])==1
        else:assert not any(n['type']=='table' for n in walk(actual))


def test_overlapping_whole_table_and_row_changes_are_refused():
    project=fixture();table=project['book']['chapters'][0]['document']['content'][0]
    table['content'][0]['attrs']['revisionBlock']=deepcopy(table['attrs']['revisionBlock'])
    with pytest.raises(ValueError):validate_project(project)


def test_nested_native_table_insertion_uses_complete_owned_markers(tmp_path):
    from docx import Document
    from docx.oxml.ns import qn
    project=fixture('insertion',True);path=Path(build_export(project,'docx',tmp_path)['path']);word=Document(path)
    for row in word.tables[0]._tbl.iter(qn('w:tr')):assert row.trPr.find(qn('w:ins')) is not None
    for paragraph in word.tables[0]._tbl.iter(qn('w:p')):
        assert paragraph.find(qn('w:pPr')+'/'+qn('w:rPr')+'/'+qn('w:ins')) is not None
        assert paragraph.find(qn('w:ins')) is not None
    restored=import_document(path)['document']
    assert sum(bool(n.get('attrs',{}).get('revisionBlock')) for n in walk(restored))==1


def test_different_author_inside_native_table_insertion_is_not_silently_accepted(tmp_path):
    from docx import Document
    from docx.oxml.ns import qn
    path=Path(build_export(fixture('insertion',True),'docx',tmp_path)['path']);word=Document(path)
    paragraph=word.tables[0].rows[0].cells[0].paragraphs[0]._p
    paragraph.find(qn('w:ins')).set(qn('w:author'),'Another editor')
    word.save(path)
    with pytest.raises(ValueError):import_document(path)


def split_fixture(replacement=False,nested=False):
    project=fixture('insertion',nested);doc=project['book']['chapters'][0]['document'];table=doc['content'][0]
    stamp=deepcopy(table['attrs']['revisionBlock']['stamp'])
    left={'type':'paragraph','attrs':{'blockId':'before-table'},'content':[{'type':'text','text':'Before '} ]}
    if replacement:
        left['content'].extend([
            {'type':'text','text':'selected words','marks':[{'type':'revision_deletion','attrs':deepcopy(stamp)}]},
            {'type':'revision_break','attrs':{'kind':'deletion','stamp':deepcopy(stamp),'rightType':'paragraph','rightAttrs':{'blockId':'second-prose'}}},
            {'type':'text','text':'More removed ','marks':[{'type':'revision_deletion','attrs':deepcopy(stamp)}]},
        ])
    left['content'].append({'type':'revision_break','attrs':{'kind':'insertion','stamp':stamp,'nextId':'after-table'}})
    right={'type':'paragraph','attrs':{'blockId':'after-table'},'content':[{'type':'text','text':'after.'}]}
    doc['content']=[left,table,right]
    return validate_project(project)


@pytest.mark.parametrize('replacement',[False,True])
@pytest.mark.parametrize('format',['html','epub','docx'])
def test_table_insertion_split_restores_prose_and_replacement(tmp_path,replacement,format):
    project=split_fixture(replacement,True);source=project['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(source,view)
        assert document_text(actual)==document_text(expected)
        assert [n['type'] for n in actual['content']]==[n['type'] for n in expected['content']]
    boundary=next(n for n in walk(restored) if n['type']=='revision_break' and n['attrs']['kind']=='insertion')
    assert restored['content'][1]['attrs']['revisionBlock']['stamp']==boundary['attrs']['stamp']


@pytest.mark.parametrize('mismatch',['author','date','kind'])
def test_incompatible_inserted_table_boundary_is_refused(tmp_path,mismatch):
    from docx import Document
    from docx.oxml.ns import qn
    path=Path(build_export(split_fixture(),'docx',tmp_path)['path']);word=Document(path)
    marker=word.paragraphs[0]._p.find(qn('w:pPr')+'/'+qn('w:rPr')+'/'+qn('w:ins'))
    if mismatch=='kind':marker.tag=qn('w:del')
    else:marker.set(qn('w:'+mismatch),'Another editor' if mismatch=='author' else '2026-11-01T00:00:00Z')
    word.save(path)
    with pytest.raises(ValueError,match='boundary crosses'):import_document(path)
