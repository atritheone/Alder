from copy import deepcopy
from pathlib import Path
import pytest
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from alder.models import create_project, validate_project, document_text
from alder.publishing import build_export, import_document
from alder.document_revisions import review_document
from alder.publication_layout import prepare_layout


def fixture(kind='insertion'):
    project = create_project(template='blank')
    project['name'] = 'Tracked table row'
    project['settings'].update(documentKind='docx', includeTitle=False)
    def cell(text):
        return {'type':'table_cell', 'attrs':{'colwidth':[150], 'background':'#ddeeff', 'verticalAlign':'bottom'},
                'content':[{'type':'paragraph', 'content':[{'type':'text','text':text,'marks':[{'type':'strong'}]}]}]}
    rows = [{'type':'table_row', 'attrs':{'blockId':f'row_{i}','allowSplit':True,'minHeight':36},
             'content':[cell(f'{name} left'),cell(f'{name} right')]} for i,name in enumerate(('First','Changed','Last'))]
    rows[1]['attrs']['revisionBlock'] = {'kind':kind,'originalId':'row_1',
        'stamp':{'id':'row_change','author':'Reviewer','date':'2026-11-04T00:00:00Z'}}
    project['book'] = {'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':{
        'type':'doc','content':[{'type':'table','attrs':{'align':'center'},'content':rows}]}}]}
    return validate_project(project)


@pytest.mark.parametrize('kind',['insertion','deletion'])
@pytest.mark.parametrize('format',['html','epub','docx'])
def test_complete_row_revision_roundtrip_and_decisions(tmp_path,kind,format):
    project=fixture(kind); source=project['book']['chapters'][0]['document']
    path=Path(build_export(project,format,tmp_path)['path'])
    restored=import_document(path)['document']
    rows=restored['content'][0]['content']
    assert rows[1]['attrs']['revisionBlock']['kind']==kind
    assert rows[1]['attrs']['revisionBlock']['stamp']['author']=='Reviewer'
    if format=='docx':
        word=Document(path)
        assert word.tables[0].rows[1]._tr.trPr.find(qn('w:ins' if kind=='insertion' else 'w:del')) is not None
    for view in ('original','final'):
        actual=review_document(restored,view); expected=review_document(source,view)
        assert document_text(actual)==document_text(expected)
        for row in actual['content'][0]['content']:
            assert row['attrs']['allowSplit'] is True
            assert row['attrs']['minHeight']==pytest.approx(36)
            for cell in row['content']:
                assert cell['attrs']['colwidth']==[150]
                assert cell['attrs']['background']=='#ddeeff'
                assert cell['attrs']['verticalAlign']=='bottom'
                assert cell['content'][0]['content'][0]['marks']==[{'type':'strong'}]


@pytest.mark.parametrize('mutation',['all_rows','crossing_merge','nested_review','partial_bookmark','incomplete_grid'])
def test_row_revision_refuses_ambiguous_or_incomplete_structure(mutation):
    project=fixture();rows=project['book']['chapters'][0]['document']['content'][0]['content']
    if mutation=='all_rows':
        for i,row in enumerate(rows):
            row['attrs']['revisionBlock']=deepcopy(rows[1]['attrs']['revisionBlock'])
            row['attrs']['revisionBlock']['stamp']['id']=f'change_{i}'
    elif mutation=='crossing_merge':rows[0]['content'][0]['attrs']['rowspan']=2
    elif mutation=='nested_review':rows[1]['content'][0]['content'][0]['content'][0]['marks'].append({'type':'revision_insertion','attrs':{'id':'inner','author':'Other','date':''}})
    elif mutation=='partial_bookmark':rows[1]['content'][0]['content'][0]['content'].append({'type':'bookmark','attrs':{'blockId':'partial','name':'Partial','range':True}})
    else:rows[1]['content'].pop()
    with pytest.raises(ValueError):validate_project(project)


def test_deleted_row_measurements_use_original_story_without_mutating_project():
    project=fixture('deletion');row=project['book']['chapters'][0]['document']['content'][0]['content'][1]
    project['book']['chapters'][0]['document']['content'][0]['content'][0]['attrs']['revisionBlock']=None
    row['content'][0]['content'][0]['content'].append({'type':'text_box','attrs':{'blockId':'box','width':100},'content':[{'type':'text','text':'Box wording'}]})
    project=validate_project(project);before=deepcopy(project)
    snapshot=prepare_layout(project,{'measureMoveSources':True})
    assert snapshot['moveSourceIds']=={'row_1':'row_1','box':'box'}
    assert 'Changed left' not in document_text(snapshot['document'])
    assert 'Changed left' in document_text(prepare_layout(project,{'reviewView':'original'})['document'])
    assert project==before


def test_native_overlapping_row_property_change_refuses_import(tmp_path):
    path=Path(build_export(fixture(),'docx',tmp_path)['path']);word=Document(path)
    word.tables[0].rows[1]._tr.trPr.append(OxmlElement('w:trPrChange'));word.save(path)
    with pytest.raises(ValueError):import_document(path)


def test_native_incomplete_grid_refuses_row_revision_import(tmp_path):
    path=Path(build_export(fixture(),'docx',tmp_path)['path']);word=Document(path)
    missing=OxmlElement('w:gridBefore');missing.set(qn('w:val'),'1')
    word.tables[0].rows[1]._tr.trPr.append(missing);word.save(path)
    with pytest.raises(ValueError):import_document(path)


def grouped_fixture(kind):
    project=fixture(kind);rows=project['book']['chapters'][0]['document']['content'][0]['content']
    added=deepcopy(rows[1]);added['attrs']['blockId']='row_extra';added['attrs']['revisionBlock']['originalId']='row_extra'
    for cell in added['content']:
        for paragraph in cell['content']:
            for text in paragraph['content']:text['text']=text['text'].replace('Changed','Other')
    rows.insert(2,added)
    for part,row in enumerate(rows[1:3]):row['attrs']['revisionBlock'].update(count=2,part=part)
    return validate_project(project)


def merged_fixture(kind='deletion'):
    project=grouped_fixture(kind);rows=project['book']['chapters'][0]['document']['content'][0]['content']
    rows[1]['content'][0]['attrs']['rowspan']=2;rows[2]['content'].pop(0)
    return validate_project(project)


@pytest.mark.parametrize('kind',['insertion','deletion'])
@pytest.mark.parametrize('format',['html','epub','docx'])
def test_connected_merged_row_band_retains_both_grids(tmp_path,kind,format):
    project=merged_fixture(kind);source=project['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(source,view)
        assert document_text(actual)==document_text(expected)
        rows=actual['content'][0]['content'];survives=(view=='final')==(kind=='insertion')
        assert len(rows)==(4 if survives else 2)
        if survives:assert rows[1]['content'][0]['attrs']['rowspan']==2 and len(rows[2]['content'])==1


def test_word_reassigned_row_ids_retain_connected_merged_review_group(tmp_path):
    path=Path(build_export(merged_fixture(),'docx',tmp_path)['path']);word=Document(path)
    for index,row in enumerate(word.tables[0].rows[1:3]):row._tr.trPr.find(qn('w:del')).set(qn('w:id'),str(index+100))
    word.save(path);rows=import_document(path)['document']['content'][0]['content']
    assert rows[1]['attrs']['revisionBlock']['stamp']['id']==rows[2]['attrs']['revisionBlock']['stamp']['id']
    assert rows[1]['attrs']['revisionBlock']['count']==2


@pytest.mark.parametrize('damage',['different_kind','different_author','missing_row','bad_merge'])
def test_word_partial_or_mixed_merged_row_changes_refuse_import(tmp_path,damage):
    path=Path(build_export(merged_fixture(),'docx',tmp_path)['path']);word=Document(path)
    row=word.tables[0].rows[2];marker=row._tr.trPr.find(qn('w:del'))
    if damage=='different_kind':marker.tag=qn('w:ins')
    elif damage=='different_author':marker.set(qn('w:author'),'Other')
    elif damage=='missing_row':row._tr.trPr.remove(marker)
    else:row._tr.tc_lst[0].tcPr.find(qn('w:vMerge')).set(qn('w:val'),'unknown')
    word.save(path)
    with pytest.raises(ValueError):import_document(path)


@pytest.mark.parametrize('authored', [False, True])
def test_final_table_scaffold_is_omitted_only_while_untouched(tmp_path, authored):
    project=fixture();doc=project['book']['chapters'][0]['document']
    doc['content'][0]['content'][1]['attrs'].pop('revisionBlock')
    path=Path(build_export(project,'docx',tmp_path)['path']);word=Document(path)
    assert word.paragraphs[-1].style.name=='AlderTableTerminator'
    if authored:word.paragraphs[-1].add_run('Authored after table.');word.save(path)
    restored=import_document(path)['document']
    assert len(restored['content'])==(2 if authored else 1)
    if authored:assert document_text(restored['content'][-1])=='Authored after table.'


@pytest.mark.parametrize('kind',['insertion','deletion'])
@pytest.mark.parametrize('format',['html','epub','docx'])
def test_row_group_keeps_one_review_identity_and_both_rows(tmp_path,kind,format):
    from alder.document_revisions import revision_summary
    project=grouped_fixture(kind);source=project['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    assert len(revision_summary(restored))==1
    for view in ('original','final'):
        assert document_text(review_document(restored,view))==document_text(review_document(source,view))
        assert len(review_document(restored,view)['content'][0]['content'])==(4 if (kind=='insertion')==(view=='final') else 2)


@pytest.mark.parametrize('mutation',['missing','gap','part','kind','author'])
def test_row_group_requires_complete_contiguous_members(mutation):
    project=grouped_fixture('deletion');rows=project['book']['chapters'][0]['document']['content'][0]['content'];change=rows[2]['attrs']['revisionBlock']
    if mutation=='missing':rows.pop(2)
    elif mutation=='gap':rows[2],rows[3]=rows[3],rows[2]
    elif mutation=='part':change['part']=0
    elif mutation=='kind':change['kind']='insertion'
    else:change['stamp']['author']='Another reviewer'
    with pytest.raises(ValueError):validate_project(project)


@pytest.mark.parametrize('kind',['insertion','deletion'])
@pytest.mark.parametrize('object_kind',['equation','inline_image','document_note','document_field','form_field','text_box','cross_reference','index_entry','citation','sequence'])
def test_row_objects_retain_their_content_through_word_exchange(tmp_path,kind,object_kind):
    from test_tracked_structural_objects import fixture as structural_fixture
    from test_tracked_moves import BOX_LAYOUT
    from alder.tracked_block_moves import identity_nodes
    sample=structural_fixture('table',object_kind)
    sample_doc=sample['book']['chapters'][0]['document']
    table=next(n for n in sample_doc['content'] if n['type']=='table' and n['attrs']['revisionMove']['kind']=='insertion')
    obj=deepcopy(next(n for n in identity_nodes(table) if n['type']==object_kind and (object_kind!='sequence' or n['attrs']['sequenceName']=='Figure')))
    project=fixture(kind);project['assets']=sample['assets']
    source=project['book']['chapters'][0]['document'];row=source['content'][0]['content'][1]
    row['content'][0]['content'][0]['content'].append(obj)
    if object_kind=='cross_reference':source['content'].append(deepcopy(next(n for n in sample_doc['content'] if n.get('attrs',{}).get('blockId')=='target')))
    project=validate_project(project)
    restored=import_document(Path(build_export(project,'docx',tmp_path,BOX_LAYOUT if object_kind=='text_box' else None)['path']))['document']
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(source,view)
        assert document_text(actual)==document_text(expected)
        objects=[n for n in identity_nodes(actual) if n['type']==object_kind]
        expected_objects=[n for n in identity_nodes(expected) if n['type']==object_kind]
        assert len(objects)==len(expected_objects)
        if objects and object_kind=='document_note':assert document_text(objects[0]['attrs']['body'])==document_text(obj['attrs']['body'])
        if objects and object_kind=='form_field':assert objects[0]['attrs']['lockContent'] and objects[0]['attrs']['lockDelete']
