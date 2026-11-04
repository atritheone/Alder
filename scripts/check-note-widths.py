"""No duplicated or missing note wording in actual desktop/Word output."""
import json
from pathlib import Path
import sys
from pypdf import PdfReader
from pypdf.generic import ContentStream
root=Path(sys.argv[1]);results={}
fixture=json.loads((root/'fixture-exports.json').read_text(encoding='utf-8'));expected=fixture.get('images',0)
def pictures(stream,resources,reader,depth=0):
    assert depth<20,'Cyclic PDF form'
    count=0
    for operands,operation in ContentStream(stream,reader).operations:
        if operation!=b'Do':continue
        target=resources['/XObject'][operands[0]].get_object()
        if target['/Subtype']=='/Image':count+=1
        elif target['/Subtype']=='/Form':count+=pictures(target,target.get('/Resources',resources),reader,depth+1)
    return count
for name in (('alder.pdf','word-rendered.pdf') if '--word' in sys.argv else ('alder.pdf',)):
    pdf=PdfReader(root/name);text='\n'.join(p.extract_text() for p in pdf.pages)
    for i in range(400):
        marker=f'NOTE{i:04d}';assert text.count(marker)==1,(name,marker,text.count(marker))
    for marker in ('FIRST_BODY','SECOND_BODY','THIRD_BODY'):assert text.count(marker)==1,(name,marker)
    for marker in fixture.get('listMarkers',[]):assert text.count(marker)==1,(name,'list marker',marker,text.count(marker))
    if expected:
        actual=sum(pictures(page.get_contents(),page['/Resources'],pdf) for page in pdf.pages)
        assert actual==expected,(name,'pictures',actual,expected)
    results[name]=len(pdf.pages)
print(json.dumps({'status':'passed','noteMarkers':400,'pages':results}))
