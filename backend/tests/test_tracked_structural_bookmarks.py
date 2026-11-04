import copy
from pathlib import Path
import pytest
from alder.models import validate_project, document_text
from alder.document_revisions import review_document
from alder.document_references import reference_values
from alder.tracked_block_moves import identity_nodes
from alder.publishing import build_export, import_document
from test_tracked_table_moves import fixture as table_fixture
from test_tracked_list_moves import fixed_fixture as list_fixture


def fixture(container):
    project=table_fixture() if container=='table' else list_fixture()
    document=project['book']['chapters'][0]['document']
    for root in document['content']:
        if root['type']!=container or not root.get('attrs',{}).get('revisionMove'):continue
        ghost=root['attrs']['revisionMove']['kind']=='deletion'
        identifier='passage_ghost' if ghost else 'passage'
        paragraphs=[n for n in identity_nodes(root) if n['type']=='paragraph']
        paragraphs[0].setdefault('content',[]).insert(0,{'type':'bookmark','attrs':{'blockId':identifier,'name':'Passage','range':True}})
        paragraphs[-1].setdefault('content',[]).append({'type':'bookmark_end','attrs':{'blockId':'end_ghost' if ghost else 'end','targetId':identifier,'name':'Passage'}})
    document['content'].append({'type':'paragraph','content':[{'type':'cross_reference','attrs':{'targetId':'passage'},'content':[{'type':'text','text':'Cached passage'}]}]})
    document['content'][-1]['content'][0]['content'][0]['text']=reference_values([document])['passage']
    return validate_project(project)


@pytest.mark.parametrize('container',['table','ordered_list'])
@pytest.mark.parametrize('format',['html','epub','docx'])
def test_structural_bookmark_ranges_keep_live_targets_and_both_review_outcomes(tmp_path,container,format):
    project=fixture(container);source=project['book']['chapters'][0]['document']
    if format=='docx':
        with pytest.raises(ValueError,match='moves containing bookmarks'):build_export(project,format,tmp_path)
    for view in ('original','final'):
        exported=build_export(project,format,tmp_path,{'reviewView':view} if format=='docx' else None)
        restored=review_document(import_document(Path(exported['path']))['document'],view)
        expected=review_document(source,view)
        refs=[n for n in identity_nodes(restored) if n['type']=='cross_reference'];assert len(refs)==1
        bookmarks=[n for n in identity_nodes(restored) if n['type']=='bookmark'];assert len(bookmarks)==1
        end=next(n for n in identity_nodes(restored) if n['type']=='bookmark_end')
        assert bookmarks[0]['attrs']['name']=='Passage'
        assert bookmarks[0]['attrs']['blockId']==refs[0]['attrs']['targetId']==end['attrs']['targetId']
        assert reference_values([restored])[refs[0]['attrs']['targetId']]==reference_values([expected])['passage']
        if format!='docx':assert document_text(restored)==document_text(expected)


@pytest.mark.parametrize('container',['table','ordered_list'])
def test_incomplete_structural_range_is_refused_and_copied_moves_retain_distinct_targets(container):
    project=fixture(container);copied=copy.deepcopy(project['book']['chapters'][0]);copied['id']='copied';project['book']['chapters'].append(copied)
    migrated=validate_project(project);ids=[]
    for chapter in migrated['book']['chapters']:
        for view in ('original','final'):
            targets=[n for n in identity_nodes(review_document(chapter['document'],view)) if n['type']=='bookmark']
            assert len(targets)==1 and targets[0]['attrs']['name']=='Passage';ids.append(targets[0]['attrs']['blockId'])
    assert ids[0]==ids[1] and ids[2]==ids[3] and ids[0]!=ids[2]
    broken=fixture(container)
    for node in identity_nodes(broken['book']['chapters'][0]['document']):
        if node['type']=='paragraph':node['content']=[n for n in node.get('content',[]) if n['type']!='bookmark_end']
    with pytest.raises(ValueError,match='complete bookmarked passage'):validate_project(broken)
