"""Inspect actual native Word review outcomes, not just revision XML."""
import json,sys
from pathlib import Path
from alder.document_comments import walk
from alder.document_revisions import review_document
from alder.models import document_text
from alder.publishing import import_document
directory=Path(sys.argv[1])
source=json.loads((directory/'fixture-project.json').read_text(encoding='utf-8'))['book']['chapters'][0]['document']
defaults={'background':None,'paddingTop':5.25,'paddingBottom':5.25,'paddingLeft':5.25,'paddingRight':5.25,'verticalAlign':'top','borderWidth':.75,'borderColor':'#999999','colspan':1,'rowspan':1}
for filename,views in [('word-resaved.docx',('original','final')),('word-accept.docx',('final',)),('word-reject.docx',('original',))]:
    restored=import_document(directory/filename)['document']
    for view in views:
        actual=review_document(restored,view);expected=review_document(source,view)
        assert document_text(actual)==document_text(expected),(filename,view)
        actual_tables=[n for n in walk(actual) if n['type'] in ('table','table_row')];expected_tables=[n for n in walk(expected) if n['type'] in ('table','table_row')]
        assert len(actual_tables)==len(expected_tables)
        for a,b in zip(actual_tables,expected_tables):
            if a['type']=='table':assert a.get('attrs',{}).get('align','left')==b.get('attrs',{}).get('align','left')
            else:
                assert a.get('attrs',{}).get('allowSplit',False)==b.get('attrs',{}).get('allowSplit',False),(filename,view,'row splitting')
                x,y=a.get('attrs',{}).get('minHeight'),b.get('attrs',{}).get('minHeight')
                assert x==y or x is not None and y is not None and abs(x-y)<.051,(filename,view,'row height',x,y)
        left=[n for n in walk(actual) if n['type'] in ('table_cell','table_header')];right=[n for n in walk(expected) if n['type'] in ('table_cell','table_header')]
        assert len(left)==len(right)
        for a,b in zip(left,right):
            if b.get('attrs',{}).get('colwidth'):
                assert a['attrs'].get('colwidth')==b['attrs']['colwidth'],(filename,view,'column widths',a['attrs'].get('colwidth'),b['attrs']['colwidth'])
            for key,default in defaults.items():
                x=a['attrs'].get(key);y=b.get('attrs',{}).get(key);x=default if x is None else x;y=default if y is None else y
                if isinstance(x,str):x=x.lower()
                if isinstance(y,str):y=y.lower()
                assert x==y,(filename,view,key,x,y)
print('Native Word retained cell appearance, content and grid through resave and both review decisions.')
