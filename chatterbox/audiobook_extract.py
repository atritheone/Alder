"""Extract this audiobook's ordered, auditable reading script from Calibre's EPUB."""
import hashlib
import json
import os
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup

ROOT = Path(os.environ["LOCALAPPDATA"]) / "chatterbox/audiobooks/her-many-faces"
SOURCE = Path("C:/Users/Edward/OneDrive/the one/images/Her Many Faces/eBook/Her Many Faces (AZW3).azw3")
REFERENCE = Path("C:/Users/Edward/OneDrive/flash/books/Narrations/A Tale Of Two Cities/01-04 Chapter 1-2a The Mail.mp3")
COVER = Path("C:/Users/Edward/OneDrive/the one/images/Her Many Faces/Flash/Her Many Faces Narration Cover.png")
OUTPUT = Path("C:/Users/Edward/OneDrive/the one/images/Her Many Faces/Audiobook")
OPENING = "Her Many Faces: Of The Goddess’s Secret and Interior Life by Natalie"


def main():
    with ZipFile(ROOT / "source.epub") as archive:
        opf = ET.fromstring(archive.read("content.opf"))
        ns = {"o": "http://www.idpf.org/2007/opf", "dc": "http://purl.org/dc/elements/1.1/"}
        files = {x.attrib["id"]: x.attrib["href"] for x in opf.findall("o:manifest/o:item", ns)}
        spine = [files[x.attrib["idref"]] for x in opf.findall("o:spine/o:itemref", ns)]
        tracks = []
        book = None
        for filename in spine:
            soup = BeautifulSoup(archive.read(filename), "xml")
            section = soup.find("section")
            if section is None:
                continue
            kind = section.get("epub:type")
            if kind not in ("introduction", "part", "chapter", "conclusion", "afterword") and filename != "text/part0024.html":
                continue
            blocks = [" ".join(x.get_text(" ", strip=True).split()) for x in section.find_all(["p", "h1", "h2", "h3"])]
            assert all("\ufffd" not in b for b in blocks)
            kicker, title, *body = blocks
            if kind == "part":
                roman = kicker.split()[-1]
                number = {"I": "One", "II": "Two", "III": "Three"}[roman]
                book = {"roman": roman, "title": title, "spoken": f"Book {number}. {title}."}
                assert not body
                digit = {"I": 1, "II": 2, "III": 3}[roman]
                label = f"Book {digit} - {title}"
                tracks.append({"track": len(tracks) + 1, "title": label, "group": label, "chapter_number": None,
                               "source": filename, "paragraphs": [label], "body_words": 0, "kind": "book_title"})
                continue
            if kind == "introduction":
                label = f"Introduction - {title}"
                paragraphs = [OPENING, f"Introduction. {title}.", *body]
                group = "Introduction"
                chapter_number = None
            elif filename == "text/part0024.html":
                label = f"Closing Address - {title}"
                paragraphs = [f"Closing Address. {title}.", *body]
                group = "Closing Address"
                chapter_number = None
            else:
                chapter_number = int(kicker.split()[-1])
                number = ["", "One", "Two", "Three", "Four", "Five", "Six"][chapter_number]
                label = f"Book {book['roman']} - Chapter {chapter_number:02d} - {title}"
                paragraphs = [f"Chapter {number}. {title}.", *body]
                group = f"Book {book['roman']} - {book['title']}"
            tracks.append({"track": len(tracks) + 1, "title": label, "group": group, "chapter_number": chapter_number,
                           "source": filename, "paragraphs": paragraphs, "body_words": sum(len(p.split()) for p in body)})
        assert len(tracks) == 23 and tracks[0]["paragraphs"][0] == OPENING
        assert sum(t["chapter_number"] is not None for t in tracks) == 18
        for track in tracks:
            track["metadata_title"] = (f"Chapter {track['chapter_number']} - {track['title'].split(' - ', 2)[2]}"
                                       if track["chapter_number"] is not None else track["title"])
        plan = {"title": "Her Many Faces: Of The Goddess’s Secret and Interior Life", "author": "Natalie", "language": "eng",
                "narrator": "Chatterbox (AI narration)", "description": opf.find("o:metadata/dc:description", ns).text,
                "source": str(SOURCE), "reference": str(REFERENCE), "cover": str(COVER), "output": str(OUTPUT),
                "source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                "reference_sha256": hashlib.sha256(REFERENCE.read_bytes()).hexdigest(),
                "cover_sha256": hashlib.sha256(COVER.read_bytes()).hexdigest(), "tracks": tracks}
        (ROOT / "plan.json").write_text(json.dumps(plan, indent=2, ensure_ascii=False), encoding="utf-8")
        for track in tracks:
            print(f"{track['track']:02d}: {track['title']} ({sum(len(p.split()) for p in track['paragraphs'])} words)")
        print("Total words:", sum(len(p.split()) for t in tracks for p in t["paragraphs"]))


if __name__ == "__main__":
    main()
