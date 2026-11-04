"""Qualify native table moves; optionally observe Word's independent comparison."""
import copy, json, runpy, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.publishing import build_export, import_document
from alder.document_revisions import review_document, revision_summary
from alder.models import document_text
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    fixtures=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_tracked_table_moves.py'))
    p=fixtures['nested_fixture']('--nested-last' in sys.argv) if '--nested' in sys.argv or '--nested-last' in sys.argv else fixtures['fixture']()
    if '--rowspan' in sys.argv:p=fixtures['rowspan_fixture']()
    doc=p['book']['chapters'][0]['document']
    doc['content'][3]['content'][0]['text']='Other section. '+ 'This stationary material remains in the same position relative to the surrounding body text. '*45
    outputs={}
    if '--alone' in sys.argv:
        doc['content']=[n for n in doc['content'] if n['type']=='table' or not n.get('attrs',{}).get('revisionMove')]
        for n in doc['content']:
            if n['type']=='table':n['attrs']['revisionMove'].update(part=0,count=1)
    if '--compare' in sys.argv:
        for view in ('original','final'):
            clean=copy.deepcopy(p);clean['book']['chapters'][0]['document']=review_document(doc,view)
            outputs[view]=build_export(clean,'docx',root/view)
        options={'docx':outputs['original'],'compareWith':outputs['final']['path'],'reviewDecisions':True}
    else:options={'docx':build_export(p,'docx',root),'movesExpected':1}
    (root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({**options,'skipListNumbers':True,'expectedText':['Merged header','Left cell','Right cell','Other section']}),encoding='utf-8')
else:
    source=json.loads((root/'fixture-project.json').read_text(encoding='utf-8'))['book']['chapters'][0]['document']
    pending=None
    if '--compare' not in sys.argv:
        pending=import_document(root/'word-resaved.docx')['document']
        assert len(revision_summary(pending))==1
    for decision,view in [('accept','final'),('reject','original')]:
        restored=import_document(root/f'word-{decision}.docx')['document']
        for doc in ([review_document(pending,view)] if pending else [])+[restored]:
            assert document_text(doc)==document_text(review_document(source,view))
            tables=[n for n in doc['content'] if n['type']=='table'];assert len(tables)==1
            table=tables[0];assert table['content'][0]['content'][0]['attrs']['colspan']==2
            assert table['content'][0]['content'][0]['attrs']['background'].lower()=='#ddeeff'
            assert table['content'][1]['content'][0]['attrs']['verticalAlign']=='bottom'
            if '--rowspan' in sys.argv:
                assert table['content'][1]['content'][0]['attrs']['rowspan']==2
                assert len(table['content'][2]['content'])==1
            if '--nested' in sys.argv or '--nested-last' in sys.argv:
                contents=table['content'][1]['content'][1]['content'];assert len(contents)==2
                nested=contents[-1 if '--nested-last' in sys.argv else 0]
                assert nested['type']=='table' and nested['attrs']['align']=='right'
                assert document_text(nested)=='Nested first\tNested last'
            if '--alone' not in sys.argv:
                caption=next(n for n in doc['content'] if n.get('attrs',{}).get('captionLabel'))
                assert caption['attrs']['captionTargetId']==table['attrs']['blockId']
    print('Native table review retains both documents, grid, appearance and captions.')
