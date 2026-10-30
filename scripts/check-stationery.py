"""Verify native Word resave and physical PDF size against a desktop fixture."""
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from pypdf import PdfReader
from pypdf._text_extraction import mult
from alder.publishing import import_document
from alder.stationery import preset

root=Path(sys.argv[1])
project=json.loads((root/'fixture-project.json').read_text(encoding='utf-8'))
stock=preset(project['settings']['stationeryPreset'])
expected=json.loads((root/'fixture-exports.json').read_text(encoding='utf-8'))['expectedText']
positions={}
for filename in ('alder.pdf','word-rendered.pdf'):
    pdf=PdfReader(root/filename)
    assert len(pdf.pages)==1,(filename,len(pdf.pages))
    page=pdf.pages[0]
    assert abs(float(page.mediabox.width)*25.4/72-stock['paper'][0])<.3
    assert abs(float(page.mediabox.height)*25.4/72-stock['paper'][1])<.3
    positions[filename]={}
    def locate(text,cm,tm,font,size):
        transform=mult(tm,cm)
        for marker in expected:
            if marker.startswith('ADDR_') and marker in text:
                positions[filename][marker]=(transform[4]*25.4/72,transform[5]*25.4/72)
    text=page.extract_text(visitor_text=locate)
    for marker in expected:assert text.count(marker)==1,(filename,marker,text.count(marker))
for marker,point in positions['alder.pdf'].items():
    other=positions['word-rendered.pdf'][marker]
    assert all(abs(a-b)<.75 for a,b in zip(point,other)),(marker,point,other)
restored=import_document(root/'word-resaved.docx')
table=next(n for n in restored['document']['content'] if n['type']=='table')
assert len(table['content'])==len(stock['rows'])
for row,height in zip(table['content'],stock['rows']):
    assert abs(row['attrs']['minHeight']-height*72/25.4)<.2
    for cell,width in zip(row['content'],stock['columns']):
        assert abs(cell['attrs']['colwidth'][0]-width*96/25.4)<.2
print(json.dumps({'status':'passed','preset':stock['id'],'pages':1,'markers':len(expected)}))
