import json,runpy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.publishing import build_export,import_document
from alder.document_index import entries
from alder.models import document_text
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    source=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_document_index.py'))
    project=source['fixture']();result=build_export(project,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'indexesExpected':1,'skipListNumbers':True,'expectedText':['FIRST BODY','SECOND BODY','See Trees']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    restored=import_document(root/'word-resaved.docx');doc=restored['document'];assert len(entries([doc]))==6
    index=next(node for node in doc['content'] if node['type']=='table_of_contents');assert index['attrs']['kind']=='index'
    text=document_text(index);assert 'Alder, 1, 2' in text and 'Apple, 2' in text,text
    (root/'reimport.json').write_text(json.dumps(restored,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'status':'passed','index':text,'pages':len(PdfReader(root/'word-rendered.pdf').pages)}))
