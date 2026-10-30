from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile
import pytest
from alder.models import create_project,validate_project,document_text,ValidationError
from alder.publishing import build_export,import_document
from alder.outline_lists import outline_layout,next_label,validate_list_template


def template():
    result=[{'format':'decimal','pattern':'.'.join('%'+str(n+1) for n in range(i+1))+'.','start':1,'restart':i,'indent':24*(i+1),'hanging':18} for i in range(9)]
    result[1].update(format='lower-alpha',pattern='%1(%2)')
    result[2].update(format='lower-roman',pattern='%1.%2.%3',restart=0)
    return result


def fixture():
    paragraph=lambda text:{'type':'paragraph','content':[{'type':'text','text':text}]}
    def item(text,child=None):return {'type':'list_item','content':[paragraph(text)]+([child] if child else [])}
    def listing(items,attrs=None):return {'type':'ordered_list','attrs':attrs or {},'content':items}
    p=create_project(template='blank');p['settings'].update(documentKind='docx',includeTitle=False,includeToc=False,footer=False)
    p['name']='Outline numbering'
    p['book']={'version':1,'chapters':[{'id':'c','title':'Outline','include':True,'document':{'type':'doc','content':[
        listing([item('OUTLINE_A',listing([item('OUTLINE_a',listing([item('OUTLINE_i'),item('OUTLINE_ii')])),item('OUTLINE_b',listing([item('OUTLINE_iii')]))]))],{'listTemplate':template(),'order':3}),
        paragraph('Between lists'),
        listing([item('OUTLINE_B',listing([item('OUTLINE_c',listing([item('OUTLINE_iv')]))]))],{'listTemplate':template(),'continuePrevious':True}),
    ]}}]}
    return validate_project(p)


LABELS=['3.','3(a)','3.a.i','3.a.ii','3(b)','3.b.iii','4.','4(a)','4.a.iv']

def edge_fixture():
    p=fixture();doc=p['book']['chapters'][0]['document'];doc['content']=[]
    for fmt,start,count in [('upper-alpha',26,3),('upper-roman',3999,2),('square',1,2)]:
        rules=template();rules[0].update(format=fmt,pattern='▪' if fmt=='square' else '%1.')
        rules[1].update(format='decimal',pattern='%2.',restart=0)
        for index in range(count):
            doc['content'].extend([{'type':'bullet_list' if fmt=='square' else 'ordered_list','attrs':{'listTemplate':rules,'order':start,'continuePrevious':index>0},'content':[{'type':'list_item','content':[
                {'type':'paragraph','content':[{'type':'text','text':f'OUTLINE_{fmt}_{index}'}]},
                {'type':'ordered_list','content':[{'type':'list_item','content':[{'type':'paragraph','content':[{'type':'text','text':f'OUTLINE_{fmt}_{index}_child'}]}]}]},
            ]}]},{'type':'paragraph','content':[{'type':'text','text':'Separated list'}]}])
    return validate_project(p)

EDGE_LABELS=['Z.','1.','AA.','2.','BB.','3.','MMMCMXCIX.','1.','MMMM.','2.','▪','1.','▪','2.']
def labels(document):
    # Records are per list, so collect labels in document text order.
    values={id(item['node']):item['label'] for record in outline_layout(document) for item in record['items']}
    result=[]
    def walk(node):
        if id(node) in values:result.append(values[id(node)])
        for child in node.get('content',[]):walk(child)
    walk(document);return result


def test_outline_restart_continuation_and_validation():
    p=fixture();doc=p['book']['chapters'][0]['document'];before=deepcopy(doc)
    assert labels(doc)==LABELS
    assert doc==before
    assert '3.' not in document_text(doc)
    for patch in ({'restart':5},{'pattern':'%9'},{'indent':float('nan')},{'hanging':400},{'format':'other'}):
        bad=template();bad[1].update(patch)
        with pytest.raises(ValueError):validate_list_template(bad)


@pytest.mark.parametrize('format',['docx','html','epub'])
def test_outline_rules_survive_exchange(tmp_path,format):
    p=fixture();before=deepcopy(p);result=build_export(p,format,tmp_path);assert p==before
    imported=import_document(Path(result['path']))
    assert labels(imported['document'])==LABELS
    assert document_text(imported['document'])==document_text(p['book']['chapters'][0]['document'])
    if format=='docx':
        with ZipFile(result['path']) as archive:
            xml=archive.read('word/numbering.xml').decode()
            assert '%1(%2)' in xml and '%1.%2.%3' in xml and 'w:val="lowerRoman"' in xml


def test_pdf_and_markdown_use_calculated_outline_labels(tmp_path):
    from pypdf import PdfReader
    p=fixture()
    pdf=build_export(p,'pdf',tmp_path);text='\n'.join(page.extract_text() for page in PdfReader(pdf['path']).pages)
    for label in LABELS:assert label in text
    md=build_export(p,'md',tmp_path);text=Path(md['path']).read_text(encoding='utf-8')
    for label in LABELS:assert label in text
    assert any('outline numbering' in warning for warning in md['warnings'])

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_outline_extended_numbers_and_bullet_root_continue(tmp_path,format):
    p=edge_fixture()
    assert labels(p['book']['chapters'][0]['document'])==EDGE_LABELS
    result=build_export(p,format,tmp_path)
    assert labels(import_document(Path(result['path']))['document'])==EDGE_LABELS
