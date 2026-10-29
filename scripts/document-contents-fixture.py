"""Qualify generated contents with Word's own field updater and resave."""
import json
import runpy
import sys
from pathlib import Path
source = runpy.run_path(str(Path(__file__).with_name('word-processing-fixture.py')))
fixture = runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_document_contents.py'))
from alder.publishing import build_export, import_document
from alder.models import document_text, validate_project
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    project=source['fixture']()
    project['styles'].append({'id':'contents-style','name':'Contents entries','kind':'paragraph','fontFamily':'Arial','fontSize':14,'color':'#283f60'})
    additions=fixture['caption_fixture']()['book']['chapters'][0]['document']['content']
    for node in additions:
        if node['type']=='table_of_contents':
            node['attrs']['entryStyle']='contents-style'
            node['attrs']['pageNumbers']=True
    project['book']['chapters'][0]['document']['content'].extend(additions)
    result=build_export(project,'docx',root)
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'contentsExpected':1,'figuresExpected':2}),encoding='utf-8')
else:
    opened=import_document(root/'word-resaved.docx')
    document=opened['document']
    (root/'reopened.json').write_text(json.dumps(opened,indent=2),encoding='utf-8')
    lists={n['attrs'].get('kind','headings'):n for n in document['content'] if n['type']=='table_of_contents'}
    toc=lists['headings']
    text=document_text(toc)
    assert 'First heading' in text and 'Child heading' in text and 'Deeper heading' not in text,text
    assert toc['attrs']['depth']==2
    assert toc['attrs']['pageNumbers'] is True
    for contents in lists.values():
        for entry in contents['content'][1:]:
            assert entry['attrs']['fontFamily']=='Arial' and entry['attrs']['fontSize']==14,entry
            assert any(c['type']=='cross_reference' for c in entry['content']),entry
            assert any(c['type']=='cross_reference' and c['attrs'].get('referenceFormat')=='page' and document_text(c).isdigit() for c in entry['content']),entry
    assert len(lists['figures']['content'])==3 and len(lists['tables']['content'])==2, lists
    assert 'Figure 2: Illustration 2' in document_text(lists['figures'])
    assert 'Table 1: Measurements' in document_text(lists['tables'])
    project=fixture['fixture']();project['book']['chapters'][0]['document']=document
    validate_project(project)
    print('Word updates, renders and resaves the generated contents block with its heading depth.')
