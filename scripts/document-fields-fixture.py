"""Native Word date and document-property update/render/resave qualification."""
import json
import runpy
import sys
from datetime import date
from pathlib import Path
source=runpy.run_path(str(Path(__file__).with_name('word-processing-fixture.py')))
fields=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_document_fields.py'))
from alder.publishing import build_export,import_document
from alder.models import document_text
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    project=source['fixture']();project['settings'].update(author='A. Writer',subject='Test subject')
    project['book']['chapters'][0]['document']['content'].extend(fields['fixture']()['book']['chapters'][0]['document']['content'])
    project['book']['chapters'][0]['document']['content'].extend([{'type':'paragraph','content':[{'type':'document_field','attrs':{'fieldKind':kind},'content':[{'type':'text','text':'99'}]}]} for kind in ('page','pageCount')])
    result=build_export(project,'docx',root)
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result}),encoding='utf-8')
else:
    opened=import_document(root/'word-resaved.docx')
    found=[n for n in fields['walk'](opened['document']) if n['type']=='document_field']
    assert [document_text(n) for n in found[:4]]==['Alder word-processing fixture','A. Writer','Test subject',date.today().isoformat()],found
    assert all({'type':'strong'} in n.get('marks',[]) for n in found[:4])
    pages=json.loads((root/'word-report.json').read_text(encoding='utf-8-sig'))['pages']
    assert [(n['attrs']['fieldKind'],document_text(n)) for n in found[4:]]==[('page',str(pages)),('pageCount',str(pages))],found
    print(json.dumps({'status':'passed','fields':len(found)}))
