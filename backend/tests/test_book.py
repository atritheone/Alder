from copy import deepcopy
from pathlib import Path
import pytest
from alder.models import create_project, validate_project, text_document, ValidationError
from alder.publishing import project_document, render_html, import_document, build_export
from alder.reading import word_timings
from alder.store import Store


def book_project():
    p = create_project(template="demo")
    p["book"] = {"version": 1, "chapters": [
        {"id": "chapter-one", "title": "One", "document": text_document("New manuscript 😀"), "text": "stale", "include": True},
        {"id": "chapter-two", "title": "Two", "document": text_document("Second chapter."), "text": "", "include": True},
    ]}
    return validate_project(p)


def test_book_is_canonical_publication_order_and_preserves_scratch():
    p = book_project()
    p["book"]["chapters"].reverse()
    original = deepcopy(p)
    sections = project_document(p)
    assert [s["title"] for s in sections] == ["Two", "One"]
    assert sections[1]["text"] == "New manuscript 😀"
    assert "collection of beginnings" not in render_html(p)
    assert p == original
    p["book"]["chapters"][0]["include"] = False
    assert [s["title"] for s in project_document(p)] == ["One"]


def test_book_archive_and_history_round_trip(tmp_path):
    store = Store(tmp_path / "data")
    p = store.create(template="blank")
    p["book"] = book_project()["book"]
    saved = store.update(p["id"], p, p["revision"])
    path = tmp_path / "book.alder"
    store.save_archive(p["id"], path)
    assert saved["book"]["chapters"][0]["text"] == "New manuscript 😀"
    assert store.get(p["id"])["book"] == saved["book"]


@pytest.mark.parametrize("mutation", [
    lambda p: p["book"].update(version=2),
    lambda p: p["book"]["chapters"].clear(),
    lambda p: p["book"]["chapters"].append(deepcopy(p["book"]["chapters"][0])),
    lambda p: p["book"]["chapters"][0].update(document={"type":"doc","content":[{"type":"image","attrs":{"assetId":"missing"}}]}),
])
def test_invalid_books_are_rejected(mutation):
    p = book_project(); mutation(p)
    with pytest.raises(ValidationError): validate_project(p)


def test_word_times_do_not_guess_mismatched_words_and_map_pronunciation():
    from alder.speech import pronunciation_projection
    written = "😀 Dr. Alder writes."
    spoken, mapping = pronunciation_projection(written, [{"word":"Dr.", "spoken":"Doctor"}])
    timed = [{"text": w, "startSeconds":i, "endSeconds":i+1} for i,w in enumerate(["Doctor","Alder","reads"])]
    result = word_timings(written, spoken, timed, mapping)
    assert [w["text"] for w in result] == ["Dr.", "Alder"]
    assert all(written[w["sourceStart"]:w["sourceEnd"]] == w["text"] for w in result)


def test_regex_pronunciation_and_timed_text_do_not_mutate_written_source():
    from alder.speech import pronunciation_projection
    from alder.reading import subtitles
    text = "Part 12 opens."
    spoken, mapping = pronunciation_projection(text, [{"word":r"Part (\d+)","spoken":r"Chapter \1","regex":True}])
    assert spoken == "Chapter 12 opens." and text == "Part 12 opens."
    assert mapping[0]["sourceStart"] == 0 and mapping[0]["sourceEnd"] == 7
    job = {"chunks":[{"text":text,"startSeconds":1.25,"seconds":2}]}
    assert "00:00:01,250 --> 00:00:03,250" in subtitles(job)
    assert subtitles(job,"lrc") == "[00:01.25]Part 12 opens."


def test_open_generic_text_and_utf16(tmp_path):
    for name, encoding in [("notes.log","utf-8"),("notes.txt","utf-16"),("README","utf-8")]:
        path = tmp_path / name
        path.write_text("A book about café culture 😀\nAnother paragraph.",encoding=encoding)
        imported = import_document(path)
        assert "café culture 😀" in imported["text"]


def test_book_pdf_and_rtf_open_with_bundled_extractor(tmp_path):
    from alder.publishing import _bundled_root
    if not (_bundled_root() / "tika/tika-app-3.3.2.jar").is_file():
        pytest.skip("Bundled document extractor not provisioned in source CI.")
    rtf = tmp_path / "sample.rtf"
    rtf.write_text(r"{\rtf1\ansi A book for Alder.\par Another paragraph.}")
    original = rtf.read_bytes()
    extracted = import_document(rtf)["text"]
    assert "A book for Alder" in extracted and "Another paragraph." in extracted
    assert rtf.read_bytes() == original
    rtf.write_text(r"{\rtf1\ansi A single paragraph without a terminator.}")
    assert "A single paragraph without a terminator." in import_document(rtf)["text"]
    pdf = build_export(book_project(), "pdf", tmp_path)
    assert "Second chapter" in import_document(Path(pdf["path"]))["text"]


def test_excluded_chapter_can_be_read_individually_but_is_not_in_book_audio():
    from alder.speech import SpeechService
    p = book_project()
    p["book"]["chapters"][0]["include"] = False
    service = SpeechService.__new__(SpeechService)
    assert service._sources(p, {"scope":"chapter", "chapterId":"chapter-one"})[0]["text"] == "New manuscript 😀"
    assert [s["text"] for s in service._sources(p,{"scope":"book"})] == ["Second chapter."]


def test_six_by_nine_book_page_dimensions(tmp_path):
    from alder.publishing import _bundled_root
    if not (_bundled_root().parent / "fonts/LiberationSerif-Regular.ttf").is_file():
        pytest.skip("Bundled publication fonts not provisioned in source CI.")
    from pypdf import PdfReader
    p = book_project(); p["settings"]["pageSize"] = "6x9"
    result = build_export(p,"pdf",tmp_path)
    page = PdfReader(result["path"]).pages[0]
    assert float(page.mediabox.width) == 432 and float(page.mediabox.height) == 648


def test_simple_document_exports_only_authored_text_and_sitka_layout(tmp_path):
    from pypdf import PdfReader
    from docx import Document
    p = book_project()
    p["book"]["chapters"] = p["book"]["chapters"][:1]
    p["settings"].update(documentKind="docx", includeTitle=False, pageSize="A5", orientation="landscape", firstPageNumber=7)
    text = build_export(p, "txt", tmp_path)
    assert Path(text["path"]).read_text(encoding="utf-8").strip() == "New manuscript 😀"
    word = build_export(p, "docx", tmp_path)
    doc = Document(word["path"])
    assert doc.sections[0].page_width > doc.sections[0].page_height
    assert doc.styles["Normal"].font.name == "Sitka Text"
    pdf = build_export(p, "pdf", tmp_path)
    page = PdfReader(pdf["path"]).pages[0]
    assert page.mediabox.width > page.mediabox.height
    assert not any("substituted" in warning for warning in pdf["warnings"])
    assert "7" in page.extract_text()
