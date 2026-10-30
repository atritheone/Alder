from pathlib import Path
import json
import zipfile
import pytest
from alder.models import create_project,validate_project,document_text
from alder.document_index import validate_entry,groups,entries,xe_instruction,read_xe
from alder.document_contents import refresh_contents
from alder.publishing import build_export,import_document

def fixture():
    p=create_project(template='blank');p['name']='Index qualification'
    p['settings'].update(documentKind='docx',includeTitle=False,pageSize='A5',marginMm=20)
    p['styles'].append({'id':'indexStyle','name':'Index entries','kind':'paragraph','fontFamily':'Arial','fontSize':14})
    def entry(id,terms,see=None):return {'type':'index_entry','attrs':{'blockId':id,'terms':terms,'see':see}}
    def paragraph(text,*marks):return {'type':'paragraph','content':[{'type':'text','text':text},*marks]}
    p['book']={'version':1,'chapters':[{'id':'main','title':'Document','include':True,'document':{'type':'doc','content':[
        paragraph('FIRST BODY alder and fruit.',entry('one',['Trees','Alder']),entry('two',['Fruit']),entry('three',['Trees','Alder']),entry('see',['Birch'],'See Trees')),
        {'type':'page_break'},paragraph('SECOND BODY apple and alder.',entry('four',['Apple']),entry('five',['Trees','Alder'])),
        {'type':'page_break'},{'type':'table_of_contents','attrs':{'kind':'index','title':'Index','depth':3,'entryStyle':'indexStyle'},'content':[paragraph('Placeholder')]}
    ]}}]}
    return validate_project(p)

def test_index_hierarchy_and_authored_wording():
    p=fixture();doc=p['book']['chapters'][0]['document'];before=document_text(doc)
    refresh_contents([doc]);index=doc['content'][-1]
    assert [document_text(row) for row in index['content']]==['Index','Apple, —','Birch. See Trees','Fruit, —','Trees','Alder, —']
    refs=[child for row in index['content'] for child in row.get('content',[]) if child['type']=='index_reference']
    assert refs[-1]['attrs']['targetIds']==['one','three','five']
    refs[-1]['content']=[{'type':'text','text':'1, 2'}];index['content'][-1]['attrs']['fontSize']=17
    refresh_contents([doc]);assert document_text(doc['content'][-1]['content'][-1])=='Alder, 1, 2'
    assert doc['content'][-1]['content'][-1]['attrs']['fontSize']==17
    assert before.startswith('FIRST BODY alder and fruit.') and 'See Trees' not in before

def range_fixture():
    p=fixture();blocks=p['book']['chapters'][0]['document']['content']
    blocks[0]['content'].insert(0,{'type':'bookmark','attrs':{'blockId':'passage','name':'WholePassage','range':True}})
    blocks[2]['content'].append({'type':'bookmark_end','attrs':{'targetId':'passage','name':'WholePassage'}})
    next(n for n in blocks[0]['content'] if n.get('attrs',{}).get('blockId')=='two')['attrs']['rangeId']='passage'
    return validate_project(p)

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_index_page_ranges_exchange_and_bind_identity(tmp_path,format):
    source=range_fixture();result=build_export(source,format,tmp_path)
    restored=import_document(Path(result['path']))
    project=fixture();project['book']['chapters'][0]['document']=restored['document'];project=validate_project(project)
    doc=project['book']['chapters'][0]['document']
    def walk(n):
        yield n
        for c in n.get('content',[]):yield from walk(c)
    bookmark=next(n for n in walk(doc) if n['type']=='bookmark' and n['attrs']['name']=='WholePassage')
    entry=next(a for a in entries([doc]) if a['terms']==['Fruit'])
    assert entry['rangeId']==bookmark['attrs']['blockId']
    assert bookmark['attrs']['range']
    if format=='docx':
        with zipfile.ZipFile(result['path']) as archive:assert ' XE "Fruit" \\r WholePassage ' in archive.read('word/document.xml').decode()

def test_index_page_range_field_and_missing_range_refusal(tmp_path):
    from alder.publication_layout import prepare_layout
    snapshot=prepare_layout(range_fixture())
    assert all('rangeName' not in a for a in entries([snapshot['document']]))
    for quoted in ('WholePassage','"WholePassage"'):
        node=read_xe(' XE "Fruit" \\r '+quoted,[])
        assert node['attrs']['rangeId']=='WholePassage'
    attrs={'terms':['Fruit'],'rangeId':'passage','rangeName':'WholePassage'}
    assert '\\r WholePassage' in xe_instruction(attrs)
    with pytest.raises(ValueError):validate_entry({**attrs,'see':'See other'})
    with pytest.raises(ValueError):validate_entry({**attrs,'rangeId':'bad id'})
    p=range_fixture();p['book']['chapters'][0]['document']['content'][2]['content'].pop()
    with pytest.raises(ValueError,match='missing or incomplete bookmark'):build_export(p,'docx',tmp_path)

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_index_exchange(tmp_path,format):
    result=build_export(fixture(),format,tmp_path);restored=import_document(Path(result['path']))
    assert [entry['terms'] for entry in entries([restored['document']])]==[['Trees','Alder'],['Fruit'],['Trees','Alder'],['Birch'],['Apple'],['Trees','Alder']]
    assert next(node for node in restored['document']['content'] if node['type']=='table_of_contents')['attrs']['kind']=='index'
    if format=='docx':
        with zipfile.ZipFile(result['path']) as archive:xml=archive.read('word/document.xml').decode()
        assert ' INDEX ' in xml and ' XE ' in xml

@pytest.mark.parametrize('terms', [['Colon: entry','A "quote"'],['Path\\','After'],['Simple'],['Élan','Leaf','Third']])
def test_word_index_instructions_escape_content(terms):
    attrs={'terms':terms,'see':'See "Trees"'}
    restored=read_xe(xe_instruction(attrs),[])
    assert restored['attrs']['terms']==terms and restored['attrs']['see']==attrs['see']

@pytest.mark.parametrize('value',[{'terms':[]},{'terms':['']},{'terms':['Main','']},{'terms':['One']*4},{'terms':['line\nbreak']},{'terms':['Term'],'see':5}])
def test_index_entry_validation(value):
    with pytest.raises(ValueError):validate_entry(value)


@pytest.mark.parametrize('mixed', [False, True])
def test_native_index_without_alder_content_control(tmp_path, mixed):
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    result = build_export(fixture(), 'docx', tmp_path)
    word = Document(result['path'])
    sdt = word._element.body.find(qn('w:sdt'))
    children = list(sdt.find(qn('w:sdtContent')))
    # The title is ordinary authored text outside Word's generated INDEX field.
    if mixed:
        run = OxmlElement('w:r'); text = OxmlElement('w:t')
        text.text = ' KEEP THIS AUTHORED SUFFIX'; run.append(text)
        children[-1].append(run)
    for child in children: sdt.addprevious(child)
    sdt.getparent().remove(sdt)
    path = tmp_path / 'native.docx'; word.save(path)
    restored = import_document(path)['document']
    indexes = [node for node in restored['content'] if node['type'] == 'table_of_contents']
    assert len(indexes) == (0 if mixed else 1)
    if mixed: assert 'KEEP THIS AUTHORED SUFFIX' in document_text(restored)
    else:
        assert indexes[0]['attrs']['title'] == ''
        assert indexes[0]['attrs']['kind'] == 'index'
        assert len(entries([restored])) == 6
