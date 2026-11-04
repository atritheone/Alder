import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path[:0]=[str(root/'backend'),str(root/'backend/tests')]
from test_tracked_item_moves import fixture
from alder.publishing import build_export
from alder.models import validate_project
directory=Path(sys.argv[1]).resolve();directory.mkdir(parents=True,exist_ok=True)
outline='--outline' in sys.argv
continued='--continued' in sys.argv
project=fixture(outline,True,continued)
if '--nested' in sys.argv or '--cell' in sys.argv:
    document=project['book']['chapters'][0]['document']
    content=[{'type':'paragraph','content':[{'type':'text','text':'Container'}]},*document['content']]
    document['content']=[{'type':'table','content':[{'type':'table_row','content':[{'type':'table_cell','content':content}]}]}] if '--cell' in sys.argv else [{'type':'bullet_list','content':[{'type':'list_item','content':content}]}]
    project=validate_project(project)
result=build_export(project,'docx',directory)
(directory/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
numbers={decision:{'First item':'3.' if outline else 'C.','Moved item':f'{n}.' if outline else 'E.' if n==5 else 'D.',
                   'Last item':f'{9-n}.' if outline else 'D.' if n==5 else 'E.',
                   'Nested first':f'{n}.1.' if outline else '1.','Nested last':f'{n}.2.' if outline else '2.',
                   'Continuation':'','After nested':''} for decision,n in [('accept',5),('reject',4)]}
if continued:
    for decision in numbers:numbers[decision]['Continued item']='6.' if outline else 'F.'
(directory/'fixture-exports.json').write_text(json.dumps({'docx':result,'reviewDecisions':True,'skipListNumbers':True,'reviewListNumbersByDecision':numbers,'expectedText':['First item','Last item']}),encoding='utf-8')
