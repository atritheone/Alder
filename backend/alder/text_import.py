"""Local text extraction for reading; no end-user converters or services."""
from pathlib import Path
import os
import subprocess
import tempfile

EBOOKS = {".azw", ".azw3", ".mobi", ".prc", ".pdb", ".lit", ".lrf", ".fb2", ".fbz", ".tcr"}


def extract_text(path: Path):
    from .publishing import _bundled_root, _java, capabilities
    raw = path.read_bytes()
    if not raw:
        return "", []
    # Text is recognised by content, so .log, .csv, source files and extensionless
    # documents work without an ever-growing filename allow-list.
    if path.suffix.lower() not in EBOOKS | {".rtf", ".pdf", ".doc", ".ppt", ".xls", ".odt", ".ods", ".odp", ".xlsx", ".pptx", ".eml", ".mht", ".chm", ".djvu", ".fb3", ".wpd"}:
        if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
            return raw.decode("utf-16"), []
        try:
            text = raw.decode("utf-8-sig")
            if not any(ord(c) < 32 and c not in "\r\n\t\f" for c in text):
                return text, []
        except UnicodeDecodeError:
            pass
        if b"\0" not in raw and not raw.startswith((b"PK", b"%PDF", b"\xd0\xcf")):
            from charset_normalizer import from_bytes
            detected = from_bytes(raw).best()
            if detected and detected.percent_chaos < 5:
                return str(detected), [f"Text decoded as {detected.encoding}; check any unusual characters."]
    hidden = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
    with tempfile.TemporaryDirectory(prefix="alder-reading-") as scratch:
        if path.suffix.lower() == ".rtf" and raw.lstrip().startswith(b"{\\rtf") and raw.rstrip().endswith(b"}"):
            # Tika flushes RTF text at paragraph boundaries; an otherwise valid
            # final paragraph without \\par can disappear. Terminate it in a
            # private copy, never by changing the user's source file.
            path = Path(scratch) / "reading.rtf"
            path.write_bytes(raw.rstrip()[:-1] + b"\\par }")
        if path.suffix.lower() in EBOOKS:
            converter = capabilities()["azw3"]["converter"]
            if not converter:
                raise ValueError("Alder's bundled ebook reader is missing. Repair the application.")
            output = Path(scratch) / "text.txt"
            result = subprocess.run([converter, str(path), str(output)], capture_output=True, timeout=120, **hidden)
            if result.returncode or not output.is_file():
                raise ValueError("This ebook could not be opened. It may be damaged, encrypted, or unsupported.")
            text = output.read_text(encoding="utf-8-sig")
        else:
            jar = _bundled_root() / "tika/tika-app-3.3.2.jar"
            java = _java()
            if not jar.is_file() or not java:
                raise ValueError("Alder's bundled document reader is missing. Repair the application.")
            # No external OCR process or arbitrary external parser executable.
            config = Path(scratch) / "tika.xml"
            config.write_text('<properties><parsers><parser class="org.apache.tika.parser.DefaultParser"><parser-exclude class="org.apache.tika.parser.ocr.TesseractOCRParser"/><parser-exclude class="org.apache.tika.parser.external.ExternalParser"/></parser></parsers></properties>', encoding="utf-8")
            result = subprocess.run([java, "-Xmx512m", "-Dfile.encoding=UTF-8", "-jar", str(jar), "--text", f"--config={config}", str(path)], capture_output=True, timeout=120, **hidden)
            if result.returncode:
                raise ValueError("This document could not be opened. It may be damaged, password-protected, or unsupported.")
            text = result.stdout.decode("utf-8-sig", errors="replace").strip()
        if not text.strip():
            raise ValueError("No readable text was found. This file may contain only scanned images or an unsupported format.")
        if len(text.encode("utf-8")) > 30_000_000:
            raise ValueError("The extracted text exceeds Alder's document size limit.")
        return text, ["Imported readable text. Original page geometry, complex formatting and embedded objects are not reproduced."]
