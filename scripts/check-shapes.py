"""Check shape wording, editable exports and actual PDF alternatives."""
import json,sys
from collections import Counter
from pathlib import Path
from pypdf import PdfReader
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.publishing import import_document
root=Path(sys.argv[1]).resolve()
project=json.loads((root/'fixture-project.json').read_text(encoding='utf-8'))
def walk(node):
    yield node
    for child in node.get('content',[]):yield from walk(child)
shapes=[n for n in walk(project['book']['chapters'][0]['document']) if n['type']=='shape']
reader=PdfReader(root/'alder.pdf');text='\n'.join(page.extract_text() for page in reader.pages)
for marker in [f'SHAPE_{i}' for i in range(5)]+['AFTER_COPY']:assert text.count(marker)==1,(marker,text)
alts=[];seen=set()
def structure(value):
    if hasattr(value,'idnum'):
        if value.idnum in seen:return
        seen.add(value.idnum);value=value.get_object()
    if isinstance(value,dict):
        if '/Alt' in value:alts.append(str(value['/Alt']))
        for key,child in value.items():
            if key not in ('/P','/Parent','/Pg','/Root'):structure(child)
    elif isinstance(value,list):
        for child in value:structure(child)
structure(reader.trailer['/Root'].get('/StructTreeRoot'))
assert Counter(alts)==Counter(n['attrs']['alt'] for n in shapes if not n['attrs'].get('decorative')),alts
assert not any(page.images for page in reader.pages),'Shapes were rasterised'
for format in ('docx','html','epub'):
    actual=[n for n in walk(import_document(root/('alder.'+format))['document']) if n['type']=='shape']
    assert len(actual)==len(shapes)
    for a,b in zip(shapes,actual):
        for key in ('kind','alt','decorative'):assert a['attrs'][key]==b['attrs'][key]
        for key in ('width','height','strokeWidth'):assert abs(a['attrs'][key]-b['attrs'][key])<.01
print(json.dumps({'status':'passed','pages':len(reader.pages),'shapes':len(shapes),'taggedDescriptions':len(alts),'vectorPaint':True}))
