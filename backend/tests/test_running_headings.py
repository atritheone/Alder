from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile
import pytest
from alder.models import create_project, validate_project, document_text
from alder.publishing import build_export, import_document
from alder.document_fields import read_field
from alder.document_comments import walk


def fixture(custom=False):
    def paragraph(text):return {'type':'paragraph','content':[{'type':'text','text':text}]}
    def heading(text,level=1):return {'type':'heading','attrs':{'level':level,**({'styleId':'chapter-style'} if custom and level==1 else {})},'content':[{'type':'text','text':text}]}
    def field(kind):return {'type':'document_field','attrs':{'fieldKind':kind},'content':[{'type':'text','text':'Old'}]}
    p=create_project(template='blank');p['name']='Running heading fixture'
    p['settings'].update(documentKind='docx',includeTitle=False,includeToc=False,footer=False)
    p['settings']['runningMatter']={'header':{'default':{'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':'CHAPTER: '},field('heading1')]}]}}}
    if custom:p['styles'].append({'id':'chapter-style','name':'Chapter heading','fontFamily':'Cambria','fontSize':18})
    p['book']={'version':1,'chapters':[{'id':'c','title':'Chapter','include':True,'document':{'type':'doc','content':[
        paragraph('FIRST BODY'),{'type':'page_break'},heading('Alpha'),paragraph('SECOND BODY'),heading('Beta'),heading('Detail',2),{'type':'page_break'},paragraph('THIRD BODY'),{'type':'page_break'},heading('Gamma'),{'type':'paragraph','content':[{'type':'text','text':'Current: '},field('heading1')]},paragraph('FOURTH BODY')
    ]}}]}
    return validate_project(p)


@pytest.mark.parametrize('format',['docx','html','epub'])
@pytest.mark.parametrize('custom',[False,True])
def test_running_heading_fields_preserve_identity_and_body_resolution(tmp_path,format,custom):
    p=fixture(custom);before=deepcopy(p);result=build_export(p,format,tmp_path);assert p==before
    opened=import_document(Path(result['path']))
    body=[n for n in walk(opened['document']) if n['type']=='document_field']
    assert [(n['attrs']['fieldKind'],document_text(n)) for n in body]==[('heading1','Gamma')]
    header=opened['settings']['runningMatter']['header']['default']
    assert next(n for n in walk(header) if n['type']=='document_field')['attrs']['fieldKind']=='heading1'
    if format=='docx':
        with ZipFile(result['path']) as archive:
            xml=archive.read('word/header1.xml').decode()
            assert ('STYLEREF "Alder Chapter heading"' if custom else 'STYLEREF 1 ') in xml


def test_docx_rejects_ambiguous_heading_style_bindings(tmp_path):
    p=fixture(True);p['book']['chapters'][0]['document']['content'].append({'type':'heading','attrs':{'level':1},'content':[{'type':'text','text':'Another style'}]})
    with pytest.raises(ValueError,match='same dedicated style'):build_export(p,'docx',tmp_path)
    p=fixture(True);p['book']['chapters'][0]['document']['content'][0]['attrs']={'styleId':'chapter-style'}
    with pytest.raises(ValueError,match='not shared with other text'):build_export(p,'docx',tmp_path)


def test_only_supported_styleref_semantics_are_imported():
    assert read_field('STYLEREF 1 \\* CHARFORMAT')=='heading1'
    assert read_field('STYLEREF "Heading 6"')=='heading6'
    assert read_field('STYLEREF "Chapter title"',{'chapter title':'heading2'})=='heading2'
    for instruction in ['STYLEREF 1 \\l','STYLEREF 1 \\n','STYLEREF 1 \\p','STYLEREF "Unknown"','STYLEREF 7']:
        assert read_field(instruction) is None


def test_plain_body_fields_refresh_without_a_page_layout(tmp_path):
    result=build_export(fixture(),'txt',tmp_path)
    assert 'Current: Gamma' in Path(result['path']).read_text(encoding='utf-8')


def test_direct_pdf_resolves_printed_running_headings(tmp_path):
    from pypdf import PdfReader
    result=build_export(fixture(),'pdf',tmp_path)
    pages=[p.extract_text() for p in PdfReader(result['path']).pages]
    assert len(pages)==4,pages
    for page,heading in zip(pages,['Alpha','Alpha','Beta','Gamma']):assert 'CHAPTER: '+heading in page,(heading,page)


def test_publication_title_is_not_a_chapter_heading(tmp_path):
    from alder.publication_layout import prepare_layout
    from pypdf import PdfReader
    p=fixture();p['settings']['includeTitle']=True
    prepared=prepare_layout(p)
    assert prepared['document']['content'][0]['type']=='paragraph'
    result=build_export(p,'pdf',tmp_path)
    first=PdfReader(result['path']).pages[0].extract_text()
    assert 'CHAPTER: Alpha' in first and 'Running heading fixture' in first


def test_import_does_not_broaden_a_native_style_reference_to_other_heading_styles(tmp_path):
    from docx import Document
    from docx.enum.style import WD_STYLE_TYPE
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    path=Path(build_export(fixture(),'docx',tmp_path)['path'])
    doc=Document(path);doc.styles.add_style('Other chapter',WD_STYLE_TYPE.PARAGRAPH)
    p=doc.add_paragraph('Other styled chapter',style='Other chapter')
    outline=OxmlElement('w:outlineLvl');outline.set(qn('w:val'),'0');p._p.get_or_add_pPr().append(outline);doc.save(path)
    opened=import_document(path)
    assert not any(n['type']=='document_field' for n in walk(opened['settings']['runningMatter']['header']['default']))
    assert any('unsupported' in message.lower() for message in opened['warnings'])
