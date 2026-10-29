"""Uniform paragraph decoration round trip through installed Word."""
import json,runpy,sys
from pathlib import Path
source=runpy.run_path(str(Path(__file__).with_name('word-processing-fixture.py')))
from alder.publishing import build_export,import_document
from alder.models import document_text
fixture=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_paragraph_appearance.py'))
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    project=source['fixture']();part=fixture['fixture']()
    project['styles'].extend(part['styles'])
    project['book']['chapters'][0]['document']['content'].extend(part['book']['chapters'][0]['document']['content'])
    result=build_export(project,'docx',root);(root/'fixture-exports.json').write_text(json.dumps({'docx':result}),encoding='utf-8')
else:
    result=import_document(root/'word-resaved.docx')
    blocks=result['document']['content']
    first=next(n for n in blocks if document_text(n)=='Shaded paragraph.')
    for key,value in fixture['APPEARANCE'].items(): assert first['attrs'][key]==value,(key,first)
    second=next(n for n in blocks if document_text(n)=='Explicit removal.')
    assert second['attrs']['paragraphBorderWidth']==0 and second['attrs']['paragraphBackground']=='transparent',second
    print(json.dumps({'status':'passed','appearance':first['attrs']}))
