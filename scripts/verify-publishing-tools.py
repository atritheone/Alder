"""Verify packaged publishing engines without any externally installed tools."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile


def main():
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--resources", type=Path, default=project_root / "work/bundle-resources")
    parser.add_argument("--output", type=Path, default=project_root / "work/publishing-isolation-check")
    args = parser.parse_args()
    resources = args.resources.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    os.environ["ALDER_RESOURCES_DIR"] = str(resources)
    os.environ["PATH"] = ""
    os.environ["PYTHONNOUSERSITE"] = "1"
    os.environ["CALIBRE_CONFIG_DIRECTORY"] = str(output / "calibre-config")
    os.environ["CALIBRE_CACHE_DIRECTORY"] = str(output / "calibre-cache")
    for key in ("JAVA_HOME", "JRE_HOME", "ALDER_JAVA", "ALDER_EPUBCHECK_JAR", "ALDER_EBOOK_CONVERT", "PYTHONHOME", "CALIBRE_DEVELOP_FROM"):
        os.environ.pop(key, None)
    backend = resources / "backend" if (resources / "backend/alder/publishing.py").is_file() else project_root / "backend"
    assert Path(sys.executable).resolve().is_relative_to(resources / "python"), "Run this check with the selected resource bundle's own Python interpreter."
    sys.path.insert(0, str(backend))
    import alder.publishing as publishing
    from alder.models import create_project
    from alder.publishing import _epubcheck_command, build_export, capabilities, import_document, project_document
    assert Path(publishing.__file__).resolve().is_relative_to(backend), "Publishing imported from an unintended backend."
    engines = capabilities()
    checker_command = _epubcheck_command()
    assert engines["azw3"]["available"] and checker_command, "A required publishing engine is missing from the bundle."
    assert Path(engines["azw3"]["converter"]).resolve().is_relative_to(resources), "Calibre resolved outside packaged resources."
    assert Path(checker_command[0]).resolve().is_relative_to(resources), "Java resolved outside packaged resources."
    assert Path(checker_command[2]).resolve().is_relative_to(resources), "EPUBCheck resolved outside packaged resources."
    project = create_project("Alder isolated publishing verification", "demo")
    epub = build_export(project, "epub", output / "epub")
    assert epub["validation"]["status"] == "passed", epub
    assert epub["validation"]["epubcheck"]["status"] == "passed", epub
    azw3 = build_export(project, "azw3", output / "azw3")
    assert Path(azw3["path"]).stat().st_size > 0
    assert azw3["validation"]["status"] == "converted", azw3
    assert azw3["validation"]["sourceEpub"]["status"] == "passed", azw3
    # Conversion success alone does not prove reading order or navigation.
    # Reopen the actual AZW3 with Calibre and compare its recovered content/TOC.
    reopened = output / "azw3-reopened.epub"
    converted = subprocess.run([engines["azw3"]["converter"], azw3["path"], str(reopened)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    assert converted.returncode == 0 and reopened.is_file(), converted.stdout + converted.stderr
    recovered = re.sub(r"\s+", " ", import_document(reopened)["text"]).strip()
    cursor = 0
    checked_sections = []
    for section in project_document(project):
        expected = re.sub(r"\s+", " ", section["text"]).strip()
        position = recovered.find(expected, cursor) if expected else cursor
        assert position >= cursor, f"AZW3 lost or reordered section text: {section['title']}"
        cursor = position + len(expected)
        checked_sections.append(section["title"])
    with zipfile.ZipFile(reopened) as archive:
        ncx = next((name for name in archive.namelist() if name.lower().endswith(".ncx")), None)
        assert ncx, "AZW3 recovered EPUB has no navigation document."
        navigation = ET.fromstring(archive.read(ncx))
        labels = ["".join(node.itertext()).strip() for node in navigation.findall(".//{*}navLabel/{*}text")]
        for title in checked_sections:
            assert title in labels, f"AZW3 lost navigation label: {title}"
    semantic_check = {"status": "passed", "reopenedEpub": str(reopened),
                      "sectionTextOrder": checked_sections, "navigationLabels": labels,
                      "conversionExitCode": converted.returncode}
    report = {"status": "passed", "python": sys.executable, "path": os.environ["PATH"], "resources": str(resources),
              "backend": str(backend), "publishingModule": publishing.__file__,
              "epubcheckCommand": checker_command, "calibre": engines["azw3"]["converter"], "epub": epub, "azw3": azw3,
              "azw3SemanticCheck": semantic_check}
    (output / "report.json").write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    main()
