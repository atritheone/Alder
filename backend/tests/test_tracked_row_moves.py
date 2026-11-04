from copy import deepcopy
from pathlib import Path
import pytest
from alder.models import create_project,validate_project,document_text
from alder.publishing import build_export,import_document
from alder.document_revisions import review_document
from alder.tracked_moves import validate_moves
from alder.document_comments import walk
from test_tracked_comment_moves import THREAD


def fixture(merged=False,nested=False,comments=False,inside=False):
    project=create_project(template='blank');project['name']='Tracked row move';project['settings'].update(documentKind='docx',includeTitle=False)
    def cell(text,**attrs):return {'type':'table_cell','attrs':{'colwidth':[160],**attrs},'content':[{'type':'paragraph','content':[{'type':'text','text':text,'marks':[{'type':'strong'}]}]}]}
    def row(text):return {'type':'table_row','attrs':{'allowSplit':True,'minHeight':36},'content':[cell(text+' left'),cell(text+' right')]}
    band=[row('Moved')]
    if merged:
        band[0]['content'][0]['attrs']['rowspan']=2
        band.append({'type':'table_row','attrs':{'allowSplit':True},'content':[cell('Lower right')]})
    if nested:
        band[0]['content'][1]['content'].append({'type':'table','content':[row('Nested')]})
    if comments:
        paragraphs=[n for root in band for n in walk(root) if n['type']=='paragraph']
        for paragraph,edge in ((paragraphs[0],'start'),(paragraphs[-1],'end')):
            paragraph['content'].insert(0 if edge=='start' else len(paragraph['content']),{'type':'comment_anchor','attrs':{'threadId':'thread','edge':edge,'thread':deepcopy(THREAD)}})
    sides=[]
    for kind in ('deletion','insertion'):
        side=deepcopy(band)
        for part,n in enumerate(side):
            n['attrs'].update(blockId=f'row_{part}'+('_ghost' if kind=='deletion' else ''),revisionMove={
                'kind':kind,'stamp':{'id':'row_move','author':'Reviewer','date':'2026-11-04T00:00:00Z','move':True},
                'originalId':f'row_{part}','part':part,'count':len(side)})
        sides.append(side)
    project['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':{'type':'doc','content':[
        {'type':'table','attrs':{'align':'center'},'content':[row('First'),*sides[0],row('Between'),*sides[1],row('Last')]}
    ]}}]}
    if inside:
        doc=project['book']['chapters'][0]['document']
        doc['content']=[{'type':'table','content':[{'type':'table_row','content':[{'type':'table_cell','content':[{'type':'paragraph','content':[{'type':'text','text':'Outer cell'}]},*doc['content']]}]}]}]
    return validate_project(project)


@pytest.mark.parametrize('shape',['plain','merged','nested','comments','merged-comments'])
@pytest.mark.parametrize('format',['html','epub','docx'])
def test_row_move_preserves_grids_review_and_comments(tmp_path,shape,format):
    project=fixture('merged' in shape,shape=='nested','comments' in shape);source=project['book']['chapters'][0]['document']
    if shape=='nested' and format=='docx':
        with pytest.raises(ValueError,match='nested tables'):build_export(project,format,tmp_path)
        return
    restored=import_document(Path(build_export(project,format,tmp_path)['path']))['document'];validate_moves(restored)
    for view in ('original','final'):
        actual=review_document(restored,view);expected=review_document(source,view)
        assert document_text(actual)==document_text(expected)
        actual_rows=actual['content'][0]['content'];expected_rows=expected['content'][0]['content']
        assert len(actual_rows)==len(expected_rows)
        for a,b in zip(actual_rows,expected_rows):
            assert [(c.get('attrs',{}).get('rowspan',1),c.get('attrs',{}).get('colspan',1)) for c in a['content']]==[(c.get('attrs',{}).get('rowspan',1),c.get('attrs',{}).get('colspan',1)) for c in b['content']]
        if 'comments' in shape:
            anchors=[n['attrs'] for n in walk(actual) if n['type']=='comment_anchor']
            assert [a['edge'] for a in anchors]==['start','end']
            assert anchors[0]['thread']==anchors[1]['thread']
            assert anchors[0]['thread']['resolved']==THREAD['resolved']
            assert [{k:v for k,v in entry.items() if k!='id'} for entry in anchors[0]['thread']['entries']]==[{k:v for k,v in entry.items() if k!='id'} for entry in THREAD['entries']]


@pytest.mark.parametrize('damage',['partial','mismatch','cross-table','cross-merge'])
def test_incomplete_row_moves_are_refused(damage):
    project=fixture(True);doc=project['book']['chapters'][0]['document'];rows=doc['content'][0]['content']
    if damage=='partial':rows.pop(1)
    elif damage=='mismatch':rows[1]['content'][0]['content'][0]['content'][0]['text']='Changed only here'
    elif damage=='cross-table':doc['content'].append({'type':'table','content':rows[4:6]});del rows[4:6]
    else:rows[0]['content'][0]['attrs']['rowspan']=2;rows[1]['content'].pop(0)
    with pytest.raises(ValueError):validate_project(project)


def test_moves_inside_a_nested_table_keep_the_outer_cell_and_inner_grid(tmp_path):
    project=fixture(True,comments=True,inside=True);source=project['book']['chapters'][0]['document']
    with pytest.raises(ValueError,match='nested tables'):build_export(project,'docx',tmp_path)
    restored=import_document(Path(build_export(project,'html',tmp_path)['path']))['document'];validate_moves(restored)
    for view in ('original','final'):
        assert document_text(review_document(restored,view))==document_text(review_document(source,view))
        clean=deepcopy(project);clean['book']['chapters'][0]['document']=review_document(source,view)
        word=import_document(Path(build_export(clean,'docx',tmp_path)['path']))['document']
        assert document_text(word)==document_text(review_document(source,view))
