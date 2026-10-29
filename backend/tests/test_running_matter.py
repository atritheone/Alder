from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile
import pytest
from alder.models import create_project, validate_project, document_text
from alder.publishing import build_export, import_document
from alder.running_matter import validate_running_matter, resolve_running_matter, legacy_running_matter


def story(text, field=None):
    return {'type':'doc','content':[{'type':'paragraph','attrs':{'align':'right'},'content':[
        {'type':'text','text':text,'marks':[{'type':'strong'}]},
        *([{'type':'document_field','attrs':{'fieldKind':field},'content':[{'type':'text','text':'1'}]}] if field else []),
    ]}]}


def fixture():
    p=create_project(template='blank')
    p['settings'].update(documentKind='docx',includeTitle=False,runningMatter={
        'differentFirst':True,'differentEven':True,'headerDistanceMm':8,'footerDistanceMm':9,
        'header':{'default':story('ODD HEADER'),'first':story('FIRST HEADER'),'even':story('EVEN HEADER')},
        'footer':{'default':story('Page ', 'page'),'first':None,'even':story('Total ', 'pageCount')},
    })
    p['book']={'version':1,'chapters':[{'id':'chapter','title':'Document','include':True,'document':{'type':'doc','content':[
        {'type':'paragraph','content':[{'type':'text','text':'FIRST BODY'}]},
        {'type':'page_break'}, {'type':'paragraph','content':[{'type':'text','text':'SECOND BODY'}]},
        {'type':'section_break','attrs':{'kind':'nextPage','page':{},'runningMatter':{'differentFirst':False,'header':{'default':story('SECTION HEADER')}}}},
        {'type':'paragraph','content':[{'type':'text','text':'THIRD BODY'}]},
    ]}}]}
    return validate_project(p)


def test_running_stories_are_separate_validated_and_linked():
    p=fixture(); assert 'HEADER' not in p['book']['chapters'][0]['text']
    first=p['settings']['runningMatter']; before=deepcopy(first)
    resolved=resolve_running_matter(first,{'header':{'default':None}})
    assert first==before and resolved['header']['default'] is None
    assert document_text(resolved['header']['even'])=='EVEN HEADER'
    for value in ({'differentEven':1},{'headerDistanceMm':float('nan')},{'header':{'wrong':None}},{'header':{'default':{'type':'doc','content':[{'type':'section_break'}]}}}):
        with pytest.raises(ValueError):validate_running_matter(value)


def test_docx_running_stories_preserve_variants_fields_and_individual_links(tmp_path):
    p=fixture();before=deepcopy(p)
    result=build_export(p,'docx',tmp_path)
    assert p==before
    from docx import Document
    word=Document(result['path'])
    assert word.settings.odd_and_even_pages_header_footer
    assert word.sections[0].different_first_page_header_footer
    assert word.sections[0].first_page_header.paragraphs[0].text=='FIRST HEADER'
    assert word.sections[1].header.is_linked_to_previous is False
    assert word.sections[1].even_page_header.is_linked_to_previous is True
    assert word.sections[1].footer.is_linked_to_previous is True
    opened=import_document(Path(result['path']))
    matter=opened['settings']['runningMatter']
    assert matter['differentFirst'] and matter['differentEven']
    assert document_text(matter['header']['even'])=='EVEN HEADER'
    section=next(n for n in opened['document']['content'] if n['type']=='section_break')
    assert document_text(section['attrs']['runningMatter']['header']['default'])=='SECTION HEADER'
    assert 'even' not in section['attrs']['runningMatter']['header']
    assert 'footer' not in section['attrs']['runningMatter']
    p['settings'].update(opened['settings']);p['book']['chapters'][0]['document']=opened['document'];validate_project(p)


@pytest.mark.parametrize('format',['html','epub'])
def test_reflowable_exchange_preserves_running_metadata_and_section_links(tmp_path,format):
    p=fixture()
    result=build_export(p,format,tmp_path)
    opened=import_document(Path(result['path']))
    assert document_text(opened['settings']['runningMatter']['header']['first'])=='FIRST HEADER'
    section=next(n for n in opened['document']['content'] if n['type']=='section_break')
    assert document_text(section['attrs']['runningMatter']['header']['default'])=='SECTION HEADER'
    assert 'even' not in section['attrs']['runningMatter']['header']
    assert any('header/footer metadata' in warning for warning in result['warnings'])


def test_direct_pdf_renders_running_paragraph_variants_and_reports_cached_totals(tmp_path):
    from pypdf import PdfReader
    result=build_export(fixture(),'pdf',tmp_path)
    pages=[page.extract_text() for page in PdfReader(result['path']).pages]
    assert len(pages)==3
    for page,header,body in zip(pages,['FIRST HEADER','EVEN HEADER','SECTION HEADER'],['FIRST BODY','SECOND BODY','THIRD BODY']):
        assert header in page and body in page
    assert 'Page 3' in pages[2]
    assert any('total-page field' in warning for warning in result['warnings'])
    p=fixture();p['settings']['runningMatter']['header']['first']=story('Too tall')
    p['settings']['runningMatter']['header']['first']['content'][0]['attrs']['fontSize']=72
    with pytest.raises(ValueError,match='header needs more room'):build_export(p,'pdf',tmp_path)
