"""Check authored words and hyphens crossing physical page boundaries."""
import json
from pathlib import Path
import re
import sys
from pypdf import PdfReader

directory=Path(sys.argv[1])
report=json.loads((directory/'report.json').read_text('utf-8'))
assert report['status']=='passed',report
reader=PdfReader(directory/'hyphenation.pdf')
assert len(reader.pages)==report['pages']
# This fixture has a two-line German running header on every page.
body='\n'.join('\n'.join(page.extract_text().splitlines()[2:]) for page in reader.pages)
assert '\u00ad' not in body, 'Unused discretionary characters leaked into PDF text.'
actual=re.sub(r'\s*-\s*','',body)
actual=' '.join(actual.split())
expected='Added '+('extraordinary representation internationalisation characteristically '*20)+'Silbentrennung bleibt erhalten.'
assert actual==expected,(actual,expected)
print(f'{len(reader.pages)} pages: all authored words occur once, in order, with no invisible hyphens.')
