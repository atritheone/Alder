"""Range-bookmark exchange with installed Word, across paragraph boundaries."""
import json
import runpy
import sys
from pathlib import Path
source=runpy.run_path(str(Path(__file__).with_name('word-processing-fixture.py')))
from alder.publishing import build_export, import_document
fixture=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_document_bookmarks.py'))
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    project=source['fixture']()
    project['book']['chapters'][0]['document']['content'].extend(fixture['range_fixture']()['book']['chapters'][0]['document']['content'])
    result=build_export(project,'docx',root)
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result}),encoding='utf-8')
else:
    result=import_document(root/'word-resaved.docx')
    nodes=result['document']['content'][-2:]
    start=nodes[0]['content'][1];end=nodes[1]['content'][1]
    assert start['type']=='bookmark' and start['attrs']['range'],start
    assert end['type']=='bookmark_end' and end['attrs']['targetId']==start['attrs']['blockId'],end
    assert nodes[0]['content'][2]['text']=='First passage.'
    assert nodes[1]['content'][0]['text']=='Last passage.'
    print(json.dumps({'status':'passed','name':start['attrs']['name'],'range':True}))
