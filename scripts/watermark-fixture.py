"""Native Word watermark fixture and render/round-trip verification."""
import json,sys,runpy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import create_project,text_document,validate_project
from alder.publishing import build_export
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--probe' in sys.argv:
    p=create_project('Watermark fixture',template='blank')
    p['settings'].update(documentKind='docx',includeTitle=False,footer=True,pageSize='A5')
    p['book']={'version':1,'chapters':[{'id':'main','title':'Watermark','include':True,'document':text_document('WATERMARK_BODY Ordinary authored text.')} ]}
else:p=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_watermark.py'))['fixture']()
if '--check' in sys.argv:
    from alder.publishing import import_document
    from alder.models import document_text
    from pypdf import PdfReader
    actual=import_document(root/'word-resaved.docx')
    for key,want in p['settings']['watermark'].items():
        found=actual['settings']['watermark'][key]
        assert abs(found-want)<.03 if key in ('widthMm','heightMm') else found==want,(key,found,want)
    assert document_text(actual['document'])==document_text(p['book']['chapters'][0]['document'])
    expected=[n['attrs']['page'].get('watermark') for n in p['book']['chapters'][0]['document']['content'] if n['type']=='section_break']
    for found,want in zip([n['attrs']['page'].get('watermark') for n in actual['document']['content'] if n['type']=='section_break'],expected):
        if want is None:assert found is None
        else:
            for key in want:assert abs(found[key]-want[key])<.03 if key in ('widthMm','heightMm') else found[key]==want[key],(found,want)
    assert len(PdfReader(root/'word-rendered.pdf').pages)==6
    print(json.dumps({'status':'passed','pages':6}));sys.exit()
p=validate_project(p);result=build_export(p,'docx',root)
(root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
(root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'expectedText':['WATERMARK_BODY'] if '--probe' in sys.argv else ['WATERMARK1','WATERMARK6'],'watermarkProbe':'--probe' in sys.argv}),encoding='utf-8')
