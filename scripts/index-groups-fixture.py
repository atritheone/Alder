"""Native Word refresh of separate indexes and hierarchical sort text."""
import json,runpy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.publishing import build_export,import_document
from alder.document_index import entries
from alder.models import document_text
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    p=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_index_groups.py'))['fixture']()
    result=build_export(p,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'indexesExpected':4,'skipListNumbers':True,'expectedText':['BODY only authored wording.']}),encoding='utf-8')
else:
    restored=import_document(root/'word-resaved.docx');indexes=[n for n in restored['document']['content'] if n['type']=='table_of_contents']
    assert len(indexes)==4 and len(entries([restored['document']]))==5
    assert [n['attrs'].get('indexGroup') or 'I' for n in indexes]==['I','P','S','P']
    assert [document_text(n) for n in indexes]==['General index\nOrdinary, 1','People index\nZebra, 1\nAlpha, 1','Subject index\nTrees\nZebra, 1\nAlder, 1','Plain people\nAlpha, 1\nZebra, 1']
    print(json.dumps({'status':'passed','indexes':[document_text(n) for n in indexes],'warnings':restored['warnings']}))
