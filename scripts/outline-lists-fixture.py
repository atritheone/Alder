"""Native Word compound-list counters, geometry and resave qualification."""
import json
from pathlib import Path
import runpy
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
source=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_outline_lists.py'))
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
edge='--edge' in sys.argv
expected=source['EDGE_LABELS'] if edge else source['LABELS']
if '--check' not in sys.argv:
    result=build_export(source['edge_fixture' if edge else 'fixture'](),'docx',root)
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'outlineNumbersExpected':expected,'expectedText':['OUTLINE_upper-alpha_0','OUTLINE_square_1_child'] if edge else ['OUTLINE_A','OUTLINE_iv']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    opened=import_document(root/'word-resaved.docx')
    assert source['labels'](opened['document'])==expected
    pages=[p.extract_text() for p in PdfReader(root/'word-rendered.pdf').pages]
    for label in expected:assert label in '\n'.join(pages),(label,pages)
    print(json.dumps({'status':'passed','pages':len(pages),'checks':['compound numbering','mixed number formats','never-restart child level','continuation','native resave/import']}))
