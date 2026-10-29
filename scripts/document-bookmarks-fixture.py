"""Named destination exchange with installed Word."""
import json,runpy,sys
from pathlib import Path
source=runpy.run_path(str(Path(__file__).with_name('word-processing-fixture.py')))
from alder.publishing import build_export,import_document
from alder.models import document_text
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    project=source['fixture']()
    project['book']['chapters'][0]['document']['content'].append({'type':'paragraph','content':[{'type':'text','text':'Before target '},{'type':'bookmark','attrs':{'name':'AlderTarget','blockId':'native-word-target'}},{'type':'text','text':'after target.'}]})
    project['book']['chapters'][0]['document']['content'].append({'type':'paragraph','content':[{'type':'text','text':'Return to target.','marks':[{'type':'link','attrs':{'href':'#native-word-target'}}]}]})
    result=build_export(project,'docx',root);(root/'fixture-exports.json').write_text(json.dumps({'docx':result}),encoding='utf-8')
else:
    result=import_document(root/'word-resaved.docx')
    paragraph=next(n for n in result['document']['content'] if document_text(n)=='Before target after target.')
    marker=next(n for n in paragraph['content'] if n['type']=='bookmark')
    assert marker['attrs']['name']=='AlderTarget',marker
    assert paragraph['content'][0]['text']=='Before target '
    link=next(n for n in result['document']['content'] if document_text(n)=='Return to target.')['content'][0]
    assert next(m for m in link['marks'] if m['type']=='link')['attrs']['href']=='#AlderTarget'
    print(json.dumps({'status':'passed','bookmark':marker['attrs'],'internalLink':'#AlderTarget'}))
