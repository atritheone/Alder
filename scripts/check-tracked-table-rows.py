"""Compare actual Word review outcomes with Alder's original/final row grids."""
import json
import sys
from pathlib import Path
from alder.publishing import import_document
from alder.document_revisions import review_document
from alder.models import document_text

directory=Path(sys.argv[1])
project=json.loads((directory/'fixture-project.json').read_text(encoding='utf-8'))
source=project['book']['chapters'][0]['document']
def grids(doc):
    found=[]
    def walk(node):
        if node['type']=='table':found.append([[(document_text(cell),cell.get('attrs',{}).get('colspan',1),cell.get('attrs',{}).get('rowspan',1)) for cell in row['content']] for row in node['content']])
        for child in node.get('content',[]):walk(child)
    walk(doc)
    return found
for filename,view in [('word-accept.docx','final'),('word-reject.docx','original')]:
    result=import_document(directory/filename)['document'];expected=review_document(source,view)
    assert document_text(result)==document_text(expected),(filename,document_text(result),document_text(expected))
    assert grids(result)==grids(expected),filename
restored=import_document(directory/'word-resaved.docx')['document']
for view in ('original','final'):
    assert document_text(review_document(restored,view))==document_text(review_document(source,view)),view
    assert grids(review_document(restored,view))==grids(review_document(source,view)),view
print('Native Word row insertion/deletion, review decisions and resave passed.')
