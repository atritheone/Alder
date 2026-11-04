"""Inspect native PDF cell spans and explicit header associations."""
import json,sys
from pathlib import Path
from pypdf import PdfReader
root=Path(sys.argv[1]);reader=PdfReader(root/'notes.pdf')
pages=json.loads((root/'structure.json').read_text(encoding='utf-8'));text={key:value for page in pages for key,value in page['texts'].items()}
def content(value,page=None):
    if hasattr(value,'get_object'):value=value.get_object()
    if isinstance(value,int):return text.get(f'p{page.idnum}R_mc{value}','') if page else ''
    if isinstance(value,list):return ''.join(content(child,page) for child in value)
    if isinstance(value,dict):
        page=value.raw_get('/Pg') if '/Pg' in value else page
        if '/MCID' in value:return content(value['/MCID'],page)
        return content(value.get('/K'),page)
    return ''
def nodes(value):
    if hasattr(value,'get_object'):value=value.get_object()
    if isinstance(value,dict):
        yield value
        yield from nodes(value.get('/K'))
    elif isinstance(value,list):
        for child in value:yield from nodes(child)
all_nodes=list(nodes(reader.trailer['/Root']['/StructTreeRoot']))
headers={str(n.get('/ID')):content(n) for n in all_nodes if n.get('/S')=='/TH'}
cells=[n for n in all_nodes if n.get('/S')=='/TD']
merged=[n for n in cells if 'LEFT02' in content(n)]
assert len(merged)==1 and any(a.get('/RowSpan')==2 for a in merged[0].get('/A',[]))
checked=0
for cell in cells:
    wording=content(cell)
    side='RIGHT' if 'RIGHT' in wording else 'LEFT' if 'LEFT' in wording or 'LONG' in wording else None
    if not side:continue
    labels=[headers[str(identifier)] for attr in cell.get('/A',[]) for identifier in attr.get('/Headers',[])]
    assert any(side+'00' in label for label in labels),(wording,labels)
    assert not any(('LEFT' if side=='RIGHT' else 'RIGHT')+'00' in label for label in labels),(wording,labels)
    checked+=1
print(json.dumps({'status':'passed','mergedCellRowSpan':2,'headerAssociations':checked}))
