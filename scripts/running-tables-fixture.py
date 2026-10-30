import json
import runpy
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    source=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_running_tables.py'))
    project=source['fixture']()
    result=build_export(project,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'expectedText':['BODY ONE','BODY TWO']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    imported=import_document(root/'word-resaved.docx')
    story=imported['settings']['runningMatter']['header']['default']
    table=next(n for n in story['content'] if n['type']=='table')
    assert table['content'][0]['content'][0]['attrs']['rowspan']==2
    pdf=PdfReader(root/'word-rendered.pdf')
    assert len(pdf.pages)==2
    for i,page in enumerate(pdf.pages):
        text=page.extract_text()
        for label in ['BEFORE TABLE','HEADER COMPANY','HEADER DETAILS','AFTER TABLE',f'Page {i+1}']:
            assert text.count(label)==1,(i,label,text)
    assert not any('Complex DOCX header' in warning for warning in imported['warnings'])
    print(json.dumps({'status':'passed','checks':['native header table','merged cell','running PAGE field','Word render/resave/import']}))
