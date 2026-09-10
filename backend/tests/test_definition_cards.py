from pathlib import Path

import pytest
from PIL import Image, ImageChops

from alder.definition_cards import build_definition_export, font_directory


ENTRY = {"word":"Voyager", "ipa":"/'vɔɪ.ɪ.dʒər/", "partOfSpeech":"Noun", "definition":"A Priest of Lucidity and the Manifest Reality."}


@pytest.fixture
def card_fonts():
    try:
        return font_directory()
    except RuntimeError:
        pytest.skip("Prepare publishing resources to run rendered definition-card checks; the release resource gate requires these fonts.")


@pytest.mark.parametrize("format", ["png", "jpeg", "pdf"])
def test_definition_exports_reference_content_and_dimensions(tmp_path, format, card_fonts):
    result = build_definition_export(ENTRY,format,tmp_path)
    assert Path(result["path"]).is_file()
    assert result["validation"]["status"] == "passed"
    assert result["validation"]["definitionLines"] == 2
    if format == "pdf":
        from pypdf import PdfReader
        reader = PdfReader(result["path"])
        text = reader.pages[0].extract_text()
        assert "Voyager" in text and "Manifest Reality." in text and "vɔɪ" in text
        assert float(reader.pages[0].mediabox.width) == 600
        assert len(reader.pages) == 1
    else:
        with Image.open(result["path"]) as image:
            assert image.size == (800,800)
            assert image.getpixel((50,50)) == (255,255,255)
            assert max(image.getpixel((400,316))) < 30
            # Reference has deliberate whitespace above and below its definition.
            assert ImageChops.difference(image.crop((0,0,800,180)),Image.new("RGB",(800,180),"white")).getbbox() is None


def test_definition_custom_size_and_font_fit(tmp_path, card_fonts):
    entry = {**ENTRY,"word":"Circumnavigation", "definition":"A journey around a complete world. "*8}
    result = build_definition_export(entry,"png",tmp_path,{"size":1200})
    with Image.open(result["path"]) as image:
        assert image.size == (1200,1200)
        bounds = ImageChops.difference(image,Image.new("RGB",image.size,"white")).getbbox()
        assert bounds[2] <= 1060 and bounds[3] <= 1080
    assert result["warnings"]


def test_missing_required_text_and_overflow_do_not_create_files(tmp_path, card_fonts):
    with pytest.raises(ValueError,match="headword and a definition"):
        build_definition_export({**ENTRY,"definition":""},"png",tmp_path)
    with pytest.raises(ValueError,match="too long to fit"):
        build_definition_export({**ENTRY,"definition":"Unbounded text "*300},"png",tmp_path)
    assert list(tmp_path.iterdir()) == []


def test_missing_font_fails_instead_of_system_font_dependency(tmp_path, monkeypatch):
    monkeypatch.setenv("ALDER_RESOURCES_DIR",str(tmp_path))
    with pytest.raises(RuntimeError,match="bundled definition-card fonts"):
        build_definition_export(ENTRY,"png",tmp_path)


@pytest.mark.parametrize("options", [{"size":0},{"size":10000},{"dpi":0},{"dpi":"invalid"}])
def test_invalid_card_dimensions_are_rejected(tmp_path, options):
    with pytest.raises(ValueError):
        build_definition_export(ENTRY,"png",tmp_path,options)


def test_unsupported_unicode_is_reported(tmp_path, card_fonts):
    with pytest.raises(ValueError,match="cannot display"):
        build_definition_export({**ENTRY,"word":"Voyager 🚀"},"png",tmp_path)
