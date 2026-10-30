"""Native Word evidence for vertical alignment in a row spanning pages."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import create_project,validate_project
from alder.publishing import build_export
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' in sys.argv:
    from pypdf import PdfReader
    from alder.publishing import import_document
    from alder.models import document_text
    original=json.loads((root/'fixture-project.json').read_text('utf-8'))['book']['chapters'][0]['document']
    restored=import_document(root/'word-resaved.docx')['document']
    assert document_text(restored)==document_text(original)
    alignment=original['content'][0]['content'][0]['content'][1]['attrs']['verticalAlign']
    assert restored['content'][0]['content'][0]['content'][1]['attrs']['verticalAlign']==alignment
    pdf=PdfReader(root/'word-rendered.pdf');assert len(pdf.pages)==4
    positions={}
    for index,page in enumerate(pdf.pages):
        def visitor(text,cm,tm,font,size):
            for word in text.split():
                if word.startswith(('LONG','SHORT')):positions[word]=(index,tm[5])
        page.extract_text(visitor_text=visitor)
    for index in range(50):assert positions[f'LONG{index:03}'][0]==index//16
    assert abs(positions['LONG000'][1]-positions['SHORT000'][1]-(108 if alignment=='middle' else 216))<.1
    print(json.dumps({'status':'passed','alignment':alignment,'pages':len(pdf.pages)}));sys.exit()
alignment=sys.argv[2] if len(sys.argv)>2 else 'middle'
p=create_project('Spanning cell alignment',template='blank')
p['settings'].update(documentKind='docx',includeTitle=False,footer=True,pageSize='Custom',pageWidthMm=160,pageHeightMm=140,marginMm=15)
para=lambda value:{'type':'paragraph','attrs':{'spaceBefore':0,'spaceAfter':0,'lineSpacingMode':'exact','lineSpacing':18,'widowOrphan':False},'content':[{'type':'text','text':value}]}
cell=lambda prefix,count,align:{'type':'table_cell','attrs':{'verticalAlign':align},'content':[para(prefix+str(i).zfill(3)) for i in range(count)]}
p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':{'type':'doc','content':[{'type':'table','content':[{'type':'table_row','attrs':{'allowSplit':True},'content':[cell('LONG',50,'top'),cell('SHORT',4,alignment)]}]},para('AFTER_TABLE')]}}]}
p=validate_project(p);result=build_export(p,'docx',root)
(root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
(root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'expectedText':['LONG000','LONG049','SHORT003','AFTER_TABLE']}),encoding='utf-8')
