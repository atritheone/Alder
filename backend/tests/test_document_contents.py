from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile
import pytest
from alder.models import create_project, validate_project, document_text
from alder.publishing import build_export, import_document


def fixture():
    project = create_project(template='blank')
    project['settings'].update(documentKind='docx', includeTitle=False, footer=False)
    project['book'] = {'version':1,'chapters':[{'id':'c','title':'Document','include':True,'document':{'type':'doc','content':[
        {'type':'table_of_contents','attrs':{'title':'Contents','depth':2,'entryStyle':None,'pageNumbers':False},'content':[{'type':'paragraph','content':[{'type':'text','text':'STALE CONTENTS'}]}]},
        {'type':'heading','attrs':{'level':1,'blockId':'a','headingNumbered':True},'content':[{'type':'text','text':'First heading'}]},
        {'type':'heading','attrs':{'level':2,'blockId':'b','headingNumbered':True},'content':[{'type':'text','text':'Child heading'}]},
        {'type':'heading','attrs':{'level':3,'blockId':'c','headingNumbered':True},'content':[{'type':'text','text':'Deeper heading'}]},
    ]}}]}
    return validate_project(project)


@pytest.mark.parametrize('format', ['html','epub','docx'])
def test_contents_refreshes_and_reopens_with_original_source_unchanged(tmp_path, format):
    project = fixture(); before = deepcopy(project)
    result = build_export(project, format, tmp_path)
    assert project == before
    opened = import_document(Path(result['path']))['document']
    contents = next(n for n in opened['content'] if n['type'] == 'table_of_contents')
    assert document_text(contents) == 'Contents\n1 First heading\n1.1 Child heading'
    assert contents['attrs']['depth'] == 2
    project['book']['chapters'][0]['document'] = opened
    validate_project(project)
    if format == 'docx':
        with ZipFile(result['path']) as archive:
            xml = archive.read('word/document.xml').decode()
            assert ' TOC ' in xml and 'AlderContents:1:2' in xml


def test_contents_validates_settings_and_respects_exclusion_and_entry_style(tmp_path):
    project = fixture()
    project['styles'].append({'id':'contents','name':'Contents entry','kind':'paragraph','fontSize':15,'color':'#334455'})
    node = project['book']['chapters'][0]['document']['content'][0]
    node['attrs']['entryStyle'] = 'contents'
    extra = deepcopy(project['book']['chapters'][0]);extra.update(id='excluded',include=False)
    project['book']['chapters'].append(extra)
    result = build_export(project,'html',tmp_path)
    text = Path(result['path']).read_text(encoding='utf-8')
    assert text.count('data-document-contents="true"') == 1
    assert 'font-size:15pt' in text
    node['attrs']['depth'] = 9
    with pytest.raises(ValueError,match='heading levels'): validate_project(project)


def caption_fixture():
    project = fixture()
    nodes = project['book']['chapters'][0]['document']['content']
    for kind in ('figures','tables'):
        nodes.insert(0, {'type':'table_of_contents','attrs':{'kind':kind,'title':'List of '+kind,'depth':1,'entryStyle':None,'pageNumbers':False},'content':[{'type':'paragraph'}]})
    for index, label in enumerate(('Figure','Table','Figure')):
        nodes.append({'type':'paragraph','attrs':{'blockId':f'caption-{index}','captionLabel':label},'content':[
            {'type':'text','text':label+' '}, {'type':'sequence','attrs':{'sequenceName':label},'content':[{'type':'text','text':'99'}]},
            {'type':'text','text':': '+('Measurements' if label=='Table' else f'Illustration {index}')}]})
    return validate_project(project)


@pytest.mark.parametrize('format',['html','epub','docx'])
def test_figure_and_table_lists_retain_their_kind_and_independent_sequences(tmp_path, format):
    project=caption_fixture(); before=deepcopy(project)
    result=build_export(project,format,tmp_path)
    assert project==before
    opened=import_document(Path(result['path']))['document']
    lists={n['attrs'].get('kind','headings'):n for n in opened['content'] if n['type']=='table_of_contents'}
    assert document_text(lists['figures'])=='List of figures\nFigure 1: Illustration 0\nFigure 2: Illustration 2'
    assert document_text(lists['tables'])=='List of tables\nTable 1: Measurements'
    assert 'First heading' in document_text(lists['headings'])
    project['book']['chapters'][0]['document']=opened
    validate_project(project)
    if format=='docx':
        with ZipFile(result['path']) as archive:
            xml=archive.read('word/document.xml').decode()
            assert 'TOC \\c "Figure"' in xml and 'TOC \\c "Table"' in xml
