import json,runpy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import document_text
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    project=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_page_border.py'))['fixture']()
    result=build_export(project,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'expectedText':['BORDER1','BORDER10']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    original=json.loads((root/'fixture-project.json').read_text('utf-8'))
    restored=import_document(root/'word-resaved.docx')
    assert document_text(restored['document'])==document_text(original['book']['chapters'][0]['document'])
    assert restored['settings']['pageBorder']==original['settings']['pageBorder']
    assert [n['attrs']['page'].get('pageBorder') for n in restored['document']['content'] if n['type']=='section_break']==[n['attrs']['page'].get('pageBorder') for n in original['book']['chapters'][0]['document']['content'] if n['type']=='section_break']
    pdf=PdfReader(root/'word-rendered.pdf');assert len(pdf.pages)==10
    (root/'reimport.json').write_text(json.dumps(restored,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'status':'passed','pages':len(pdf.pages)}))
