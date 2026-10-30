"""ODT package/schema and independent Word exchange qualification fixture."""
import base64
import copy
import io
import json
import sys
import zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'backend/tests')]
from test_odt import fixture, p
from alder.models import validate_project, validate_document, document_text
from alder.publishing import build_export, import_document
from alder.document_notes import notes

root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    from PIL import Image, ImageDraw
    project=fixture()
    image=Image.new('RGB',(120,64),'#dce6f1');draw=ImageDraw.Draw(image);draw.rectangle((3,3,116,60),outline='#243e61',width=3)
    stream=io.BytesIO();image.save(stream,format='PNG')
    project['assets'].append({'id':'odt_picture','name':'ODT picture','mime':'image/png','data':base64.b64encode(stream.getvalue()).decode()})
    picture={'type':'inline_image','attrs':{'assetId':'odt_picture','width':120,'alt':'Blue rectangle'}}
    blocks=project['book']['chapters'][0]['document']['content']
    blocks.insert(4,{'type':'paragraph','content':[{'type':'text','text':'IMAGE_ANCHOR '},picture]})
    blocks[1]['attrs'].update(paragraphBackground='#f4f4f4',paragraphBorderWidth=.5,paragraphBorderColor='#224466',paragraphPadding=4)
    project['settings']['runningMatter']={'header':{'default':{'type':'doc','content':[p('ODT_HEADER',marks=[{'type':'highlight','attrs':{'color':'#ffff00'}}])]}},'footer':{'default':{'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':'PAGE '},{'type':'document_field','attrs':{'fieldKind':'page'},'content':[{'type':'text','text':'1'}]}]}]}}}
    foot=blocks[-1]['content'][-1]['attrs']['body']
    foot['content'][0]['content'][0]['marks']=[{'type':'highlight','attrs':{'color':'#ffff00'}}]
    project=validate_project(project)
    exported=build_export(project,'odt',root)
    (root/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':exported,'footnotesExpected':1,'runningMatterExpected':True,'skipListNumbers':True,'expectedText':['ODT_HEADING','ITEM_ONE','RIGHT_TWO','IMAGE_ANCHOR']}),encoding='utf-8')
    schemas=root.parent/'odf-schema'
    if schemas.exists():
        from lxml import etree
        with zipfile.ZipFile(exported['path']) as archive:
            for name in ('content.xml','styles.xml','meta.xml','META-INF/manifest.xml'):
                schema=etree.RelaxNG(etree.parse(str(schemas/('OpenDocument-v1.3-manifest-schema.rng' if name.startswith('META-INF') else 'OpenDocument-v1.3-schema.rng'))))
                assert schema.validate(etree.fromstring(archive.read(name))),str(schema.error_log)
        print('ODF 1.3 schema validation passed')
else:
    from pypdf import PdfReader
    reports=[]
    for name in ('word-resaved.odt','word-resaved.docx','saved-through-file-menu.odt'):
        file=(root.parent/'odt-ui'/name) if name.startswith('saved-') else root/name
        if not file.exists():continue
        imported=import_document(file);validate_document(imported['document'])
        text=document_text(imported['document'])
        for marker in ('ODT_HEADING','ITEM_ONE','ITEM_TWO','NESTED_ITEM','HEADER','MERGED','RIGHT_ONE','RIGHT_TWO','NOTE_ANCHOR','IMAGE_ANCHOR'):
            assert text.count(marker)==1,(name,marker)
        found=notes([imported['document']]);assert len(found)==1
        assert 'NOTE_TEXT' in document_text(found[0]['attrs']['body'])
        table=next(n for n in imported['document']['content'] if n['type']=='table')
        assert table['content'][0]['content'][0]['attrs']['colspan']==2
        assert table['content'][1]['content'][0]['attrs']['rowspan']==2
        assert imported['assets'] and imported['settings']['runningMatter']['header']['default']
        reports.append({'file':name,'warnings':imported['warnings']})
    for file in (root/'word-rendered.pdf',root.parent/'odt-ui'/'odt.pdf'):
        if not file.exists():continue
        pdf=PdfReader(file);text=''.join(page.extract_text() for page in pdf.pages)
        for marker in ('ODT_HEADING','MERGED','RIGHT_ONE','RIGHT_TWO','NOTE_ANCHOR','NOTE_TEXT','IMAGE_ANCHOR'):assert text.count(marker)==1,(file,marker)
        reports.append({'file':file.name,'pages':len(pdf.pages)})
    print(json.dumps({'status':'passed','checks':reports}))
