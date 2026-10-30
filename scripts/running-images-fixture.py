import json,runpy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
source=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_running_images.py'))
if '--check' not in sys.argv:
    project=source['fixture']();result=build_export(project,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'expectedText':['BODY ONE','BODY TWO']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    imported=import_document(root/'word-resaved.docx')
    picture=next(source['images'](imported['settings']['runningMatter']['header']['default']))
    assert picture['attrs']['alt']=='Company logo'
    assert picture['attrs']['crop']['left']==25
    pages=PdfReader(root/'word-rendered.pdf').pages;assert len(pages)==2
    for page in pages:assert len(page.images)==1 and page.extract_text().count('COMPANY')==1
    print(json.dumps({'status':'passed','checks':['native header image in table','crop and alt text','Word rendering and resaving']}))
