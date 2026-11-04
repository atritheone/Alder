"""Native Word qualification of Alder's declared inline-shape subset."""
import json,runpy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.publishing import build_export,import_document
from alder.models import document_text
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
module=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_document_shapes.py'))
if '--check' not in sys.argv:
    p=module['fixture']();exported=build_export(p,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':exported,'skipListNumbers':True,'expectedText':[f'SHAPE_{i} before' for i in range(5)]}),encoding='utf-8')
else:
    source=json.loads((root/'fixture-project.json').read_text(encoding='utf-8'))['book']['chapters'][0]['document']
    restored=import_document(root/'word-resaved.docx')['document']
    assert document_text(restored)==document_text(source)
    actual=module['shapes'](restored);assert len(actual)==5
    for a,b in zip(module['shapes'](source),actual):
        for key,value in a['attrs'].items():
            if key=='blockId':continue
            found=b['attrs'][key]
            if key in ('stroke','fill'):assert str(found).lower()==str(value).lower()
            elif type(value) in (int,float):assert abs(value-found)<.05,(key,value,found)
            else:assert value==found,(key,value,found)
    print(json.dumps({'status':'passed','editableNativeShapes':len(actual)}))
