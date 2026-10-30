"""Verify the desktop index-range fixture after actual Word render/resave."""
import json
from pathlib import Path
import sys
from pypdf import PdfReader
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.document_index import entries
from alder.publishing import import_document
from alder.models import document_text

root=Path(sys.argv[1])
for name in ('alder.docx','word-resaved.docx'):
    doc=import_document(root/name)['document']
    entry=next(a for a in entries([doc]) if a['terms']==['New term'])
    def walk(n):
        yield n
        for c in n.get('content',[]):yield from walk(c)
    bookmark=next(n for n in walk(doc) if n['type']=='bookmark' and n['attrs']['blockId']==entry['rangeId'])
    assert bookmark['attrs']['range'],name
    index=next(n for n in doc['content'] if n['type']=='table_of_contents')
    assert 'New term, 2–3' in document_text(index),(name,document_text(index))
for name in ('index.pdf','word-rendered.pdf'):
    pdf=PdfReader(root/name)
    assert len(pdf.pages)==4,(name,len(pdf.pages))
    text='\n'.join(p.extract_text() for p in pdf.pages)
    assert 'New term, 2–3' in text,(name,text)
    for marker in ('FIRST BODY','SECOND BODY'):assert text.count(marker)==1,(name,marker)
print(json.dumps({'status':'passed','range':'2–3','nativeWordRoundTrip':True,'pages':4}))
