"""Decorative-image extension round trip through installed Word."""
import json,runpy,sys
from pathlib import Path
source=runpy.run_path(str(Path(__file__).with_name('word-processing-fixture.py')))
from alder.publishing import build_export,import_document
fixture=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_image_accessibility.py'))
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    project=source['fixture']();project['book']['chapters'][0]['document']['content'].append(fixture['fixture']()['book']['chapters'][0]['document']['content'][0])
    result=build_export(project,'docx',root);(root/'fixture-exports.json').write_text(json.dumps({'docx':result}),encoding='utf-8')
else:
    result=import_document(root/'word-resaved.docx')
    images=[n for n in result['document']['content'] if n['type']=='image']
    assert len(images)==1 and images[0]['attrs'].get('decorative'),images
    print(json.dumps(images[0]['attrs']))
