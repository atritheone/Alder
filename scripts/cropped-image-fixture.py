"""Native Word must retain the crop as well as the complete original raster."""
import json
import runpy
import sys
from pathlib import Path

source = runpy.run_path(str(Path(__file__).with_name('word-processing-fixture.py')))
from alder.publishing import build_export, import_document
fixture = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'backend/tests/test_image_crop.py'))
root = Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=True)
if '--check' not in sys.argv:
    project = source['fixture']()
    cropped = fixture['fixture']()
    project['assets'].extend(cropped['assets'])
    project['book']['chapters'][0]['document']['content'].extend(cropped['book']['chapters'][0]['document']['content'])
    results = {kind: build_export(project, kind, root) for kind in ('docx', 'pdf')}
    (root / 'fixture-exports.json').write_text(json.dumps(results), encoding='utf-8')
else:
    import base64
    import io
    from PIL import Image
    result = import_document(root / 'word-resaved.docx')
    picture = result['document']['content'][-1]['content'][1]
    assert picture['type'] == 'inline_image' and picture['attrs']['crop'] == fixture['CROP'], picture
    asset = next(a for a in result['assets'] if a['id'] == picture['attrs']['assetId'])
    assert Image.open(io.BytesIO(base64.b64decode(asset['data']))).size == (120,60)
    print(json.dumps({'status':'passed','crop':picture['attrs']['crop']}))
