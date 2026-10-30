from pathlib import Path
import pytest
from alder.models import create_project,validate_project,document_text
from alder.document_notes import notes
from alder.publishing import build_export,import_document

def paragraph(text):
    return {'type':'paragraph','content':[{'type':'text','text':text}] if text else []}

def body():
    return {'type':'doc','content':[
        paragraph('A formatted note.'),
        {'type':'ordered_list','attrs':{'order':3,'listStyle':'upper-roman'},'content':[
            {'type':'list_item','content':[paragraph('First entry'),{'type':'bullet_list','content':[{'type':'list_item','content':[paragraph('Nested entry')]}]}]},
            {'type':'list_item','content':[paragraph('Second entry')]},
        ]},
        {'type':'table','content':[
            {'type':'table_row','attrs':{'allowSplit':True},'content':[
                {'type':'table_header','attrs':{'colwidth':[100]},'content':[paragraph('Name')]},
                {'type':'table_header','attrs':{'colwidth':[200]},'content':[paragraph('Value')]},
            ]},
            {'type':'table_row','attrs':{'allowSplit':True},'content':[
                {'type':'table_cell','attrs':{'colwidth':[100]},'content':[paragraph('Sample')]},
                {'type':'table_cell','attrs':{'colwidth':[200],'background':'#ffeeaa'},'content':[paragraph('An explanation')]},
            ]},
        ]},paragraph('Final note paragraph.'),
    ]}

def fixture(kind='footnote'):
    project=create_project(template='blank')
    project['settings'].update(documentKind='docx',includeTitle=False,pageSize='A5',marginMm=20)
    project['book']={'version':1,'chapters':[{'id':'main','title':'Document','include':True,'document':{'type':'doc','content':[
        {'type':'paragraph','content':[{'type':'text','text':'Authored body.'},{'type':'document_note','attrs':{'blockId':'richnote','kind':kind,'body':body()}}]},paragraph('Following body.')
    ]}}]}
    return validate_project(project)

@pytest.mark.parametrize('kind',['footnote','endnote'])
@pytest.mark.parametrize('format',['docx','html','epub'])
def test_lists_and_tables_in_notes_survive_exchange(tmp_path,kind,format):
    project=fixture(kind);result=build_export(project,format,tmp_path)
    restored=import_document(Path(result['path']))
    found=notes([restored['document']]);assert len(found)==1
    actual=found[0]['attrs']['body']
    assert document_text(actual).strip()==document_text(body())
    listing=next(node for node in actual['content'] if node['type']=='ordered_list')
    assert listing['attrs']['order']==3 and listing['attrs']['listStyle']=='upper-roman'
    assert listing['content'][0]['content'][1]['type']=='bullet_list'
    table=next(node for node in actual['content'] if node['type']=='table')
    assert len(table['content'])==2
    assert table['content'][0]['content'][0]['type']=='table_header'
    assert table['content'][1]['content'][0]['attrs']['colwidth']==[100]
    assert not any('complex Word note object' in item for item in restored['warnings'])

def test_rich_note_still_rejects_recursive_notes_and_page_breaks():
    project=fixture();note=notes([project['book']['chapters'][0]['document']])[0]
    note['attrs']['body']['content'][2]['content'][0]['content'][0]['content'].append({'type':'page_break'})
    with pytest.raises(ValueError,match='formatted paragraphs'):validate_project(project)

def test_note_outline_templates_and_separated_list_continuations_are_native_word(tmp_path):
    from copy import deepcopy
    from alder.outline_lists import outline_layout
    project=fixture();story=notes([project['book']['chapters'][0]['document']])[0]['attrs']['body']
    template=[{'format':'decimal','pattern':'.'.join('%'+str(n+1) for n in range(i+1))+'.','start':1,'restart':i,'indent':24*(i+1),'hanging':18} for i in range(9)]
    listing=story['content'][1];listing['attrs']['listTemplate']=template
    second=deepcopy(listing);second['attrs']['continuePrevious']=True
    story['content'].extend([paragraph('Between lists'),second])
    result=build_export(project,'docx',tmp_path)
    restored=notes([import_document(Path(result['path']))['document']])[0]['attrs']['body']
    records=outline_layout(restored)
    assert [item['label'] for record in records for item in record['items']]==['3.','4.','3.1.','5.','6.','5.1.']
    assert records[0]['template']==[{**template[0],'start':3},*template[1:]]


@pytest.mark.parametrize('kind',['footnote','endnote'])
def test_measured_note_overflow_uses_modern_word_layout_without_changing_authored_rows(tmp_path,kind):
    from copy import deepcopy
    from zipfile import ZipFile
    from lxml import etree
    project=fixture(kind)
    table=notes([project['book']['chapters'][0]['document']])[0]['attrs']['body']['content'][2]
    for row,id in zip(table['content'],['short-note-row','long-note-row']):
        row['attrs'].update(allowSplit=False,blockId=id)
    table['content'][1]['content'][0]['content']=[paragraph('Long note row '+str(i)) for i in range(70)]
    original=deepcopy(project)
    exported=build_export(project,'docx',tmp_path,{'measuredRowSplits':['long-note-row']})
    assert project==original
    assert any('row taller than a page' in item for item in exported['warnings'])
    ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    with ZipFile(exported['path']) as archive:
        root=etree.fromstring(archive.read('word/'+kind+'s.xml'))
        rows=root.findall('.//w:tr',ns)
        assert rows[0].find('w:trPr/w:cantSplit',ns) is not None
        assert rows[1].find('w:trPr/w:cantSplit',ns) is None
        settings=etree.fromstring(archive.read('word/settings.xml'))
        assert settings.xpath('string(w:compat/w:compatSetting[@w:name="compatibilityMode"]/@w:val)',namespaces=ns)=='15'
    restored=notes([import_document(Path(exported['path']))['document']])[0]['attrs']['body']
    assert document_text(restored).count('Long note row ')==70
