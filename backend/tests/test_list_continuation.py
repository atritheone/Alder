from pathlib import Path
from copy import deepcopy
import pytest
from docx import Document
from alder.models import create_project, validate_project, ValidationError
from alder.publishing import build_export, import_document
from alder.list_formatting import resolve_list_orders


def para(text): return {'type':'paragraph','content':[{'type':'text','text':text}]}
def listing(text, **attrs): return {'type':'ordered_list','attrs':attrs,'content':[{'type':'list_item','content':[para(text)]}]}
def fixture():
    p=create_project(template='blank')
    p['settings'].update(documentKind='docx',includeTitle=False,footer=False)
    doc={'type':'doc','content':[listing('First',order=4),para('Between'),listing('Second',continuePrevious=True),para('Break'),listing('Restart',order=2),para('Between again'),listing('Third',continuePrevious=True)]}
    p['book']={'version':1,'chapters':[{'id':'lists','title':'Document','include':True,'document':doc}]}
    return validate_project(p)


@pytest.mark.parametrize('format',['docx','html','pdf'])
def test_continuation_export(tmp_path,format):
    p=fixture();before=deepcopy(p)
    result=build_export(p,format,tmp_path)
    assert p==before
    if format=='pdf':
        from pypdf import PdfReader
        text=' '.join(page.extract_text() for page in PdfReader(result['path']).pages)
        for marker in ['4.','5.','2.','3.']: assert marker in text
        return
    imported=import_document(Path(result['path']))['document']
    lists=[node for node in imported['content'] if node['type']=='ordered_list']
    assert [node['attrs']['order'] for node in lists]==[4,5,2,3]
    assert [node['attrs'].get('continuePrevious',False) for node in lists]==[False,True,False,True]
    lists[0]['content'].append({'type':'list_item','content':[para('Added')]})
    resolve_list_orders(imported)
    assert lists[1]['attrs']['order']==6
    if format=='docx':
        doc=Document(result['path']);ids=[p._p.pPr.numPr.numId.val for p in doc.paragraphs if p._p.pPr is not None and p._p.pPr.numPr is not None]
        assert ids[0]==ids[1] and ids[2]==ids[3] and ids[0]!=ids[2]


def test_continuation_is_scoped_and_validated():
    doc={'type':'doc','content':[listing('A',order=9),{'type':'blockquote','content':[listing('B',continuePrevious=True)]},listing('C',listStyle='upper-roman',continuePrevious=True),listing('D',continuePrevious=True)]}
    resolve_list_orders(doc)
    assert doc['content'][1]['content'][0]['attrs']['order']==1
    assert doc['content'][2]['attrs']['order']==1
    assert doc['content'][3]['attrs']['order']==10
    p=fixture();p['book']['chapters'][0]['document']['content'][0]['attrs']['continuePrevious']='yes'
    with pytest.raises(ValidationError): validate_project(p)
