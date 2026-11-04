from contextlib import nullcontext
import pytest
from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt
from alder.docx_import_styles import cached_import_styles
from alder.publishing import import_document


def test_scoped_style_resolution_retains_types_defaults_and_new_continuations():
    doc = Document(); another = Document()
    doc.styles['Normal'].font.name = 'Cambria'
    another.styles['Normal'].font.name = 'Arial'
    original = doc.part.get_style
    with cached_import_styles(doc):
        for _ in range(20):
            assert doc.part.get_style(None, WD_STYLE_TYPE.PARAGRAPH).font.name == 'Cambria'
            assert another.part.get_style(None, WD_STYLE_TYPE.PARAGRAPH).font.name == 'Arial'
        assert doc.part.get_style('LaterStyle', WD_STYLE_TYPE.PARAGRAPH).style_id == 'Normal'
        style = doc.styles.add_style('LaterStyle', WD_STYLE_TYPE.PARAGRAPH)
        style.base_style = doc.styles['Normal']; style.paragraph_format.left_indent = Pt(24)
        assert doc.part.get_style('LaterStyle', WD_STYLE_TYPE.PARAGRAPH).paragraph_format.left_indent.pt == 24
        assert doc.part.get_style('LaterStyle', WD_STYLE_TYPE.CHARACTER).type == WD_STYLE_TYPE.CHARACTER
    assert doc.part.get_style == original
    with pytest.raises(ValueError):
        with cached_import_styles(doc): raise ValueError('Malformed source')
    assert doc.part.get_style == original


def test_cached_import_matches_uncached_styles_in_body_tables_and_running_stories(tmp_path, monkeypatch):
    import alder.docx_import_styles as styles
    doc = Document(); doc.styles['Normal'].font.name = 'Cambria'; doc.styles['Normal'].font.size = Pt(12)
    custom = doc.styles.add_style('AuthoredBody', WD_STYLE_TYPE.PARAGRAPH)
    custom.base_style = doc.styles['Normal']; custom.paragraph_format.left_indent = Pt(19)
    doc.add_paragraph('Heading', 'Heading 1')
    for index in range(12):
        paragraph = doc.add_paragraph(f'Paragraph {index}', 'AuthoredBody' if index % 2 else None)
        if index == 5:
            properties = paragraph._p.get_or_add_pPr()
            if properties.pStyle is not None: properties.remove(properties.pStyle)
            prop = OxmlElement('w:pStyle'); prop.set(qn('w:val'), 'MissingStyle')
            properties.append(prop)
    doc.add_table(1, 1).cell(0, 0).paragraphs[0].style = custom
    doc.tables[0].cell(0, 0).paragraphs[0].add_run('Cell wording')
    doc.sections[0].header.paragraphs[0].style = custom
    doc.sections[0].header.paragraphs[0].add_run('Running wording')
    path = tmp_path / 'styles.docx'; doc.save(path)
    cached = import_document(path)
    monkeypatch.setattr(styles, 'cached_import_styles', lambda _: nullcontext())
    uncached = import_document(path)
    assert cached == uncached
