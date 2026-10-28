"""Generate original regression prose; writes only to an explicit test directory."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from alder.models import create_project, validate_project
from alder.publishing import build_export, import_document, plain_text


def paragraph(text, **attrs):
    return {"type": "paragraph", "attrs": attrs, "content": [{"type": "text", "text": text}]}


def fixture():
    project = create_project("Alder word-processing fixture", "blank")
    project["settings"].update(documentKind="docx", includeTitle=False, footer=False, fontFamily="Cambria")
    def cell(text, **attrs):
        return {"type": "table_cell", "attrs": attrs, "content": [paragraph(text)]}
    body = [
        {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Structured editing"}]},
        paragraph("This original test document checks paragraph spacing, indents, numbering and merged table cells.", rightIndent=24, firstLineIndent=-8, leftIndent=16, spaceBefore=9, spaceAfter=12, lineHeight=1.4),
        {"type": "ordered_list", "attrs": {"order": 4}, "content": [
            {"type": "list_item", "content": [paragraph("First numbered item"), {"type": "bullet_list", "content": [{"type": "list_item", "content": [paragraph("Nested bullet")]}]}]},
            {"type": "list_item", "content": [paragraph("Second numbered item")]},
        ]},
        {"type": "table", "attrs": {"align": "right"}, "content": [
            {"type": "table_row", "attrs": {"minHeight": 42}, "content": [cell("Tall", rowspan=2, colwidth=[160], verticalAlign='middle', paddingTop=4, paddingBottom=8, paddingLeft=3, paddingRight=7, borderWidth=1.5, borderColor='#345678', background='#ddeeff'), cell("Upper", colwidth=[240])]},
            {"type": "table_row", "content": [cell("Lower", colwidth=[240])]},
            {"type": "table_row", "content": [cell("Wide", colspan=2, colwidth=[160, 240])]},
        ]},
        paragraph("The final paragraph must remain present after opening and saving in another word processor."),
        paragraph("Exact paragraph flow", lineSpacingMode='exact', lineSpacing=19.5, keepTogether=True, keepWithNext=True, widowOrphan=True, pageBreakBefore=True),
        paragraph("Minimum paragraph flow", lineSpacingMode='atLeast', lineSpacing=18, keepTogether=False, keepWithNext=False, widowOrphan=False, pageBreakBefore=False),
        {'type': 'ordered_list', 'attrs': {'order': 9, 'listStyle': 'lower-roman'}, 'content': [{'type': 'list_item', 'content': [paragraph('Roman numbered item')]}]},
        {'type': 'bullet_list', 'attrs': {'listStyle': 'square'}, 'content': [{'type': 'list_item', 'content': [paragraph('Square bullet item')]}]},
    ]
    body.extend([
        {'type':'section_break', 'attrs':{'kind':'nextPage', 'page':{'pageSize':'A4','orientation':'landscape','marginTopMm':15,'marginBottomMm':17,'marginLeftMm':19,'marginRightMm':21}}},
        paragraph('LANDSCAPE_SECTION_MARKER'),
        {'type':'section_break', 'attrs':{'kind':'oddPage', 'page':{'pageSize':'A5','orientation':'portrait','marginMm':20}}},
        paragraph('ODD_SECTION_MARKER'),
    ])
    project["book"] = {"version": 1, "chapters": [{"id": "fixture-chapter", "title": "Fixture", "include": True, "document": {"type": "doc", "content": body}}]}
    return validate_project(project)


def verify_word(destination):
    """Qualify only this declared subset; rendered pagination may still differ."""
    from pypdf import PdfReader
    exported = json.loads((destination / 'fixture-exports.json').read_text('utf-8'))
    original = import_document(Path(exported['docx']['path']))['document']
    result = import_document(destination / 'word-resaved.docx')
    returned = result['document']
    assert plain_text(original) == plain_text(returned), 'Word exchange changed authored text'
    for key in ('rightIndent', 'leftIndent', 'firstLineIndent', 'spaceBefore', 'spaceAfter', 'lineHeight'):
        assert returned['content'][1]['attrs'][key] == original['content'][1]['attrs'][key], key
    listing = returned['content'][2]
    assert listing['type'] == 'ordered_list' and listing['attrs']['order'] == 4
    assert listing['content'][0]['content'][1]['type'] == 'bullet_list'
    table = returned['content'][3]
    assert table['content'][0]['content'][0]['attrs']['rowspan'] == 2
    assert table['content'][2]['content'][0]['attrs']['colspan'] == 2
    assert table['content'][0]['content'][0]['attrs']['colwidth'] == [160]
    assert table['attrs']['align'] == 'right'
    assert table['content'][0]['attrs']['minHeight'] == 42
    for key in ('verticalAlign', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'borderWidth', 'borderColor', 'background'):
        actual = table['content'][0]['content'][0]['attrs'][key]
        expected = original['content'][3]['content'][0]['content'][0]['attrs'][key]
        assert str(actual).lower() == str(expected).lower(), (key, actual, expected)
    for index in (5, 6):
        for key in ('lineSpacingMode', 'lineSpacing', 'keepTogether', 'keepWithNext', 'widowOrphan', 'pageBreakBefore'):
            assert returned['content'][index]['attrs'][key] == original['content'][index]['attrs'][key], key
    assert returned['content'][7]['attrs']['listStyle'] == 'lower-roman'
    assert returned['content'][7]['attrs']['order'] == 9
    assert returned['content'][8]['attrs']['listStyle'] == 'square'
    heading_fonts = []
    pdf = PdfReader(destination / 'word-rendered.pdf')
    for page in pdf.pages:
        page.extract_text(visitor_text=lambda text, cm, tm, font, size: heading_fonts.append((str(font.get('/BaseFont')), size)) if font and 'Structured editing' in text else None)
    assert heading_fonts and all('Cambria-Bold' in font and size == 24 for font, size in heading_fonts)
    original_sections = [n['attrs'] for n in original['content'] if n['type'] == 'section_break']
    returned_sections = [n['attrs'] for n in returned['content'] if n['type'] == 'section_break']
    assert original_sections == returned_sections, (original_sections, returned_sections)
    marker_pages = {marker: [i for i, page in enumerate(pdf.pages) if marker in page.extract_text()] for marker in ('LANDSCAPE_SECTION_MARKER', 'ODD_SECTION_MARKER')}
    assert all(len(indices) == 1 for indices in marker_pages.values())
    first_number = json.loads((destination / 'fixture-project.json').read_text('utf-8'))['settings']['firstPageNumber']
    assert (marker_pages['ODD_SECTION_MARKER'][0] + first_number) % 2 == 1
    assert result['settings']['firstPageNumber'] == first_number
    assert float(pdf.pages[marker_pages['LANDSCAPE_SECTION_MARKER'][0]].mediabox.width) > float(pdf.pages[marker_pages['LANDSCAPE_SECTION_MARKER'][0]].mediabox.height)
    report = {'status': 'passed', 'checks': ['authored text', 'paragraph metrics and flow controls', 'numbering and nested bullets', 'Roman and square markers', 'merged cells and widths', 'table alignment, cell padding/borders/shading, vertical alignment and minimum row height', 'Cambria heading rendered in Word', 'mixed paper sizes, margins and odd section starts'],
              'wordPages': len(pdf.pages), 'importWarnings': result['warnings'],
              'limitation': 'This is a semantic subset check. Table borders, block placement and editing/PDF page geometry are not one shared layout.'}
    (destination / 'word-roundtrip-report.json').write_text(json.dumps(report, indent=2), 'utf-8')
    return report


if __name__ == "__main__":
    destination = Path(sys.argv[1]).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    if '--verify-word' in sys.argv[2:]:
        print(json.dumps(verify_word(destination)))
        raise SystemExit(0)
    project = fixture()
    results = {format: build_export(project, format, destination) for format in ("docx", "pdf")}
    (destination / "fixture-project.json").write_text(json.dumps(project, ensure_ascii=False), "utf-8")
    (destination / "fixture-exports.json").write_text(json.dumps(results), "utf-8")
    print(json.dumps(results))
