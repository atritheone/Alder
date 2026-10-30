"""Authored raster images in ordinary and continuing note stories."""
import base64,copy,io,json,re,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from PIL import Image,ImageDraw
from alder.models import create_project,validate_project
from alder.publishing import build_export,import_document
from alder.document_notes import notes
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    picture=Image.new('RGB',(160,80),'#d5dde5');draw=ImageDraw.Draw(picture);draw.rectangle((10,10,150,70),outline='#263f5d',width=4);draw.line((10,10,150,70),fill='#263f5d',width=4)
    data=io.BytesIO();picture.save(data,'PNG');(root/'sample.png').write_bytes(data.getvalue())
    p=create_project(template='blank');p['name']='Note images';p['settings'].update(documentKind='docx',includeTitle=False,pageSize='A5',marginMm=20)
    p['assets']=[{'id':'sample','name':'sample.png','mime':'image/png','data':base64.b64encode(data.getvalue()).decode()}]
    def text(value):return {'type':'text','text':value}
    def para(value):return {'type':'paragraph','content':[text(value)]}
    def image(alt,block=False):return {'type':'image' if block else 'inline_image','attrs':{'assetId':'sample','src':'asset:sample','alt':alt,'width':80,'align':'right' if block else 'left','crop':{'left':10,'right':10,'top':0,'bottom':0},'decorative':alt=='Decorative sample'}}
    body={'type':'doc','content':[{'type':'paragraph','content':[text('NOTE BEFORE '),image('Inline note sample'),text(' NOTE AFTER')]},image('Decorative sample',True),para('END FIRST NOTE')]}
    long={'type':'doc','content':[para(f'LONG_NOTE_{i:03}') for i in range(70)]}
    long['content'][40]['content'].append(image('Continuation sample'))
    end={'type':'doc','content':[{'type':'paragraph','content':[text('ENDNOTE BEFORE '),image('Endnote sample'),text(' ENDNOTE AFTER')]}]}
    blocks=[{'type':'paragraph','content':[text('ANCHOR_'+name+' '),{'type':'document_note','attrs':{'kind':kind,'blockId':name,'body':story}}]} for name,kind,story in [('first','footnote',body),('long','footnote',long),('end','endnote',end)]]
    p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':{'type':'doc','content':blocks}}]};p=validate_project(p)
    result=build_export(p,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'footnotesExpected':2,'endnotesExpected':1,'skipListNumbers':True,'expectedText':['ANCHOR_first','ANCHOR_long','ANCHOR_end']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    restored=import_document(root/'word-resaved.docx');images=[]
    def walk(node):
        if node['type'] in ('image','inline_image'):images.append(node['attrs'])
        for child in node.get('content',[]):walk(child)
    for note in notes([restored['document']]):walk(note['attrs']['body'])
    assert [a['alt'] for a in images]==['Inline note sample','Decorative sample','Continuation sample','Endnote sample']
    assert all(a.get('crop')=={'left':10,'right':10,'top':0,'bottom':0} for a in images)
    assert images[1]['decorative'] is True
    pdf=PdfReader(root/'word-rendered.pdf');content=' '.join(page.extract_text() for page in pdf.pages)
    assert all(content.count(f'LONG_NOTE_{i:03}')==1 for i in range(70))
    print(json.dumps({'status':'passed','pages':len(pdf.pages),'images':len(images),'warnings':restored['warnings']}))
