from pathlib import Path
import pytest
from docx import Document
from pypdf import PdfReader
from alder.models import create_project, validate_project, validate_document, ValidationError, document_text
from alder.publishing import build_export, import_document


def paragraph(text):
    return {'type': 'paragraph', 'content': [{'type': 'text', 'text': text}]}


def fixture(kind='nextPage'):
    page = {'pageSize': 'A5', 'orientation': 'landscape', 'marginTopMm': 15, 'marginBottomMm': 17, 'marginLeftMm': 19, 'marginRightMm': 21}
    doc = {'type': 'doc', 'content': [paragraph('FIRST_MARKER'), {'type': 'section_break', 'attrs': {'kind': kind, 'page': page}}, paragraph('SECOND_MARKER')]}
    project = create_project(template='blank')
    project['settings'].update(documentKind='docx', includeTitle=False, footer=False, pageSize='A4')
    project['book'] = {'version': 1, 'chapters': [{'id': 'sections', 'title': 'Document', 'document': doc, 'text': document_text(doc), 'include': True}]}
    return validate_project(project)


@pytest.mark.parametrize('kind,count', [('nextPage', 2), ('oddPage', 3), ('evenPage', 2)])
@pytest.mark.parametrize('first_number', [1, 8])
def test_sections_docx_pdf_and_html_round_trip(tmp_path, kind, count, first_number):
    p = fixture(kind)
    p['settings'].update(firstPageNumber=first_number, header='RUNNING_HEADER', footer=True)
    if first_number % 2 == 0 and kind != 'nextPage':
        count = 5 - count
    source = p['book']['chapters'][0]['document']
    word = build_export(p, 'docx', tmp_path)['path']
    doc = Document(word)
    assert len(doc.sections) == 2
    assert doc.sections[0].page_width.mm == pytest.approx(210, abs=.03)
    assert doc.sections[1].page_height.mm == pytest.approx(148, abs=.03)
    assert doc.sections[1].left_margin.mm == pytest.approx(19, abs=.03)
    assert doc.sections[1]._sectPr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}pgNumType') is None
    imported = import_document(word)
    assert imported['settings']['firstPageNumber'] == first_number
    assert document_text(imported['document']) == document_text(source)
    boundary = imported['document']['content'][1]
    assert boundary['type'] == 'section_break'
    assert boundary['attrs']['kind'] == kind
    assert boundary['attrs']['page']['marginBottomMm'] == pytest.approx(17, abs=.03)
    pdf = PdfReader(build_export(p, 'pdf', tmp_path)['path'])
    assert len(pdf.pages) == count
    assert 'FIRST_MARKER' in pdf.pages[0].extract_text()
    assert 'SECOND_MARKER' in pdf.pages[-1].extract_text()
    assert float(pdf.pages[-1].mediabox.height) == pytest.approx(148 * 72 / 25.4, abs=.03)
    if count == 3:
        assert not pdf.pages[1].extract_text().strip()
        assert float(pdf.pages[1].mediabox.height) == pytest.approx(297 * 72 / 25.4, abs=.03)
    html = build_export(p, 'html', tmp_path)['path']
    assert '@page alder-section-' in Path(html).read_text('utf-8')
    assert document_text(import_document(html)['document']) == document_text(source)
    html_boundary = import_document(html)['document']['content'][1]['attrs']
    assert html_boundary['kind'] == kind
    assert html_boundary['page'] == source['content'][1]['attrs']['page']


@pytest.mark.parametrize('attrs', [
    {'kind':'continuous', 'page':{}},
    {'kind':'nextPage', 'page':{'pageWidthMm':float('nan')}},
    {'kind':'nextPage', 'page':{'pageSize':'A5', 'marginLeftMm':99, 'marginRightMm':99}},
    {'kind':'nextPage', 'page':{'surprise':'value'}},
])
def test_reject_invalid_section_properties(attrs):
    with pytest.raises(ValidationError):
        validate_document({'type':'doc', 'content':[{'type':'section_break', 'attrs':attrs}]})


def test_section_break_cannot_be_nested_inside_a_table_or_list():
    with pytest.raises(ValidationError):
        validate_document({'type':'doc', 'content':[{'type':'blockquote', 'content':[{'type':'section_break', 'attrs':{'kind':'nextPage', 'page':{}}}]}]})
