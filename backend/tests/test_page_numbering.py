import pytest
from docx import Document
from docx.oxml.ns import qn
from pypdf import PdfReader
from alder.models import validate_project, validate_document, ValidationError
from alder.publishing import build_export, import_document
from alder.page_numbering import format_page_number, section_numbering
from test_sections import fixture, paragraph


@pytest.mark.parametrize('number,format,expected', [(28,'upperLetter','BB'),(53,'lowerLetter','aaa'),(49,'lowerRoman','xlix'),(1999,'upperRoman','MCMXCIX'),(123,'decimal','123')])
def test_formats(number, format, expected):
    assert format_page_number(number, format) == expected


@pytest.mark.parametrize('kind,restart,label', [('nextPage',1,'i'),('oddPage',1,'i'),('oddPage',2,'iii'),('evenPage',1,'ii'),('evenPage',2,'ii')])
def test_section_restarts_round_trip_and_pdf_parity(tmp_path, kind, restart, label):
    p = fixture(kind)
    p['settings'].update(firstPageNumber=28, pageNumberFormat='upperLetter', footer=True)
    content = p['book']['chapters'][0]['document']['content']
    content[1]['attrs'].update(numberingStart=restart, numberingFormat='lowerRoman')
    # Following section inherits the format but must not inherit the restart.
    content.extend([{'type':'section_break', 'attrs':{'kind':'nextPage', 'page':{}}}, paragraph('THIRD_MARKER')])
    pdf = PdfReader(build_export(p, 'pdf', tmp_path)['path'])
    assert len(pdf.pages) == 3
    assert pdf.pages[0].extract_text().splitlines()[0] == 'BB'
    assert pdf.pages[1].extract_text().splitlines()[0] == label
    expected = section_numbering(29, kind, restart)[0] + 1
    assert pdf.pages[2].extract_text().splitlines()[0] == format_page_number(expected, 'lowerRoman')
    word = build_export(p, 'docx', tmp_path)['path']
    sections = Document(word).sections
    for section, start, format in zip(sections, [28,restart,None], ['upperLetter','lowerRoman','lowerRoman']):
        numbering = section._sectPr.find(qn('w:pgNumType'))
        assert numbering.get(qn('w:start')) == (str(start) if start is not None else None)
        assert numbering.get(qn('w:fmt')) == format
    imported = import_document(word)
    assert imported['settings']['pageNumberFormat'] == 'upperLetter'
    breaks = [n['attrs'] for n in imported['document']['content'] if n['type'] == 'section_break']
    assert breaks[0]['numberingStart'] == restart
    assert breaks[0]['numberingFormat'] == 'lowerRoman'
    assert breaks[1].get('numberingStart') is None
    assert breaks[1]['numberingFormat'] == 'lowerRoman'
    assert not any('page-number' in warning or 'starting page number' in warning for warning in imported['warnings'])
    html = import_document(build_export(p, 'html', tmp_path)['path'])
    html_break = next(n['attrs'] for n in html['document']['content'] if n['type'] == 'section_break')
    assert html_break['numberingStart'] == restart
    assert html_break['numberingFormat'] == 'lowerRoman'


@pytest.mark.parametrize('value', [0, -1, 1.5, 10000, '2', True, float('nan')])
def test_invalid_restart_is_rejected(value):
    p = fixture()
    p['settings']['firstPageNumber'] = value
    with pytest.raises(ValidationError):
        validate_project(p)
    with pytest.raises(ValidationError):
        validate_document({'type':'doc', 'content':[{'type':'section_break','attrs':{'page':{},'numberingStart':value}}]})


def test_unsupported_docx_number_format_reports_conversion(tmp_path):
    p = fixture()
    word = build_export(p, 'docx', tmp_path)['path']
    doc = Document(word)
    doc.sections[1]._sectPr.find(qn('w:pgNumType')).set(qn('w:fmt'), 'chicago')
    doc.save(word)
    imported = import_document(word)
    assert any('unsupported page-number' in warning for warning in imported['warnings'])
    assert next(n['attrs'] for n in imported['document']['content'] if n['type'] == 'section_break')['numberingFormat'] == 'decimal'
