from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile
import pytest
from alder.models import create_project, validate_project, document_text
from alder.publishing import build_export, import_document


def fixture():
    project=create_project(template='blank');project['settings'].update(documentKind='docx',includeTitle=False,footer=False)
    def caption(target,title):
        return {'type':'paragraph','attrs':{'blockId':'caption-'+target,'captionLabel':'Table','captionTargetId':target,'keepWithNext':True},'content':[{'type':'text','text':'Table '},{'type':'sequence','attrs':{'sequenceName':'Table'},'content':[{'type':'text','text':'9'}]},{'type':'text','text':': '+title}]}
    def table(identifier):
        return {'type':'table','attrs':{'blockId':identifier},'content':[{'type':'table_row','content':[{'type':'table_cell','content':[{'type':'paragraph','content':[{'type':'text','text':'Cell'}]}]}]}]}
    document={'type':'doc','content':[caption('first','Measurements'),table('first'),caption('second','Comparisons'),table('second'),{'type':'paragraph','content':[{'type':'text','text':'See '},{'type':'cross_reference','attrs':{'targetId':'caption-second'},'content':[{'type':'text','text':'Old caption'}]}]}]}
    project['book']={'version':1,'chapters':[{'id':'chapter','title':'Document','include':True,'document':document}]}
    return validate_project(project)

def walk(node):
    yield node
    for child in node.get('content',[]):yield from walk(child)

@pytest.mark.parametrize('format',['html','epub','docx'])
def test_caption_numbering_and_reference_survive_exchange(tmp_path,format):
    project=fixture();before=deepcopy(project);result=build_export(project,format,tmp_path)
    assert project==before
    opened=import_document(Path(result['path']));document=opened['document']
    captions=[node for node in walk(document) if node.get('attrs',{}).get('captionLabel')]
    assert [document_text(node) for node in captions]==['Table 1: Measurements','Table 2: Comparisons']
    tables=[node for node in walk(document) if node['type']=='table']
    assert [node['attrs']['captionTargetId'] for node in captions]==[node['attrs']['blockId'] for node in tables]
    sequences=[node for node in walk(document) if node['type']=='sequence']
    assert [document_text(node) for node in sequences]==['1','2']
    refs=[node for node in walk(document) if node['type']=='cross_reference']
    assert document_text(refs[0])=='Table 2: Comparisons'
    if format=='docx':
        with ZipFile(result['path']) as archive:assert archive.read('word/document.xml').decode().count(' SEQ Table ')==2

def test_caption_numbering_follows_movement_and_copy_anchors_are_independent(tmp_path):
    project=fixture();document=project['book']['chapters'][0]['document'];content=document['content']
    document['content']=[*content[2:4],*content[:2],*content[4:]]
    result=build_export(project,'html',tmp_path);opened=import_document(Path(result['path']))
    assert 'Table 1: Comparisons' in opened['text'] and 'Table 2: Measurements' in opened['text']
    copy=deepcopy(project['book']['chapters'][0]);copy['id']='copied';project['book']['chapters'].append(copy)
    project=validate_project(project);a,b=[chapter['document'] for chapter in project['book']['chapters']]
    assert a['content'][0]['attrs']['captionTargetId']!=b['content'][0]['attrs']['captionTargetId']
    assert b['content'][0]['attrs']['captionTargetId']==b['content'][1]['attrs']['blockId']
    assert validate_project(project)==project


@pytest.mark.parametrize('format',['html','epub','docx'])
def test_short_caption_references_keep_their_format_and_update_after_exchange(tmp_path,format):
    project=fixture();document=project['book']['chapters'][0]['document']
    fields=document['content'][-1]['content']
    for display in ('labelNumber','number'):
        fields.extend([{'type':'text','text':' / '},{'type':'cross_reference','attrs':{'targetId':'caption-second','referenceFormat':display},'content':[{'type':'text','text':'Old'}]}])
    project=validate_project(project)
    exported=build_export(project,format,tmp_path)
    opened=import_document(Path(exported['path']))
    refs=[n for n in walk(opened['document']) if n['type']=='cross_reference']
    assert [document_text(n) for n in refs]==['Table 2: Comparisons','Table 2','2']
    assert [n['attrs'].get('referenceFormat','text') for n in refs]==['text','labelNumber','number']
    caption=[n for n in walk(opened['document']) if n.get('attrs',{}).get('captionLabel')=='Table'][1]
    assert all(n['attrs']['targetId']==caption['attrs']['blockId'] for n in refs)
    # A second exchange does not accumulate synthetic bookmarks or stale targets.
    project['book']['chapters'][0]['document']=opened['document'];project=validate_project(project)
    second=import_document(Path(build_export(project,format,tmp_path)['path']))
    assert not [n for n in walk(second['document']) if n['type']=='bookmark']
    assert [document_text(n) for n in walk(second['document']) if n['type']=='cross_reference']==['Table 2: Comparisons','Table 2','2']
