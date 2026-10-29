"""Word's printed STYLEREF page selection and resave qualification."""
import json
from pathlib import Path
import runpy
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
source=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_running_headings.py'))
from alder.publishing import build_export,import_document
from alder.document_comments import walk
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    project=source['fixture']('--custom' in sys.argv)
    result=build_export(project,'docx',root)
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'runningMatterExpected':True,'skipListNumbers':True,'expectedText':['FIRST BODY','SECOND BODY','THIRD BODY','FOURTH BODY']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    pages=[p.extract_text() for p in PdfReader(root/'word-rendered.pdf').pages]
    assert len(pages)==4,pages
    for page,heading in zip(pages,['Alpha','Alpha','Beta','Gamma']):assert 'CHAPTER: '+heading in page,(heading,page)
    opened=import_document(root/'word-resaved.docx')
    header=opened['settings']['runningMatter']['header']['default']
    assert next(n for n in walk(header) if n['type']=='document_field')['attrs']['fieldKind']=='heading1'
    print(json.dumps({'status':'passed','pages':len(pages),'checks':['first heading on page','last preceding heading','first following heading','body field','native update and resave']}))
