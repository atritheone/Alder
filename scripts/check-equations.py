"""Check actual desktop export and native Word resave; no private documents."""
import json
from pathlib import Path
import sys
from lxml import etree as E
from pypdf import PdfReader
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.equations import parse
from alder.publishing import import_document

def walk(n):
    yield n
    for c in n.get('content',[]):yield from walk(c)

def terms(n):
    return ''.join(x.text or '' for x in parse(n['attrs']['mathML']).iter() if E.QName(x).localname in ('mi','mn','mo','mtext')).replace('−','-').replace('‾','¯')

def structure(value):
    if hasattr(value,'get_object'):value=value.get_object()
    if isinstance(value,list):
        for child in value:yield from structure(child)
    elif isinstance(value,dict):
        if value.get('/S'):yield value
        if '/K' in value:yield from structure(value['/K'])

root=Path(sys.argv[1])
source=json.loads((root/'fixture-project.json').read_text(encoding='utf-8'))['book']['chapters'][0]['document']
equations=[n for n in walk(source) if n['type']=='equation']
for file in ('alder.docx','word-resaved.docx'):
    restored=[n for n in walk(import_document(root/file)['document']) if n['type']=='equation']
    assert len(restored)==len(equations),file
    assert [terms(n) for n in restored]==[terms(n) for n in equations],file
    alphabets=[n.get('mathvariant') for item in restored for n in parse(item['attrs']['mathML']).iter()]
    assert 'double-struck' in alphabets and 'script' in alphabets,file
for file in ('alder.pdf','word-rendered.pdf'):
    pdf=PdfReader(root/file);assert len(pdf.pages)==1,file
    text=pdf.pages[0].extract_text()
    for i in range(5):assert text.count('FORMULA_'+str(i))==1,(file,i)
pdf=PdfReader(root/'alder.pdf')
alternatives=[str(n.get('/Alt','')) for n in structure(pdf.trailer['/Root']['/StructTreeRoot']) if n['/S']=='/Figure']
assert sorted(alternatives)==sorted(n['content'][0]['text'] for n in equations),alternatives
print(json.dumps({'status':'passed','equations':len(equations),'nativeWordRoundTrip':True,'pdfReadingAlternatives':len(alternatives)}))
