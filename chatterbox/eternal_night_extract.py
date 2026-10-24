"""Extract and audit Her Eternal Night without losing split headings or drop capitals."""
import hashlib
import json
import os
import re
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

from bs4 import BeautifulSoup


ROOT = Path(os.environ["LOCALAPPDATA"]) / "chatterbox/audiobooks/her-eternal-night"
PREVIOUS_PLAN = ROOT.parent / "her-many-faces/plan.json"
SOURCE = Path("C:/Users/Edward/OneDrive/the one/images/Her Eternal Night/eBook/Her Eternal Night (AZW3).azw3")
COVER = Path("C:/Users/Edward/OneDrive/the one/images/Her Eternal Night/Narration/her_eternal_night_narration_cover.png")
OUTPUT = Path("C:/Users/Edward/OneDrive/the one/images/Her Eternal Night/Audiobook")
SHORT_TITLE = "Her Eternal Night"
SUBTITLE = "Of Darkness, Blood, and the Beginning"
TITLE = f"{SHORT_TITLE}: {SUBTITLE}"
OPENING = TITLE + " by Natalie"
ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9}
SPOKEN = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def paragraph_hash(paragraphs):
    return hashlib.sha256("\n\n".join(paragraphs).encode("utf-8")).hexdigest()


def clean(element):
    # Do not insert spaces between inline markup: <span>A</span>t is "At".
    for br in element.find_all("br"):
        br.replace_with(" ")
    return " ".join(element.get_text().split())


def main():
    previous = json.loads(PREVIOUS_PLAN.read_text(encoding="utf-8"))
    reference = Path(previous["reference"])
    assert sha(reference) == previous["reference_sha256"], "Reference voice file changed since previous audiobook"
    archive_path = ROOT / "source.epub"
    with ZipFile(archive_path) as archive:
        ns = {"o": "http://www.idpf.org/2007/opf", "dc": "http://purl.org/dc/elements/1.1/", "n": "http://www.daisy.org/z3986/2005/ncx/"}
        opf = ET.fromstring(archive.read("content.opf"))
        metadata = opf.find("o:metadata", ns)
        author = metadata.find("dc:creator", ns).text
        assert author == "Natalie"
        files = {x.attrib["id"]: x.attrib["href"] for x in opf.findall("o:manifest/o:item", ns)}
        spine = [files[x.attrib["idref"]] for x in opf.findall("o:spine/o:itemref", ns)]
        sections = []
        by_id = {}
        excluded = []
        dropcaps = []
        for filename in spine:
            soup = BeautifulSoup(archive.read(filename), "xml")
            body = soup.find("body")
            section_elements = body.find_all("section")
            if not section_elements:
                assert filename == "titlepage.xhtml" or body.find("nav") is not None, filename
                excluded.append({"source": filename, "reason": "Cover image" if filename == "titlepage.xhtml" else "Navigation/table of contents"})
                continue
            assert len(section_elements) == 1, filename
            element = section_elements[0]
            sid = element["id"]
            kind = element.get("epub:type") or element.get("type")
            assert kind in ("introduction", "part", "chapter", "conclusion"), (filename, kind)
            if sid not in by_id:
                by_id[sid] = {"section_id": sid, "kind": kind, "sources": [], "blocks": [], "body": [], "headings": []}
                sections.append(by_id[sid])
            section = by_id[sid]
            assert sections[-1] is section, "Split section not contiguous in spine"
            assert section["kind"] == kind
            section["sources"].append(filename)
            for block in element.find_all(["p", "h1", "h2", "h3"]):
                text = clean(block)
                assert text and "\ufffd" not in text
                section["blocks"].append(text)
                classes = block.get("class", "").split() if isinstance(block.get("class", ""), str) else block.get("class", [])
                if block.name == "p" and ("first" in classes or "prose" in classes):
                    section["body"].append(text)
                else:
                    section["headings"].append(text)
                if block.find("span", class_="dropcap"):
                    dropcaps.append({"source": filename, "rendered_start": text.split(".", 1)[0]})
            # Fail if there is unaccounted non-empty visible text outside collected blocks.
            remainder = BeautifulSoup(str(element), "xml")
            for block in remainder.find_all(["p", "h1", "h2", "h3"]):
                block.decompose()
            assert not clean(remainder), filename

        # Independent EPUB navigation traversal must enumerate exactly these 14 sections.
        toc = ET.fromstring(archive.read("toc.ncx"))
        toc_entries = [(x.find("n:navLabel/n:text", ns).text, x.find("n:content", ns).attrib["src"].split("#")[0])
                       for x in toc.findall(".//n:navPoint", ns)]
        assert [p for _, p in toc_entries] == [s["sources"][0] for s in sections]
        assert len(sections) == 14
        tracks = []
        book = None
        for section, (toc_title, _) in zip(sections, toc_entries):
            kicker, title = section["headings"]
            body = section["body"]
            chapter = None
            if section["kind"] == "part":
                roman = kicker.split()[-1]
                digit = ROMAN[roman]
                book = {"roman": roman, "number": digit, "title": title}
                assert not body
                assert toc_title == f"BOOK {roman} — {title}"
                label = f"Book {digit} - {title}"
                paragraphs = [label]
                group = label
                track_kind = "book_title"
            elif section["kind"] == "introduction":
                assert kicker == "OPENING" and title == toc_title
                label = f"Introduction - {title}"
                paragraphs = [OPENING, f"Introduction. {title}.", *body]
                group = "Introduction"
                track_kind = "introduction"
            elif section["kind"] == "conclusion":
                assert kicker == "CLOSING" and title == toc_title
                label = f"Closing Address - {title}"
                paragraphs = [f"Closing Address. {title}.", *body]
                group = "Closing Address"
                track_kind = "conclusion"
            else:
                assert book and title == toc_title
                chapter = ROMAN[kicker]
                assert section["section_id"] == f"chapter-{chapter}"
                label = f"Book {book['roman']} - Chapter {chapter:02d} - {title}"
                paragraphs = [f"Chapter {SPOKEN[chapter]}. {title}.", *body]
                group = f"Book {book['roman']} - {book['title']}"
                track_kind = "chapter"
            tracks.append({"track": len(tracks) + 1, "title": label, "group": group,
                           "chapter_number": chapter, "source": section["sources"][0],
                           "sources": section["sources"], "source_section_id": section["section_id"],
                           "source_headings": section["headings"], "source_body": body,
                           "source_body_sha256": paragraph_hash(body), "paragraphs": paragraphs,
                           "body_words": sum(len(p.split()) for p in body), "kind": track_kind,
                           "metadata_title": f"Chapter {chapter} - {title}" if chapter is not None else label})
        assert tracks[0]["paragraphs"][0] == OPENING
        assert [t["chapter_number"] for t in tracks if t["chapter_number"] is not None] == list(range(1, 10))
        # Check the narrated body is exactly the book's original body, not just same word count.
        source_body = [p for s in sections for p in s["body"]]
        narrated_body = [p for t in tracks for p in t["paragraphs"][(2 if t["kind"] == "introduction" else 1):]]
        assert source_body == narrated_body
        independent_body = []
        for filename in spine:
            document = ET.fromstring(archive.read(filename))
            for p in document.findall(".//{http://www.w3.org/1999/xhtml}p"):
                if set(p.attrib.get("class", "").split()) & {"first", "prose"}:
                    independent_body.append(" ".join("".join(p.itertext()).split()))
        assert independent_body == source_body
        all_text = "\n".join(p for t in tracks for p in t["paragraphs"])
        us_variants = r"\b(?:color(?:s|ed|ing)?|flavor(?:s|ed|ing)?|honor(?:s|ed|ing)?|neighbor(?:s|hoods?)?|favorite(?:s)?|behavior(?:s)?|center(?:s|ed|ing)?|theater(?:s)?|realiz(?:e|es|ed|ing|ation)|recogniz(?:e|es|ed|ing|able)|organiz(?:e|es|ed|ing|ation)|analyz(?:e|es|ed|ing)|defense|offense|pretense|fulfill(?:s|ed|ing|ment)?|catalog(?:s|ued)?|traveled|traveling|canceled|canceling|gray)\b"
        us_hits = re.findall(us_variants, all_text, flags=re.I)
        assert not us_hits, f"Review US spelling before rendering: {us_hits}"
        british_examples = sorted(set(re.findall(r"\b(?:recognis\w*|whilst|catalogue|Fulfilment|favours|towards)\b", all_text, flags=re.I)))
        audit = {
            "status": "passed", "epub_sha256": sha(archive_path),
            "spine_files": spine, "excluded_navigation_or_cover": excluded,
            "included_sections": [{"track": t["track"], "section_id": t["source_section_id"], "sources": t["sources"],
                                   "body_paragraphs": len(t["source_body"]), "body_sha256": t["source_body_sha256"]} for t in tracks],
            "toc_and_spine_agree": True, "all_body_paragraphs_exactly_preserved": True,
            "independent_xml_parser_body_comparison": "passed",
            "source_body_paragraphs": len(source_body), "source_body_words": sum(len(p.split()) for p in source_body),
            "source_body_sha256": paragraph_hash(source_body),
            "chapter_numbering": "Source chapters I-IX are global across the three books; narration preserves 1-9.",
            "heading_adaptations": ["OPENING becomes Introduction per requested audiobook format.",
                                    "CLOSING becomes Closing Address to match previous audiobook.",
                                    "Roman chapter numerals become spoken Chapter One through Chapter Nine.",
                                    "Roman book numerals become Book 1 through Book 3.",
                                    "Requested title and by Natalie precede the introduction heading."],
            "dropcaps_preserved": dropcaps,
            "cover_path_resolution": {
                "supplied": "C:/Users/Edward/OneDrive/the one/images/Her Eternal Night/Narration/Her Eternal Night Narration Cover.png",
                "resolved": str(COVER),
                "review": "Actual cover visually inspected and matches supplied attachment; artwork unchanged."},
            "british_spelling": {"source_language": "en-GB", "conversions": [], "us_variants_detected": us_hits,
                                  "preserved_examples": british_examples,
                                  "review": "Complete short source prose inspected; existing British spelling retained without modernising wording."},
        }
        (ROOT / "extraction-audit.json").write_text(json.dumps(audit, indent=2, ensure_ascii=False), encoding="utf-8")
        plan = {"title": TITLE, "short_title": SHORT_TITLE, "subtitle": SUBTITLE, "opening": OPENING,
                "author": author, "language": "eng", "narrator": previous["narrator"],
                "production_date": "2026-10-09", "description": metadata.find("dc:description", ns).text,
                "source": str(SOURCE), "reference": str(reference), "cover": str(COVER), "output": str(OUTPUT),
                "source_sha256": sha(SOURCE), "reference_sha256": sha(reference), "cover_sha256": sha(COVER),
                "extraction_audit": str(ROOT / "extraction-audit.json"), "extraction_audit_sha256": sha(ROOT / "extraction-audit.json"),
                "source_body_sha256": paragraph_hash(source_body), "tracks": tracks}
        (ROOT / "plan.json").write_text(json.dumps(plan, indent=2, ensure_ascii=False), encoding="utf-8")
        for track in tracks:
            print(f"{track['track']:02d}. {track['title']} ({sum(len(p.split()) for p in track['paragraphs'])} words)")
        print("Total narration words:", sum(len(p.split()) for t in tracks for p in t["paragraphs"]))
        print("Source prose words:", audit["source_body_words"])
        print("Source prose paragraphs:", len(source_body))
        print("Extraction audit:", audit["status"])


if __name__ == "__main__":
    main()
