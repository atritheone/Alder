from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile
import pytest
from alder.models import create_project, validate_project, document_text, ValidationError
from alder.document_references import reference_values
from alder.publishing import build_export, import_document


def fixture():
    project = create_project(template='blank')
    project['settings'].update(documentKind='docx', includeTitle=False, footer=False)
    project['book'] = {'version':1, 'chapters':[{'id':'chapter', 'title':'Document', 'include':True, 'document':{'type':'doc','content':[
        {'type':'paragraph', 'content':[{'type':'text','text':'See '},{'type':'cross_reference','attrs':{'targetId':'heading'},'content':[{'type':'text','text':'Old heading'}]},{'type':'text','text':' and '},{'type':'cross_reference','attrs':{'targetId':'passage'},'content':[{'type':'text','text':'Old passage'}]}]},
        {'type':'heading','attrs':{'level':1,'blockId':'heading'},'content':[{'type':'text','text':'Current heading'}]},
        {'type':'paragraph','content':[{'type':'bookmark','attrs':{'name':'Passage','blockId':'passage','range':True}},{'type':'text','text':'Current passage'},{'type':'bookmark_end','attrs':{'targetId':'passage','name':'Passage'}}]},
    ]}}]}
    return validate_project(project)


def walk(node):
    yield node
    for child in node.get('content', []): yield from walk(child)


@pytest.mark.parametrize('format', ['html','epub','docx'])
def test_refresh_export_and_reopen_references_without_mutating_source(tmp_path, format):
    project = fixture(); before = deepcopy(project)
    result = build_export(project, format, tmp_path)
    assert project == before
    imported = import_document(Path(result['path']))
    project['book']['chapters'][0]['document'] = imported['document']
    project = validate_project(project)
    document = project['book']['chapters'][0]['document']
    references = [n for n in walk(document) if n['type'] == 'cross_reference']
    assert len(references) == 2
    values = reference_values([document])
    assert [values[ref['attrs']['targetId']] for ref in references] == ['Current heading','Current passage']
    assert [document_text(ref) for ref in references] == ['Current heading','Current passage']
    if format == 'docx':
        with ZipFile(result['path']) as archive:
            xml = archive.read('word/document.xml').decode()
            assert xml.count('<w:instrText ') == 2 and xml.count(' REF ') == 2


@pytest.mark.parametrize('format', ['pdf','txt','md'])
def test_plain_outputs_refresh_reference_wording(tmp_path,format):
    result=build_export(fixture(),format,tmp_path)
    if format=='pdf':
        from pypdf import PdfReader
        text='\n'.join(page.extract_text() for page in PdfReader(result['path']).pages)
    else: text=Path(result['path']).read_text(encoding='utf-8')
    assert 'Old heading' not in text and 'Old passage' not in text
    assert text.count('Current heading') == 2 and text.count('Current passage') == 2


def test_cycles_and_missing_targets_keep_cached_words(tmp_path):
    project = fixture(); document=project['book']['chapters'][0]['document']
    document['content'][1]['content']=[{'type':'cross_reference','attrs':{'targetId':'heading'},'content':[{'type':'text','text':'Retained words'}]}]
    del document['content'][2]
    result=build_export(project,'html',tmp_path)
    assert any('circular target' in message for message in result['warnings'])
    text=Path(result['path']).read_text(encoding='utf-8')
    assert 'Old heading' in text and 'Old passage' in text and 'Retained words' in text
    assert text.count('data-reference-unresolved="true"') == 3


def test_copied_chapters_retarget_their_own_fields_and_remain_idempotent():
    project=fixture(); copy=deepcopy(project['book']['chapters'][0]); copy['id']='copy'; project['book']['chapters'].append(copy)
    project=validate_project(project)
    a,b=[chapter['document'] for chapter in project['book']['chapters']]
    target=b['content'][1]['attrs']['blockId']
    assert target!=a['content'][1]['attrs']['blockId']
    assert b['content'][0]['content'][1]['attrs']['targetId']==target
    assert validate_project(project)==project


def test_word_complex_field_import_and_unsupported_field_cached_text(tmp_path):
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    project=fixture(); result=build_export(project,'docx',tmp_path)
    document=Document(result['path'])
    for field in list(document._element.iter(qn('w:fldSimple'))):
        parent=field.getparent(); at=parent.index(field); code=field.get(qn('w:instr'))
        nodes=[]
        for kind in ('begin','instruction','separate'):
            run=OxmlElement('w:r'); node=OxmlElement('w:instrText' if kind=='instruction' else 'w:fldChar')
            if kind=='instruction': node.text=code
            else: node.set(qn('w:fldCharType'),kind)
            run.append(node); nodes.append(run)
        nodes.extend(list(field)); run=OxmlElement('w:r'); end=OxmlElement('w:fldChar'); end.set(qn('w:fldCharType'),'end');run.append(end);nodes.append(run)
        parent.remove(field)
        for index,node in enumerate(nodes):parent.insert(at+index,node)
    extra=OxmlElement('w:fldSimple'); extra.set(qn('w:instr'),'DOCPROPERTY secret')
    run=OxmlElement('w:r'); text=OxmlElement('w:t');text.text='Cached property';run.append(text);extra.append(run);document.add_paragraph()._p.append(extra)
    path=tmp_path/'complex.docx';document.save(path)
    imported=import_document(path)
    refs=[n for n in walk(imported['document']) if n['type']=='cross_reference']
    assert len(refs)==2 and document_text(refs[0])=='Current heading'
    assert 'Cached property' in imported['text']
    assert any('unsupported Word field' in message for message in imported['warnings'])


def test_reject_malformed_field():
    project=fixture(); project['book']['chapters'][0]['document']['content'][0]['content'][1]['attrs']['targetId']='unsafe field instruction'
    with pytest.raises(ValidationError):validate_project(project)


@pytest.mark.parametrize('format', ['html','epub','docx'])
def test_heading_number_reference_survives_exchange_and_renumbering(tmp_path, format):
    project = fixture(); document = project['book']['chapters'][0]['document']
    heading = document['content'][1]
    heading['attrs'].update(level=2, headingNumbered=True, headingStart=4)
    ref = document['content'][0]['content'][1]
    ref['attrs']['referenceFormat'] = 'number'
    for exchange in range(2):
        result = build_export(project, format, tmp_path)
        document = import_document(Path(result['path']))['document']
        refs = [n for n in walk(document) if n['type'] == 'cross_reference']
        assert document_text(refs[0]) == ('1.4' if exchange == 0 else '1.7')
        assert refs[0]['attrs']['referenceFormat'] == 'number'
        heading = next(n for n in walk(document) if n['type'] == 'heading')
        assert refs[0]['attrs']['targetId'] == heading['attrs']['blockId']
        assert reference_values([document])[(heading['attrs']['blockId'], 'number')] == document_text(refs[0])
        assert not any(n['type'] == 'bookmark' and n['attrs']['name'].startswith('AlderHeading_') for n in walk(document))
        heading['attrs']['headingStart'] = 7
        project['book']['chapters'][0]['document'] = document


@pytest.mark.parametrize('format', ['html','epub','docx'])
def test_page_references_retain_native_format_and_cached_value(tmp_path, format):
    project=fixture()
    node=project['book']['chapters'][0]['document']['content'][0]['content'][1]
    node['attrs']['referenceFormat']='page'
    node['content']=[{'type':'text','text':'iv'}]
    result=build_export(project,format,tmp_path)
    document=import_document(Path(result['path']))['document']
    ref=next(n for n in walk(document) if n['type']=='cross_reference')
    assert ref['attrs']['referenceFormat']=='page' and document_text(ref)=='iv'
    if format=='docx':
        with ZipFile(result['path']) as archive: assert ' PAGEREF ' in archive.read('word/document.xml').decode()
