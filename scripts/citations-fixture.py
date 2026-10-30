import json,runpy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import document_text
from alder.publishing import build_export,import_document
from alder.document_comments import walk
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    project=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_citation_sources.py'))['fixture']()
    result=build_export(project,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'expectedText':['FIRST CITATION','END BODY.','A study of examples.']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    original=json.loads((root/'fixture-project.json').read_text('utf-8'))
    restored=import_document(root/'word-resaved.docx')
    citations=[node for node in walk(restored['document']) if node['type']=='citation']
    expected=next(node for node in walk(original['book']['chapters'][0]['document']) if node['type']=='citation')
    assert len(citations)==1 and citations[0]['attrs']['items']==expected['attrs']['items']
    bibliography=next(node for node in walk(restored['document']) if node['type']=='bibliography')
    assert document_text(bibliography).count('A study of examples.')==1
    pdf=PdfReader(root/'word-rendered.pdf');text='\n'.join(page.extract_text() for page in pdf.pages)
    assert text.count('(Smith, 2020, pp. 12–14)')==1 and text.count('A study of examples.')==1,text
    assert any(mark['type']=='em' for node in walk(bibliography) for mark in node.get('marks',[]))
    (root/'reimport.json').write_text(json.dumps(restored,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'status':'passed','pages':len(pdf.pages),'citations':len(citations),'warnings':restored['warnings']}))
