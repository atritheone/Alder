"""Native review of comparisons containing nested lists/tables and comments."""
import json,sys
from pathlib import Path
from copy import deepcopy
root=Path(__file__).resolve().parents[1];sys.path[:0]=[str(root/'backend'),str(root/'backend/tests')]
from test_structured_comparison import inputs,boundary_inputs,commented_move_inputs,listing,table,doc,project_fixture,DATE
from alder.document_comparison import compare_documents
from alder.document_revisions import review_document,revision_summary
from alder.models import validate_project,document_text
from alder.publishing import build_export
from alder.document_comments import walk
from test_outline_lists import labels as outline_labels

directory=Path(sys.argv[1]).resolve();directory.mkdir(parents=True,exist_ok=True)
if '--moves' in sys.argv:
    anchor=[{'type':'paragraph','content':[{'type':'text','text':'Anchor '+str(i)}]} for i in range(4)]
    old=doc(listing(),table(),*anchor);new=doc(*deepcopy(anchor),listing(),table())
elif '--boundaries' in sys.argv:old,new=boundary_inputs('combined')
elif '--list-tables' in sys.argv:
    from test_list_item_objects import fixture as list_tables_fixture
    source=list_tables_fixture('review',True)['book']['chapters'][0]['document']
    old,new=[doc('Anchor list tables',*review_document(source,view)['content']) for view in ('original','final')]
elif '--list-format' in sys.argv or '--continued-list-format' in sys.argv or '--outline-list-format' in sys.argv or '--continued-outline-format' in sys.argv or '--outline-paragraphs' in sys.argv:
    from test_list_revisions import fixture as list_fixture
    if '--continued-list-format' in sys.argv:
        from test_list_revisions import continuation_fixture as list_fixture
    if '--outline-list-format' in sys.argv:
        from test_outline_revisions import fixture as list_fixture
    if '--continued-outline-format' in sys.argv:
        from test_outline_revisions import continuation_fixture as list_fixture
    if '--outline-paragraphs' in sys.argv:
        from test_outline_revisions import paragraph_fixture as list_fixture
    source=list_fixture()['book']['chapters'][0]['document']
    old,new=[doc('Anchor lists',*review_document(source,view)['content']) for view in ('original','final')]
elif '--cells' in sys.argv or '--table-format' in sys.argv:
    from test_cell_revisions import fixture as cell_fixture
    if '--table-format' in sys.argv:
        from test_table_revisions import fixture as cell_fixture
    source=cell_fixture()['book']['chapters'][0]['document']
    old,new=[doc('Anchor cells',*review_document(source,view)['content']) for view in ('original','final')]
elif '--items' in sys.argv:
    pairs=[boundary_inputs(kind) for kind in ('item-insert','item-delete')]
    for index,pair in enumerate(pairs):
        for document in pair:
            for node in walk(document):
                if node['type']=='text':node['text']=('Insertion ' if index==0 else 'Deletion ')+node['text']
    old,new=[doc(*[node for pair in pairs for node in pair[side]['content']]) for side in (0,1)]
elif '--comments' in sys.argv:old,new=commented_move_inputs(sys.argv[sys.argv.index('--comments')+1])
else:old,new=inputs()
project=project_fixture('Structured comparison',[])
project['book']['chapters'][0]['document']=compare_documents(old,new,'Reviewer',DATE);project=validate_project(project)
source=project['book']['chapters'][0]['document']
result=build_export(project,'docx',directory)
(directory/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
(directory/'fixture-inputs.json').write_text(json.dumps({'original':old,'revised':new,'changes':len(revision_summary(source)),
    'numberLabels':{view:outline_labels(review_document(source,view)) for view in ('original','final')},
    'comments':len({n['attrs']['threadId'] for n in walk(source) if n['type']=='comment_anchor'}),
    'text':{view:document_text(review_document(source,view)) for view in ('original','final')}}),encoding='utf-8')
(directory/'fixture-exports.json').write_text(json.dumps({'docx':result,'reviewDecisions':True,'skipListNumbers':True,'expectedText':['Anchor']}),encoding='utf-8')
