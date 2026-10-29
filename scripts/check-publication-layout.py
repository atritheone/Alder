"""Verify extraction and destinations against the desktop editor's page map."""
import json
from pathlib import Path
import re
import sys
from pypdf import PdfReader
from pypdf.generic import ContentStream

directory = Path(sys.argv[1])
report = json.loads((directory / 'report.json').read_text('utf-8'))
assert report['status'] == 'passed', report.get('error', report['status'])
assert not report['errors'], report['errors']
for case in report['cases']:
    reader = PdfReader(directory / (case['label'] + '.pdf'))
    assert len(reader.pages) == len(case['expected'])
    for number, (page, expected) in enumerate(zip(reader.pages, case['expected'])):
        actual = re.findall(r'SPLIT\d{4}', page.extract_text())
        assert actual == expected['expectedTokens'], (case['label'], number, actual, expected['expectedTokens'])
    if case['label'] == 'rich-content':
        texts = [page.extract_text() for page in reader.pages]
        # Chromium deduplicates identical rasters but must draw both placements.
        assert sum(op == b'Do' for page in reader.pages for _, op in ContentStream(page.get_contents(), reader).operations) == 2
        assert [image.image.size for page in reader.pages for image in page.images] == [(60, 60)]
        destinations = {name.lstrip('/'): value for name, value in reader.named_destinations.items()}
        assert 'Destination' in destinations
        destination = reader.get_destination_page_number(destinations['Destination'])
        assert destination > 0 and 'DESTINATION_WORDS' in texts[destination]
        links = [ref.get_object() for page in reader.pages for ref in page.get('/Annots', [])]
        assert len([link for link in links if link.get('/Subtype') == '/Link']) >= 2
        assert not any(link.get('/A', {}).get('/URI', '').startswith('alder:') for link in links)
    print(f"{case['label']}: {len(reader.pages)} pages match; authored markers occur exactly once.")
