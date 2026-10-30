import json,runpy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import document_text
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    project=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_book_structure.py'))['fixture']()
    result=build_export(project,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'expectedText':['BODY_'+str(i) for i in range(4)]}),encoding='utf-8')
else:
    from pypdf import PdfReader
    original=json.loads((root/'fixture-project.json').read_text('utf-8'))
    restored=import_document(root/'word-resaved.docx')
    assert [(c['title'],c['role'],c['showTitle']) for c in restored['chapters']]==[(c['title'],c['role'],c['showTitle']) for c in original['book']['chapters']]
    assert [document_text(c['document']) for c in restored['chapters']]==[c['text'] for c in original['book']['chapters']]
    pdf=PdfReader(root/'word-rendered.pdf');text='\n'.join(page.extract_text() for page in pdf.pages)
    assert len(pdf.pages)==4
    assert all(text.count('BODY_'+str(i))==1 for i in range(4)),text
    assert 'The title' not in text
    (root/'reimport.json').write_text(json.dumps(restored,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'status':'passed','pages':len(pdf.pages),'chapters':len(restored['chapters']),'warnings':restored['warnings']}))
