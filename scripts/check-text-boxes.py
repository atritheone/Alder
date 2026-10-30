"""Check the actual Word render/resave produced by test-text-boxes-desktop."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from pypdf import PdfReader
from alder.publishing import import_document
from alder.document_comments import walk

root = Path(sys.argv[1]).resolve()
pdf = PdfReader(root / 'word-rendered.pdf')
text = re.sub(r'\s', '', ''.join(page.extract_text() for page in pdf.pages))
markers = [f'PASSAGE_{i:03}' for i in range(30)] + [
    f'{box}_{word}' for box in ('BOXONE', 'BOXTWO') for word in ('ALPHA', 'OMEGA')]
for marker in markers:
    assert text.count(marker) == 1, (marker, text.count(marker))
restored = import_document(root / 'word-resaved.docx')
boxes = [node for node in walk(restored['document']) if node['type'] == 'text_box']
assert len(boxes) == 2
assert [node['attrs']['wrap'] for node in boxes] == ['left', 'right']
assert all(abs(node['attrs']['width'] - 160) < .1 for node in boxes)
assert all(any(mark['type'] == 'strong' for mark in node['content'][0]['marks']) for node in boxes)
print({'status': 'passed', 'pages': len(pdf.pages), 'boxes': len(boxes), 'markers': len(markers)})
