import base64
import copy
import io
from pathlib import Path
import subprocess
import zipfile

import pytest

from alder.publishing import (build_export, capabilities, import_document, plain_text,
                              project_document, render_html, text_document, validate_epub)


def paragraph(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


@pytest.mark.parametrize("format", ["txt", "md", "html", "docx", "epub", "pdf", "azw3"])
def test_generated_glossary_uses_authored_definitions_without_mutation(publication, tmp_path, format):
    if format == "azw3" and not capabilities()["azw3"]["available"]:
        pytest.skip("Native AZW3 converter is not provisioned in this source-only environment.")
    publication["dictionary"] = [{"word": "Voyager", "ipa": "/ˈvɔɪədʒər/", "partOfSpeech": "Noun", "definition": "A traveller through language."},
                               {"word": "Alder", "definition": "An authored definition."}, {"word": "Incomplete", "definition": ""}]
    before = copy.deepcopy(publication)
    result = build_export(publication, format, tmp_path, {"includeGlossary": True})
    if format == "pdf":
        from pypdf import PdfReader
        text = "\n".join(page.extract_text() for page in PdfReader(result["path"]).pages)
    elif format == "azw3":
        assert result["validation"]["status"] == "converted"
        reopened = tmp_path / "reopened-glossary.epub"
        subprocess.run([capabilities()["azw3"]["converter"], result["path"], str(reopened)], check=True, capture_output=True,
                       timeout=180, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        text = import_document(reopened)["text"]
    else:
        text = import_document(Path(result["path"]))["text"]
    assert "Glossary" in text and "A traveller through language." in text
    assert text.index("An authored definition.") < text.index("A traveller through language.")
    assert "Incomplete" not in text
    assert any("without both" in warning for warning in result["warnings"])
    assert publication == before


def test_glossary_is_opt_in_and_empty_request_is_reported(publication, tmp_path):
    publication["dictionary"] = [{"word": "PrivateTerm", "definition": "Private definition."}]
    assert "Private definition" not in render_html(publication)
    assert "Private definition" in render_html(publication, {"includeGlossary": True})
    publication["dictionary"] = []
    result = build_export(publication, "txt", tmp_path, {"includeGlossary": True})
    assert any("No authored" in warning for warning in result["warnings"])


def test_publication_resolves_named_styles_and_preserves_direct_character_overrides(publication, tmp_path):
    from docx import Document
    from docx.enum.style import WD_STYLE_TYPE
    publication["styles"] = [
        {"id": "body", "name": "Body", "kind": "paragraph", "fontSize": 14, "leftIndent": 12, "firstLineIndent": -6},
        {"id": "lead", "name": "Lead", "basedOn": "body", "spaceAfter": 18, "fontSize": None},
        {"id": "term", "name": "Term", "kind": "character", "fontSize": 17, "color": "#125577"},
        {"id": "emphasis", "name": "Emphasis", "kind": "character", "basedOn": "term", "fontSize": 19},
    ]
    publication["clips"][0]["activeVariantId"] = None
    publication["clips"][0]["document"] = {"type": "doc", "content": [{"type": "paragraph", "attrs": {"styleId": "lead", "fontSize": 15}, "content": [
        {"type": "text", "text": "Inherited term", "marks": [{"type": "text_style", "attrs": {"styleId": "emphasis", "fontSize": 21, "color": None}}]}]}]}
    before = copy.deepcopy(publication)
    html = render_html(publication)
    assert "font-size:15pt" in html and "font-size:21pt" in html and "color:#125577" in html
    assert "margin-left:12pt" in html and "text-indent:-6pt" in html and "margin-bottom:18pt" in html
    result = build_export(publication, "docx", tmp_path)
    document = Document(result["path"])
    target = next(p for p in document.paragraphs if p.text == "Inherited term")
    assert target.runs[0].font.size.pt == 21  # Paragraph attrs cannot overwrite character formatting.
    assert str(target.runs[0].font.color.rgb) == "125577"
    assert target.runs[0].style.type == WD_STYLE_TYPE.CHARACTER
    assert target.paragraph_format.left_indent.pt == 12
    assert target.paragraph_format.first_line_indent.pt == -6
    assert publication == before


@pytest.mark.parametrize("styles,match", [
    ([{"id": "a", "basedOn": "b"}, {"id": "b", "basedOn": "a"}], "cycle"),
    ([{"id": "a", "basedOn": "missing"}], "missing style"),
])
def test_invalid_style_graph_blocks_publication(publication, tmp_path, styles, match):
    publication["styles"] = styles
    with pytest.raises(ValueError, match=match):
        render_html(publication)
    with pytest.raises(ValueError, match=match):
        build_export(publication, "txt", tmp_path)


def test_css_named_colours_and_alpha_have_consistent_export_mapping(publication, tmp_path):
    publication["clips"][1]["document"] = {"type":"doc", "content":[{"type":"paragraph", "attrs":{"color":"teal"}, "content":[
        {"type":"text","text":"A coloured phrase", "marks":[{"type":"text_style","attrs":{"color":"#ff000080","fontSize":None}}]}]}]}
    result = build_export(publication, "html", tmp_path)
    output = Path(result["path"]).read_text("utf-8")
    assert "color:#008080" in output and "color:#ff7f7f" in output
    assert any("flattened against white" in warning for warning in result["warnings"])


@pytest.fixture
def publication():
    return {
        "id": "project-publication", "name": "Alder publication proof", "language": "en", "revision": 7,
        "settings": {"author": "Alder test author", "description": "Semantic publication export verification.", "fontFamily": "Georgia", "fontSize": 12, "pageSize": "A4", "marginMm": 22},
        "styles": [{"id": "lead", "name": "Lead", "fontFamily": "Georgia", "fontSize": 13, "lineHeight": 1.5, "spaceAfter": 10}],
        "sections": [{"id": "later", "title": "Second section", "order": 2}, {"id": "first", "title": "First section", "order": 0}],
        "tracks": [{"id": "t", "muted": True}],
        "clips": [
            {"id": "a", "title": "Draft", "trackId": "t", "document": text_document("Original draft."), "activeVariantId": "chosen", "variants": [{"id": "chosen", "document": text_document("Accepted wording — café and naïve."), "text": "Incorrect cached projection"}]},
            {"id": "b", "title": "Conclusion", "document": text_document("Final words.")},
            {"id": "unused", "title": "Unused draft", "document": text_document("This must not be published.")}],
        "placements": [{"id": "p2", "clipId": "b", "sectionId": "later", "order": 0}, {"id": "p1", "clipId": "a", "sectionId": "first", "order": 0}],
        "assets": [],
    }


def test_collation_resolves_explicit_order_and_selected_text(publication):
    before = copy.deepcopy(publication)
    result = project_document(publication)
    assert [s["id"] for s in result] == ["first", "later"]
    assert result[0]["text"] == "Accepted wording — café and naïve."
    assert result[0]["clipIds"] == ["a"]
    assert publication == before
    # Track audition state does not change manuscript inclusion.
    assert publication["tracks"][0]["muted"]


def test_frozen_snapshots_inclusion_and_no_implicit_drafts(publication):
    publication["placements"][1]["frozenDocument"] = text_document("Frozen edition.")
    publication["placements"][0]["include"] = False
    assert [s["text"] for s in project_document(publication)] == ["Frozen edition.", ""]
    publication["placements"][1]["frozenDocument"] = None
    publication["placements"][1]["frozenText"] = "Frozen plaintext."
    assert project_document(publication)[0]["text"] == "Frozen plaintext."
    publication["placements"] = []
    assert all(not s["blocks"] for s in project_document(publication))


def test_corrupt_references_fail_instead_of_silent_loss(publication):
    publication["clips"][0]["activeVariantId"] = "missing"
    with pytest.raises(ValueError, match="missing chosen variant"):
        project_document(publication)
    publication["placements"][1]["sectionId"] = "missing"
    with pytest.raises(ValueError, match="missing section"):
        project_document(publication)


def test_html_sanitizes_attributes_and_preserves_semantics(publication):
    publication["clips"][0]["activeVariantId"] = None
    publication["clips"][0]["document"] = {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 3}, "content": [{"type": "text", "text": "A heading"}]},
        {"type": "paragraph", "attrs": {"styleId": "lead", "textAlign": "justify"}, "content": [
            {"type": "text", "text": "<script> is text", "marks": [{"type": "strong"}, {"type": "link", "attrs": {"href": "javascript:alert(1)"}}]}]},
        {"type": "ordered_list", "attrs": {"order": 3}, "content": [{"type": "list_item", "content": [paragraph("A list item")]}]},
    ]}
    output = render_html(publication, {"includeToc": True})
    assert "<h3>A heading</h3>" in output
    assert "<strong>&lt;script&gt; is text</strong>" in output
    assert "javascript:" not in output
    assert "font-size:13pt" in output and '<ol start="3">' in output
    assert "Content-Security-Policy" in output


def test_collected_images_embed_and_outside_paths_do_not(publication, tmp_path):
    from PIL import Image
    image = tmp_path / "sample.png"
    Image.new("RGB", (80, 40), "#4c7062").save(image)
    publication["assets"] = [{"id": "image", "path": image.name, "mime": "image/png"}]
    publication["clips"][1]["document"] = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "image", "attrs": {"assetId": "image", "alt": "A green image"}}]}]}
    rendered = render_html(publication, {"assetRoot": tmp_path})
    assert "data:image/png;base64," in rendered
    publication["assets"][0]["path"] = str(tmp_path.parent / "outside.png")
    result = build_export(publication, "html", tmp_path, {"assetRoot": tmp_path})
    assert "outside the project asset store" in " ".join(result["warnings"])
    assert "data:image/png;base64," not in Path(result["path"]).read_text("utf-8")


@pytest.mark.parametrize("format", ["txt", "md", "html", "docx", "epub"])
def test_output_round_trip_preserves_accepted_wording(publication, tmp_path, format):
    exported = build_export(publication, format, tmp_path)
    path = Path(exported["path"])
    assert path.is_file()
    assert exported["validation"]["status"] in ("passed", "structural-only")
    assert any("draft clip" in w for w in exported["warnings"])
    imported = import_document(path)
    assert "Accepted wording — café and naïve." in imported["text"]
    assert "Original draft." not in imported["text"]
    assert "This must not be published." not in imported["text"]
    assert imported["text"].index("Accepted wording") < imported["text"].index("Final words")


def test_docx_retains_hyperlinks_tables_images_in_order(publication, tmp_path):
    from PIL import Image
    out = io.BytesIO()
    Image.new("RGB", (40, 20), "#738574").save(out, "PNG")
    publication["assets"] = [{"id":"image", "data":base64.b64encode(out.getvalue()).decode(), "mime":"image/png"}]
    publication["clips"][1]["document"] = {"type":"doc", "content":[
        {"type":"paragraph", "content":[{"type":"text", "text":"Before table ", "marks":[{"type":"link", "attrs":{"href":"https://www.w3.org/"}}]}]},
        {"type":"table", "content":[{"type":"table_row", "content":[{"type":"table_header", "content":[paragraph("Column A")]}, {"type":"table_header", "content":[paragraph("Column B")]}]}, {"type":"table_row", "content":[{"type":"table_cell", "content":[paragraph("Cell one")]}, {"type":"table_cell", "content":[paragraph("Cell two")]}]}]},
        {"type":"paragraph", "content":[{"type":"image", "attrs":{"assetId":"image", "alt":"Image after table"}}]},
        paragraph("After image.")]}
    result = build_export(publication, "docx", tmp_path)
    imported = import_document(Path(result["path"]))
    assert imported["text"].index("Before table") < imported["text"].index("Column A") < imported["text"].index("After image")
    assert imported["assets"] and "https://www.w3.org/" in str(imported["document"])
    assert "Image after table" in str(imported["document"])


def test_pdf_has_real_pages_metadata_and_unicode(publication, tmp_path):
    from pypdf import PdfReader
    result = build_export(publication, "pdf", tmp_path, {"includeToc": True, "header": "Alder publication proof", "footer": True})
    reader = PdfReader(result["path"])
    text = "\n".join(p.extract_text() for p in reader.pages)
    assert len(reader.pages) >= 2
    assert "Accepted wording" in text and "café" in text and "naïve" in text
    assert "Original draft" not in text
    assert reader.metadata.title == publication["name"]


def test_epub_container_spine_and_real_validation(publication, tmp_path):
    result = build_export(publication, "epub", tmp_path)
    with zipfile.ZipFile(result["path"]) as archive:
        assert archive.infolist()[0].filename == "mimetype"
        assert archive.infolist()[0].compress_type == zipfile.ZIP_STORED
        assert b"First section" in archive.read("EPUB/section-1.xhtml")
        assert b"Second section" in archive.read("EPUB/section-2.xhtml")
        assert b"Alder test author" in archive.read("EPUB/package.opf")
    assert result["validation"]["structural"]["status"] == "passed"
    if capabilities()["epubcheck"]["available"]:
        assert result["validation"]["epubcheck"]["status"] == "passed"


def test_html_import_removes_active_content_and_never_fetches_images(tmp_path):
    path = tmp_path / "unsafe.html"
    path.write_text('<h2>Imported heading</h2><script>steal()</script><p onclick="bad()">Text <em>emphasised</em></p><img src="http://127.0.0.1/private" alt="External image"/><table><tr><td>Cell</td></tr></table>', "utf-8")
    imported = import_document(path)
    assert "steal" not in imported["text"] and "bad()" not in str(imported["document"])
    assert "emphasised" in imported["text"] and "Cell" in imported["text"]
    assert any("remote resource" in w for w in imported["warnings"])
    assert imported["assets"] == []


def test_import_images_and_alignment_match_editor_schema(tmp_path):
    from PIL import Image
    image = io.BytesIO()
    Image.new("RGB", (5,5), "green").save(image,"PNG")
    path = tmp_path / "inline-image.html"
    path.write_text('<p style="text-align:center">Before<img src="data:image/png;base64,' + base64.b64encode(image.getvalue()).decode() + '" alt="Art"/>After</p><!-- private comment -->', "utf-8")
    imported = import_document(path)
    nodes = imported["document"]["content"]
    assert [n["type"] for n in nodes] == ["paragraph", "image", "paragraph"]
    assert nodes[0]["attrs"]["align"] == "center"
    assert "private comment" not in imported["text"]


def test_malicious_archive_fails_before_extraction(tmp_path):
    path = tmp_path / "unsafe.epub"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("../stolen.txt", "Unsafe")
    with pytest.raises(ValueError, match="unsafe resource path"):
        import_document(path)


def test_markdown_import_treats_raw_html_as_text(tmp_path):
    path = tmp_path / "draft.md"
    path.write_text('# Heading\n\n**Strong** words.\n\n<script>alert(1)</script>\n', "utf-8")
    imported = import_document(path)
    assert imported["document"]["content"][0]["type"] == "heading"
    assert "strong" in str(imported["document"])
    assert "<script>" in imported["text"]


def test_azw3_uses_real_converter_when_present(publication, tmp_path):
    if not capabilities()["azw3"]["available"]:
        pytest.skip("No development or bundled Calibre converter is available")
    result = build_export(publication, "azw3", tmp_path)
    assert Path(result["path"]).stat().st_size > 1000
    assert result["validation"]["converter"] == "Calibre"
    assert b"BOOKMOBI" in Path(result["path"]).read_bytes()[:100]


def test_unknown_formats_fail_without_empty_output(publication, tmp_path):
    with pytest.raises(ValueError, match="Unsupported export"):
        build_export(publication, "fictional", tmp_path)
    assert not list(tmp_path.iterdir())
