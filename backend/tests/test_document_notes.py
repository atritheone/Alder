from pathlib import Path
import pytest
from alder.models import create_project, validate_project, document_text, validate_document
from alder.document_notes import notes
from alder.publishing import build_export, import_document


def fixture():
    project=create_project(template='blank')
    project['settings'].update(documentKind='docx',includeTitle=False,pageSize='A5',marginMm=20)
    def note(identifier,kind,text):
        return {'type':'document_note','attrs':{'blockId':identifier,'kind':kind,'body':{'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':text,'marks':[{'type':'strong'}]},{'type':'text','text':' Visit source.','marks':[{'type':'link','attrs':{'href':'https://example.com/source'}}]}]},{'type':'paragraph','content':[{'type':'text','text':'Second note paragraph.'}]}]}}}
    project['book']={'version':1,'chapters':[{'id':'main','title':'Document','include':True,'document':{'type':'doc','content':[
        {'type':'paragraph','content':[{'type':'text','text':'BODY FIRST sentence.'},note('first','footnote','FOOTNOTE ONE'),{'type':'text','text':' Following words.'}]},
        {'type':'paragraph','content':[{'type':'text','text':'BODY SECOND sentence.'},note('second','footnote','FOOTNOTE TWO')]},
        {'type':'paragraph','content':[{'type':'text','text':'BODY FINAL sentence.'},note('third','endnote','ENDNOTE ONE')]}
    ]}}]}
    return validate_project(project)

def test_word_requires_measured_note_geometry_and_refuses_clipped_continuations(tmp_path):
    p=fixture();p['book']['chapters'][0]['document']['content'].insert(1,{'type':'section_break','attrs':{'kind':'nextPage','page':{'pageSize':'A4'}}})
    with pytest.raises(ValueError,match='desktop DOCX export'):build_export(p,'docx',tmp_path)
    with pytest.raises(ValueError,match='Word can clip footnotes'):build_export(p,'docx',tmp_path,{'measuredNoteGeometry':True})
    with pytest.raises(ValueError,match='Invalid measured footnote'):build_export(p,'docx',tmp_path,{'measuredNoteGeometry':'false'})
    # Different sections are safe when actual desktop layout establishes that
    # no individual footnote continues between their differing page frames.
    result=build_export(p,'docx',tmp_path,{'measuredNoteGeometry':False})
    assert len(notes([import_document(Path(result['path']))['document']]))==3

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_section_note_settings_and_native_continuous_counts_roundtrip(tmp_path,format):
    import copy
    from alder.note_options import note_options
    from alder.document_notes import number_notes
    from alder.publication_layout import prepare_layout
    project=fixture();base=note_options();base['footnote']['start']=3;project['settings']['noteOptions']=base
    roman=note_options();roman['footnote'].update(format='upperRoman',start=7)
    alpha=note_options();alpha['footnote'].update(format='lowerLetter',start=2,restart='section')
    decimal=note_options();decimal['footnote']['start']=8
    original=copy.deepcopy(project['book']['chapters'][0]['document']['content'][0]);blocks=[]
    for index,options in enumerate([None,roman,alpha,None,decimal]):
        if index:blocks.append({'type':'section_break','attrs':{'kind':'nextPage','page':{'pageSize':'A5','marginMm':20},'noteOptions':options}})
        for j in range(2):
            node=copy.deepcopy(original);node['content'][1]['attrs']['blockId']=f'note_{index}_{j}';blocks.append(node)
    document=project['book']['chapters'][0]['document']={'type':'doc','content':blocks}
    number_notes([document],base)
    expected=['3','4','IX','X','b','c','b','c','16','17']
    assert [n['attrs']['_noteLabel'] for n in notes([document])]==expected
    result=build_export(project,format,tmp_path);restored=import_document(Path(result['path']))
    number_notes([restored['document']],restored['settings']['noteOptions'])
    assert [n['attrs']['_noteLabel'] for n in notes([restored['document']])]==expected
    overrides=[n['attrs'].get('noteOptions') for n in restored['document']['content'] if n['type']=='section_break']
    assert overrides==[roman,alpha,None,decimal]
    assert not any('Section-specific Word note' in warning for warning in restored['warnings'])
    if format=='docx':
        snapshot=prepare_layout(project)
        assert [n['attrs'].get('noteOptions') for n in snapshot['document']['content'] if n['type']=='section_break']==overrides

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_note_images_keep_bytes_crop_and_descriptions_in_exchange(tmp_path,format):
    import io,base64,zipfile
    from PIL import Image
    from lxml import etree
    from docx.oxml.ns import qn
    data=io.BytesIO();Image.new('RGB',(80,40),'navy').save(data,'PNG')
    project=fixture();body=notes([project['book']['chapters'][0]['document']])[0]['attrs']['body']
    project['assets']=[{'id':'sample','name':'sample.png','mime':'image/png','data':base64.b64encode(data.getvalue()).decode()}]
    attrs={'assetId':'sample','src':'asset:sample','width':60,'alt':'A navy sample','crop':{'left':10,'right':20,'top':0,'bottom':0}}
    body['content'][0]['content'].insert(1,{'type':'inline_image','attrs':attrs})
    body['content'].append({'type':'image','attrs':{**attrs,'decorative':True,'align':'right'}})
    project=validate_project(project)
    result=build_export(project,format,tmp_path);restored=import_document(Path(result['path']))
    found=[]
    def visit(node):
        if node['type'] in ('image','inline_image'):found.append(node['attrs'])
        for child in node.get('content',[]):visit(child)
    visit(notes([restored['document']])[0]['attrs']['body'])
    assert len(found)==2
    assert found[0]['alt']==attrs['alt'] and found[0]['crop']==attrs['crop']
    assert found[1]['decorative'] is True and found[1]['align']=='right'
    if format=='docx':
        assert len(restored['assets'])==1
        with zipfile.ZipFile(result['path']) as package:
            rels=etree.fromstring(package.read('word/_rels/footnotes.xml.rels'))
            assert any(row.get('Type','').endswith('/image') for row in rels)
            root=etree.fromstring(package.read('word/footnotes.xml'))
            assert len(list(root.iter(qn('wp:inline'))))==2
    else:
        assert all(a['src'].startswith('asset:') and a.get('assetId') for a in found)
        assert restored['assets']

def test_note_asset_validation_traverses_the_separate_story():
    project=fixture();body=notes([project['book']['chapters'][0]['document']])[0]['attrs']['body']
    body['content'][0]['content'].append({'type':'inline_image','attrs':{'assetId':'missing','src':'asset:missing'}})
    with pytest.raises(ValueError,match='missing project asset'):validate_project(project)


def test_word_note_parts_and_link_relationships_roundtrip(tmp_path):
    result=build_export(fixture(),'docx',tmp_path)
    restored=import_document(Path(result['path']))
    found=notes([restored['document']])
    assert len(found)==3
    assert [node['attrs']['kind'] for node in found]==['footnote','footnote','endnote']
    assert [document_text(node['attrs']['body']).strip() for node in found]==[f'{text} Visit source.\nSecond note paragraph.' for text in ['FOOTNOTE ONE','FOOTNOTE TWO','ENDNOTE ONE']]
    for node in found:
        assert node['attrs']['body']['content'][0]['content'][0]['marks'][0]['type']=='strong'
        assert any(mark.get('attrs',{}).get('href')=='https://example.com/source' for child in node['attrs']['body']['content'][0]['content'] for mark in child.get('marks',[]))
    assert 'FOOTNOTE' not in document_text(restored['document'])


def test_notes_are_validated_inside_the_document_resource_limits():
    project=fixture();note=notes([project['book']['chapters'][0]['document']])[0]
    note['attrs']['body']['content'][0]['content'].append({'type':'document_note','attrs':note['attrs'].copy()})
    with pytest.raises(ValueError,match='formatted paragraphs'):validate_document(project['book']['chapters'][0]['document'])


@pytest.mark.parametrize('format',['html','epub'])
def test_portable_notes_preserve_bodies_without_duplicate_authored_text(tmp_path,format):
    result=build_export(fixture(),format,tmp_path)
    doc=import_document(Path(result['path']))['document']
    found=notes([doc]);assert len(found)==3
    assert 'FOOTNOTE' not in document_text(doc)
    assert 'FOOTNOTE ONE' in document_text(found[0]['attrs']['body'])


@pytest.mark.parametrize('format',['txt','md'])
def test_plain_outputs_keep_note_wording_and_report_conversion(tmp_path,format):
    result=build_export(fixture(),format,tmp_path)
    text=Path(result['path']).read_text(encoding='utf-8')
    assert 'BODY FIRST sentence.[Footnote 1]' in text
    for label in ('FOOTNOTE ONE','FOOTNOTE TWO','ENDNOTE ONE'):assert text.count(label)==1
    assert any('note' in message.lower() for message in result['warnings'])


def test_headless_pdf_never_silently_drops_notes(tmp_path):
    with pytest.raises(ValueError,match='desktop PDF'):build_export(fixture(),'pdf',tmp_path)

def test_word_numbering_conversion_is_reported_and_custom_mark_rejected(tmp_path):
    from docx import Document
    from docx.oxml.ns import qn
    result=build_export(fixture(),'docx',tmp_path)
    doc=Document(result['path'])
    doc.settings.element.find(qn('w:footnotePr')).find(qn('w:numFmt')).set(qn('w:val'),'chicago')
    changed=tmp_path/'numbering.docx';doc.save(changed)
    restored=import_document(changed)
    assert any('note numbering' in warning for warning in restored['warnings'])
    next(doc.element.iter(qn('w:footnoteReference'))).set(qn('w:customMarkFollows'),'1')
    doc.save(changed)
    with pytest.raises(ValueError,match='Custom Word note'):import_document(changed)

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_configurable_note_numbering_and_placement_survive_exchange(tmp_path,format):
    from alder.note_options import note_options
    from alder.document_notes import number_notes
    project=fixture();options=note_options()
    options['footnote'].update(format='upperRoman',start=3,restart='section',placement='beneathText')
    options['endnote'].update(format='decimal',start=5)
    project['settings']['noteOptions']=options
    blocks=project['book']['chapters'][0]['document']['content'];blocks.insert(1,{'type':'section_break','attrs':{'kind':'nextPage'}})
    number_notes([project['book']['chapters'][0]['document']],options)
    assert [node['attrs']['_noteLabel'] for node in notes([project['book']['chapters'][0]['document']])]==['III','III','5']
    result=build_export(project,format,tmp_path);restored=import_document(Path(result['path']))
    assert restored['settings']['noteOptions']==options

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_note_cross_references_retain_the_note_target(tmp_path,format):
    from alder.document_references import reference_values
    project=fixture();doc=project['book']['chapters'][0]['document']
    doc['content'].append({'type':'paragraph','content':[{'type':'text','text':'See note '},{'type':'cross_reference','attrs':{'targetId':'second','referenceFormat':'number'},'content':[{'type':'text','text':'stale'}]}]})
    result=build_export(project,format,tmp_path);restored=import_document(Path(result['path']))['document']
    refs=[node for paragraph in restored['content'] for node in paragraph.get('content',[]) if node['type']=='cross_reference']
    assert len(refs)==1 and refs[0]['attrs']['referenceFormat']=='number'
    assert refs[0]['attrs']['targetId']==notes([restored])[1]['attrs']['blockId']
    assert document_text(refs[0])=='2'
    assert not any(node['type']=='bookmark' and node['attrs']['name'].startswith('AlderNote_') for paragraph in restored['content'] for node in paragraph.get('content',[]))

def test_page_restart_is_native_word_and_desktop_references_use_stable_note_ids(tmp_path):
    from alder.note_options import note_options
    from alder.publication_layout import prepare_layout
    from docx import Document
    from docx.oxml.ns import qn
    project=fixture();options=note_options();options['footnote'].update(start=3,restart='page')
    project['settings']['noteOptions']=options
    project['book']['chapters'][0]['document']['content'].append({'type':'paragraph','content':[{'type':'cross_reference','attrs':{'targetId':'second','referenceFormat':'number'},'content':[{'type':'text','text':'stale'}]}]})
    result=build_export(project,'docx',tmp_path)
    word=Document(result['path'])
    assert word.sections[0]._sectPr.find(qn('w:footnotePr')).find(qn('w:numRestart')).get(qn('w:val'))=='eachPage'
    assert import_document(Path(result['path']))['settings']['noteOptions']==options
    snapshot=prepare_layout(project)
    reference=snapshot['document']['content'][-1]['content'][0]
    assert reference['attrs']['targetId']=='second'
    options['endnote']['restart']='page'
    with pytest.raises(ValueError,match='restart'):note_options(options)
