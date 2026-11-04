"""Verify real exported text ownership, rather than renderer metadata alone."""
import json
import re
from pathlib import Path

from pypdf import PdfReader

directory = Path('work/page-density-ui')
report = json.loads((directory / 'report.json').read_text())
assert report['status'] == 'passed', report
for case in report['cases']:
    reader = PdfReader(directory / (case['label'] + '.pdf'))
    assert len(reader.pages) == len(case['pages'])
    all_tokens = []
    for actual, expected in zip(reader.pages, case['pages']):
        tokens = re.findall(r'SPLIT\d{4}', actual.extract_text())
        assert tokens == expected['expectedTokens'], (case['label'], tokens, expected['expectedTokens'])
        all_tokens.extend(tokens)
    assert sorted(all_tokens) == [f'SPLIT{i:04}' for i in range(360)]
    text = '\n'.join(page.extract_text() for page in reader.pages)
    for marker in ['Merged cell', 'Upper cell', 'Lower cell', 'EXPLICIT_BREAK_END']:
        assert text.count(marker) == 1, (case['label'], marker)
print(f"Passed {len(report['cases'])} density/UI/zoom cases; all 360 markers on their measured pages.")

directory = Path('work/book-sections-ui')
reader = PdfReader(directory / 'book.pdf')
text = '\n'.join(page.extract_text() for page in reader.pages)
assert text.count('SECOND_BODY') == 160
assert 'EXCLUDED_BODY' not in text
for marker, size in [('FIRST_BODY', (210, 297)), ('FIRST_SECTION', (210, 148)),
                     ('SECOND_BODY', (210, 148)), ('SECOND_LETTER', (216, 279)), ('THIRD_BODY', (216, 279))]:
    for page in reader.pages:
        if marker not in page.extract_text():
            continue
        dimensions = tuple(round(float(value) * 25.4 / 72) for value in (page.mediabox.width, page.mediabox.height))
        assert dimensions == size, (marker, dimensions)
print('Book export retains all 160 column markers and inherited chapter dimensions.')
