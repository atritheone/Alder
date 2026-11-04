"""Native Word qualification for complete inserted/deleted list items."""
import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path[:0]=[str(root/'backend'),str(root/'backend/tests')]
from test_tracked_list_items import fixture
from alder.publishing import build_export
from alder.models import validate_project

directory=Path(sys.argv[1]).resolve();directory.mkdir(parents=True,exist_ok=True)
kind='deletion' if '--delete' in sys.argv else 'insertion'
outline='--outline' in sys.argv;grouped='--grouped' in sys.argv;empty='--empty' in sys.argv
project=fixture(kind,outline,grouped,not empty)
if empty:project['book']['chapters'][0]['document']['content'][0]['content'][1]['content']=[{'type':'paragraph'}]
if '--cell' in sys.argv:
    document=project['book']['chapters'][0]['document']
    document['content']=[{'type':'table','content':[{'type':'table_row','content':[{'type':'table_cell','content':document['content']}]}]}]
project=validate_project(project)
result=build_export(project,'docx',directory)
(directory/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
numbers={}
for decision in ('accept','reject'):
    present=(decision=='accept')==(kind=='insertion');count=1+int(grouped)
    label=lambda n:f'{n}.' if outline else chr(64+n)+'.'
    values={'First item':label(3),'Last item':label(4+count*present),'Continued item':label(5+count*present)}
    if present and not empty:
        values.update({'Moved item':label(4),'Continuation':'','After nested':'','Nested first':'4.1.' if outline else '1.','Nested last':'4.2.' if outline else '2.'})
        if grouped:values['Second changed item']=label(5)
    numbers[decision]=values
(directory/'fixture-exports.json').write_text(json.dumps({'docx':result,'reviewDecisions':True,'skipListNumbers':True,'reviewListNumbersByDecision':numbers,'expectedText':['First item','Last item']}),encoding='utf-8')
