"""Paragraph anchors, square wrapping and native Word exchange evidence."""
import base64,io,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from PIL import Image,ImageDraw
from alder.models import create_project,validate_project
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' in sys.argv:
    from pypdf import PdfReader
    restored=import_document(root/'word-resaved.docx');images=[]
    def walk(node):
        if node['type'] in ('image','inline_image'):images.append(node['attrs'])
        for child in node.get('content',[]):walk(child)
    walk(restored['document'])
    assert [a.get('wrap','none') for a in images]==(['none','none'] if '--table' in sys.argv else ['left','right'])
    if '--table' not in sys.argv:assert all(a['wrapGap']==12 for a in images)
    pdf=PdfReader(root/'word-rendered.pdf');text=' '.join(p.extract_text() for p in pdf.pages)
    assert all(text.count(f'PASSAGE_{i:03}')==1 for i in range(30))
    print(json.dumps({'status':'passed','pages':len(pdf.pages),'images':len(images),'warnings':restored['warnings']}));sys.exit()
picture=Image.new('RGB',(200,240),'#d5dde5');draw=ImageDraw.Draw(picture);draw.rectangle((10,10,190,230),outline='#263f5d',width=5);draw.line((10,10,190,230),fill='#263f5d',width=5)
data=io.BytesIO();picture.save(data,'PNG');(root/'sample.png').write_bytes(data.getvalue())
p=create_project('Wrapped pictures',template='blank');p['settings'].update(documentKind='docx',includeTitle=False,pageSize='A5',marginMm=20,fontSize=10,lineHeight=1)
p['assets']=[{'id':'sample','name':'sample.png','mime':'image/png','data':base64.b64encode(data.getvalue()).decode()}]
def para(i):return {'type':'paragraph','attrs':{'fontSize':10,'lineSpacingMode':'exact','lineSpacing':14,'spaceBefore':0,'spaceAfter':3,'widowOrphan':False},'content':[{'type':'text','text':f'PASSAGE_{i:03} The words follow the illustration and return to the full column when there is room below it. Each paragraph remains independently editable.'}]}
blocks=[para(i) for i in range(30)]
for index,side in [(0,'left'),(12,'right')]:blocks[index]['content'].insert(0,{'type':'inline_image','attrs':{'assetId':'sample','src':'asset:sample','alt':side+' illustration','width':120,'wrap':side,'wrapGap':12}})
if '--table' in sys.argv:
    cells=[]
    for paragraphs in (blocks[:12],blocks[12:]):
        content=[]
        for paragraph in paragraphs:
            if paragraph['content'][0]['type']=='inline_image':
                image=paragraph['content'].pop(0);image['type']='image';image['attrs']['wrap']='none';content.append(image)
            content.append(paragraph)
        cells.append({'type':'table_cell','attrs':{'colwidth':[204],'paddingTop':2,'paddingBottom':2,'paddingLeft':2,'paddingRight':2},'content':content})
    blocks=[{'type':'table','content':[{'type':'table_row','attrs':{'allowSplit':True},'content':cells}]}]
p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':{'type':'doc','content':blocks}}]};p=validate_project(p)
result=build_export(p,'docx',root)
(root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
(root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'expectedText':['PASSAGE_000','PASSAGE_029']}),encoding='utf-8')
