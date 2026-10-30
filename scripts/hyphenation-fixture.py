import json
import runpy
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
source=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_hyphenation.py'))
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    result=build_export(source['fixture'](),'docx',root)
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'expectedText':['extraordinary representation','Silbentrennung']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    doc=import_document(root/'word-resaved.docx')['document']
    paragraphs=[n for n in doc['content'] if n['type']=='paragraph']
    assert [(n['attrs'].get('hyphenation'),n['attrs'].get('textLanguage')) for n in paragraphs]==[(True,'en-GB'),(False,'de')]
    text='\n'.join(p.extract_text() for p in PdfReader(root/'word-rendered.pdf').pages)
    assert '-' in text,text
    print(json.dumps({'status':'passed','checks':['native automatic hyphens','paragraph on/off','paragraph languages','resave/import']}))
