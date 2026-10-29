"""Native Word sequence fields, caption text and cross-reference exchange."""
import json
import runpy
import sys
from pathlib import Path
source=runpy.run_path(str(Path(__file__).with_name('word-processing-fixture.py')))
fixture=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_document_captions.py'))
from alder.publishing import build_export, import_document
from alder.models import document_text
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    project=source['fixture']();project['book']['chapters'][0]['document']['content'].extend(fixture['fixture']()['book']['chapters'][0]['document']['content'])
    for display in ('labelNumber','number'):
        project['book']['chapters'][0]['document']['content'][-1]['content'].extend([{'type':'text','text':' / '},{'type':'cross_reference','attrs':{'targetId':'caption-second','referenceFormat':display},'content':[{'type':'text','text':'Old'}]}])
    result=build_export(project,'docx',root)
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result}),encoding='utf-8')
else:
    opened=import_document(root/'word-resaved.docx')
    captions=[n for n in fixture['walk'](opened['document']) if n.get('attrs',{}).get('captionLabel')]
    assert [document_text(n) for n in captions]==['Table 1: Measurements','Table 2: Comparisons'],captions
    assert all(n['attrs'].get('captionTargetId') for n in captions)
    fields=[n for n in fixture['walk'](opened['document']) if n['type']=='cross_reference']
    assert [document_text(n).strip() for n in fields]==['Table 2: Comparisons','Table 2','2'],fields
    assert [n['attrs'].get('referenceFormat','text') for n in fields]==['text','labelNumber','number'],fields
    print(json.dumps({'status':'passed','captions':len(captions),'references':len(fields)}))
