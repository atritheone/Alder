from copy import deepcopy
from pathlib import Path
import pytest
from alder.models import validate_project,document_text
from alder.document_revisions import review_document
from alder.publishing import build_export,import_document
from test_cell_revisions import fixture as cells_fixture,STAMP

def fixture(cells=True):
    project=cells_fixture();document=project['book']['chapters'][0]['document']
    if not cells:
        document=review_document(document,'original');project['book']['chapters'][0]['document']=document
    table=document['content'][0];row=table['content'][0]
    for node,before,after in [(table,{'align':'left'},{'align':'right'}),(row,{'allowSplit':False,'minHeight':40},{'allowSplit':True,'minHeight':64})]:
        a,b={'type':node['type'],'attrs':before},{'type':node['type'],'attrs':after}
        log={'base':a,'records':[{'stamp':{**STAMP,'id':'table-appearance'},'status':'pending','before':a,'after':b}]}
        node.setdefault('attrs',{}).update(**after,revisionProperties=log)
    return validate_project(project)

@pytest.mark.parametrize('format',['html','epub','docx'])
@pytest.mark.parametrize('cells',[False,True])
def test_table_row_and_cell_appearance_review_preserves_both_geometries(tmp_path,format,cells):
    project=fixture(cells);source=project['book']['chapters'][0]['document']
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document']
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(source,view)
        assert document_text(actual)==document_text(expected)
        a,b=actual['content'][0],expected['content'][0]
        assert a['attrs']['align']==b['attrs']['align']
        assert a['content'][0]['attrs']['minHeight']==pytest.approx(b['content'][0]['attrs']['minHeight'],abs=.051)
        assert a['content'][0]['attrs']['allowSplit']==b['content'][0]['attrs']['allowSplit']

def test_cell_padding_change_keeps_an_unchanged_minimum_row_height(tmp_path):
    project=cells_fixture();source=project['book']['chapters'][0]['document'];source['content'][0]['content'][0]['attrs']={'minHeight':40}
    restored=import_document(Path(build_export(validate_project(project),'docx',tmp_path)['path']))['document']
    for view in ('original','final'):assert review_document(restored,view)['content'][0]['content'][0]['attrs']['minHeight']==40

@pytest.mark.parametrize('format',['html','epub','docx'])
def test_comparison_preserves_independent_table_row_and_cell_properties(tmp_path,format):
    from alder.document_comparison import compare_documents
    project=fixture();source=project['book']['chapters'][0]['document']
    old,new=review_document(source,'original'),review_document(source,'final')
    project['book']['chapters'][0]['document']=compare_documents(old,new,'Comparison',STAMP['date'])
    restored=import_document(Path(build_export(validate_project(project),format,tmp_path)['path']))['document']
    for view,expected in [('original',old),('final',new)]:
        result=review_document(restored,view);a,b=result['content'][0],expected['content'][0]
        assert a['attrs']['align']==b['attrs']['align']
        assert a['content'][0]['attrs']['minHeight']==pytest.approx(b['content'][0]['attrs']['minHeight'],abs=.051)
        assert a['content'][0]['attrs']['allowSplit']==b['content'][0]['attrs']['allowSplit']

def test_native_review_refuses_height_that_would_be_clamped_by_cell_insets(tmp_path):
    project=fixture();row=project['book']['chapters'][0]['document']['content'][0]['content'][0]
    row['attrs']['revisionProperties']['records'][0]['before']['attrs']['minHeight']=2
    with pytest.raises(ValueError,match='smaller'):build_export(project,'docx',tmp_path)
