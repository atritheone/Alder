"""RTF editable-text subset, native Word exchange and desktop export checks."""
import base64
import io
import json
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'backend/tests')]
from test_rtf import fixture,p
from alder.models import validate_project,validate_document,document_text
from alder.publishing import build_export,import_document
from alder.document_notes import notes

root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    from PIL import Image,ImageDraw
    project=fixture();image=Image.new('RGB',(120,64),'#dce6f1');draw=ImageDraw.Draw(image);draw.rectangle((3,3,116,60),outline='#243e61',width=3)
    data=io.BytesIO();image.save(data,format='PNG')
    project['assets'].append({'id':'rtf_picture','name':'RTF picture','mime':'image/png','data':base64.b64encode(data.getvalue()).decode()})
    content=project['book']['chapters'][0]['document']['content']
    content.insert(3,p('EDIT_TARGET'))
    content.insert(4,{'type':'paragraph','content':[{'type':'text','text':'IMAGE_ANCHOR '},{'type':'inline_image','attrs':{'assetId':'rtf_picture','width':120,'alt':'Blue rectangle'}}]})
    content.append({'type':'paragraph','content':[{'type':'text','text':'END_ANCHOR'},{'type':'document_note','attrs':{'kind':'endnote','blockId':'rtf_end','body':{'type':'doc','content':[p('END_TEXT')]}}}]})
    project['settings']['runningMatter']={'header':{'default':{'type':'doc','content':[p('RTF_HEADER')]}},'footer':{'default':{'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':'PAGE '},{'type':'document_field','attrs':{'fieldKind':'page'},'content':[{'type':'text','text':'1'}]}]}]}}}
    project=validate_project(project)
    exported=build_export(project,'rtf',root)
    (root/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':exported,'footnotesExpected':1,'endnotesExpected':1,'skipListNumbers':True,'expectedText':['RTF_HEADING','EDIT_TARGET','IMAGE_ANCHOR','END_ANCHOR']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    checks=[]
    for name in ('word-resaved.rtf','word-resaved.docx','saved-through-file-menu.rtf'):
        file=(root.parent/'rtf-ui'/name) if name.startswith('saved-') else root/name
        if not file.exists():continue
        result=import_document(file);validate_document(result['document'])
        text=document_text(result['document'])
        assert '\U0001f600' in text and 'caf\u00e9' in text
        for marker in ('RTF_HEADING','EDIT_TARGET','IMAGE_ANCHOR','END_ANCHOR'):assert text.count(marker)==1,(name,marker)
        found=notes([result['document']]);assert len(found)==2
        assert [n['attrs']['kind'] for n in found]==['footnote','endnote']
        assert [document_text(n['attrs']['body']) for n in found]==['NOTE_TEXT','END_TEXT']
        assert result['assets'] and result['settings']['runningMatter']['header']['default']
        def walk(node):
            yield node
            for child in node.get('content',[]):yield from walk(child)
        link=next(n for n in walk(result['document']) if n.get('text')=='LINK')
        assert any(m['type']=='link' for m in link['marks'])
        checks.append({'file':name,'notes':len(found),'warnings':result['warnings']})
    for file in (root/'word-rendered.pdf',root.parent/'rtf-ui'/'rtf.pdf'):
        if not file.exists():continue
        pdf=PdfReader(file);text=''.join(page.extract_text() for page in pdf.pages)
        for marker in ('RTF_HEADING','EDIT_TARGET','IMAGE_ANCHOR','END_ANCHOR','NOTE_TEXT','END_TEXT'):assert text.count(marker)==1,(file,marker)
        checks.append({'file':file.name,'pages':len(pdf.pages)})
    print(json.dumps({'status':'passed','checks':checks}))
