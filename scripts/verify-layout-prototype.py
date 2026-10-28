"""Verify the declared layout prototype subset, without claiming engine parity."""
import collections
import json
from pathlib import Path
import re
import sys
from pypdf import PdfReader

directory = Path(sys.argv[1]).resolve()
report = json.loads((directory / "report.json").read_text("utf-8"))
baseline = report["cases"][0]["pages"]
errors = []
if report.get('status') != 'captured' or len(report['cases']) != 3:
    errors.append({'error': 'The desktop capture did not finish all declared cases'})
if len(report.get('flow', [])) < 8 or len(report.get('reflow', [])) != 4:
    errors.append({'error': 'Paragraph flow or incremental reflow checks are incomplete'})
for case in report["cases"]:
    pdf = PdfReader(directory / (case["label"] + ".pdf"))
    case["pdfPages"] = len(pdf.pages)
    case["tokens"] = []
    for index, page in enumerate(pdf.pages):
        tokens = re.findall(r"SPLIT\d{4}", page.extract_text())
        case['tokens'].extend(tokens)
        if index >= len(case['pages']) or tokens != case['pages'][index].get('expectedTokens'):
            errors.append({'case': case['label'], 'page': index, 'error': 'PDF token page assignment differs from the editing map'})
    # Font hinting at fractional screen scale is allowed a small visual offset;
    # line/page boundaries and token assignment above still have to be exact.
    maximum = max([max(abs(item['dy']), abs(item['dx'])) for item in case.get('differences', [])] or [0])
    case['maximumGlyphOffsetCssPx'] = maximum
    if maximum > 3:
        errors.append({'case': case['label'], 'error': 'Glyph offset exceeds the declared 3 CSS pixel prototype tolerance', 'maximum': maximum})
    counts = collections.Counter(case["tokens"])
    bad = {f"SPLIT{i:04}": counts[f"SPLIT{i:04}"] for i in range(360) if counts[f"SPLIT{i:04}"] != 1}
    if bad:
        errors.append({"case": case["label"], "missingOrDuplicateTokens": bad})
    if len(pdf.pages) != len(case["pages"]):
        errors.append({"case": case["label"], "error": "PDF page count differs from editor"})
    if case["pages"] != baseline:
        errors.append({"case": case["label"], "error": "UI scale/zoom changed document page boundaries"})
    # The explicit page break must isolate the final marker on the last page.
    if "EXPLICIT_BREAK_END" not in pdf.pages[-1].extract_text():
        errors.append({"case": case["label"], "error": "Explicit break marker missing from final page"})
    del case["tokens"]
report["status"] = "failed" if errors else "passed-declared-subset"
report["errors"] = errors
(directory / "verification.json").write_text(json.dumps(report, indent=2), "utf-8")
print(json.dumps(report))
raise SystemExit(bool(errors))
