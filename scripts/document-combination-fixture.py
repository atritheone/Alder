"""Native Word and desktop fixture for two independent manuscript reviews."""
import json,sys
from copy import deepcopy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import create_project,validate_project,document_text
from alder.document_comparison import compare_documents
from alder.document_combination import combine_documents
from alder.document_revisions import review_document,revision_summary
from alder.document_comments import walk
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    def doc(*values):return {'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':v}]} for v in values]}
    base=doc('Moved paragraph.','First paragraph.','Disputed wording.','Last paragraph.')
    a=compare_documents(base,doc('Moved paragraph.','First Alice paragraph.','Alice wording.','Last paragraph.'),'Alice','2026-11-03T01:00:00Z')
    moved=deepcopy(a['content'][0]);identity=moved['attrs']['blockId'];stamp={'id':'move_alice','author':'Alice','date':'2026-11-03T01:00:00Z','move':True}
    a['content'][0]['attrs'].update(blockId='ghost_alice',revisionMove={'kind':'deletion','stamp':stamp.copy(),'originalId':identity})
    moved['attrs']['revisionMove']={'kind':'insertion','stamp':stamp.copy(),'originalId':identity};a['content'].append(moved)
    b=compare_documents(base,doc('Moved paragraph.','First paragraph.','Bob wording.','Last Bob paragraph.'),'Bob','2026-11-03T02:00:00Z')
    inputs=[]
    for name,body in [('Alice review',a),('Bob review',b)]:
        p=create_project(name,'blank');p['settings'].update(documentKind='docx',includeTitle=False)
        p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':body}]};inputs.append(validate_project(p))
    preview=combine_documents(a,b);assert len(preview['conflicts'])==1
    result=combine_documents(a,b,{preview['conflicts'][0]['id']:'revised'})['document']
    p=create_project('Combined review','blank');p['settings'].update(documentKind='docx',includeTitle=False)
    p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':result}]};p=validate_project(p)
    (root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8');(root/'fixture-inputs.json').write_text(json.dumps(inputs),encoding='utf-8')
    exported=build_export(p,'docx',root)
    (root/'fixture-exports.json').write_text(json.dumps({'docx':exported,'reviewDecisions':True,'movesExpected':1,'skipListNumbers':True,'expectedText':['Moved paragraph.']}),encoding='utf-8')
else:
    source=json.loads((root/'fixture-project.json').read_text(encoding='utf-8'))['book']['chapters'][0]['document']
    restored=import_document(root/'word-resaved.docx')['document']
    assert {c['author'] for c in revision_summary(restored)}=={'Alice','Bob'}
    assert {c['date'] for c in revision_summary(restored)}=={'2026-11-03T01:00:00Z','2026-11-03T02:00:00Z'}
    for decision,view in [('accept','final'),('reject','original')]:
        expected=review_document(source,view);actual=review_document(restored,view)
        assert document_text(actual)==document_text(expected)
        assert len(actual['content'])==len(expected['content'])
        decided=import_document(root/f'word-{decision}.docx')['document']
        assert not revision_summary(decided) and document_text(decided)==document_text(expected)
    print(json.dumps({'status':'passed','nativeCombinedReview':True,'authorsAndDates':True,'acceptAndReject':True}))
