"""Word exchange qualification for live separated-list continuation."""
import json, runpy, sys
from pathlib import Path
source=runpy.run_path(str(Path(__file__).with_name('word-processing-fixture.py')))
from alder.publishing import build_export,import_document
from alder.list_formatting import resolve_list_orders
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    project=source['fixture']();doc=project['book']['chapters'][0]['document']
    for text,attrs in [('CONTINUE_FIRST',{'order':11}),('CONTINUE_SECOND',{'continuePrevious':True}),('CONTINUE_RESTART',{'order':3}),('CONTINUE_AFTER',{'continuePrevious':True})]:
        doc['content'].append(source['paragraph']('Intervening prose'))
        doc['content'].append({'type':'ordered_list','attrs':attrs,'content':[{'type':'list_item','content':[source['paragraph'](text)]}]})
    resolve_list_orders(doc)
    result=build_export(project,'docx',root)
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result}),encoding='utf-8')
else:
    doc=import_document(root/'word-resaved.docx')['document']
    lists=[n for n in doc['content'] if n['type']=='ordered_list' and 'CONTINUE_' in json.dumps(n)]
    assert [n['attrs']['order'] for n in lists]==[11,12,3,4],lists
    assert [n['attrs'].get('continuePrevious',False) for n in lists]==[False,True,False,True],lists
    print('Word retained continuation and restart semantics across separated lists.')
