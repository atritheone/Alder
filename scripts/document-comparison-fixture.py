"""Qualify comparison revisions through native Word review and resaving."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import create_project,validate_project,document_text
from alder.document_comparison import compare_documents
from alder.document_revisions import review_document,revision_summary
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    def p(text,**attrs):return {'type':'paragraph','attrs':attrs,'content':[{'type':'text','text':text}]}
    old={'type':'doc','content':[p('Deleted paragraph.'),p('Anchor one.'),p('Old wording.',align='left'),p('Anchor two.')]}
    new={'type':'doc','content':[p('Anchor one.'),p('New wording.',align='right'),p('Anchor two.'),p('Inserted paragraph.')]}
    if '--comments' in sys.argv:
        def annotate(paragraph,identity,message):
            thread={'resolved':False,'entries':[{'id':'entry_'+identity,'author':'Reader','text':message,'date':'2026-11-03T00:00:00Z'}]}
            anchor=lambda edge:{'type':'comment_anchor','attrs':{'threadId':identity,'edge':edge,'thread':thread}}
            paragraph['content']=[anchor('start'),*paragraph['content'],anchor('end')]
        annotate(old['content'][0],'removed','Comment on removed paragraph.')
        annotate(old['content'][2],'wording','Original wording comment.')
        annotate(new['content'][1],'wording','Revised wording comment.')
        annotate(new['content'][-1],'added','Comment on added paragraph.')
    project=create_project('Comparison','blank');project['settings'].update(documentKind='docx',includeTitle=False)
    reviewed=compare_documents(old,new,'Reviewer','2026-11-03T00:00:00Z')
    project['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':reviewed}]};project=validate_project(project)
    (root/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
    result=build_export(project,'docx',root)
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'reviewDecisions':True,'skipListNumbers':True,'expectedText':['Anchor one.','Anchor two.']}),encoding='utf-8')
else:
    source=json.loads((root/'fixture-project.json').read_text(encoding='utf-8'))['book']['chapters'][0]['document']
    restored=import_document(root/'word-resaved.docx')['document']
    assert revision_summary(restored)
    if '--comments' in sys.argv:
        from alder.document_comments import walk
        messages=lambda doc:sorted({e['text'] for n in walk(doc) if n['type']=='comment_anchor' for e in n['attrs']['thread']['entries']})
        assert messages(restored)==messages(source),(messages(restored),messages(source))
    for decision,view in [('accept','final'),('reject','original')]:
        expected=review_document(source,view);actual=review_document(restored,view)
        assert document_text(actual)==document_text(expected),(view,actual,expected)
        assert len(actual['content'])==len(expected['content'])
        decided=import_document(root/f'word-{decision}.docx')['document']
        assert not revision_summary(decided) and document_text(decided)==document_text(expected),(decision,decided)
        assert len(decided['content'])==len(expected['content'])
    print(json.dumps({'status':'passed','nativeWordReview':True,'acceptAndReject':True}))
