import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(root/'backend'),str(root/'backend/tests')]
from test_tracked_row_moves import fixture
from alder.publishing import build_export
directory=Path(sys.argv[1]).resolve();directory.mkdir(parents=True,exist_ok=True)
project=fixture('--merged' in sys.argv,'--nested' in sys.argv,'--comments' in sys.argv,'--inside' in sys.argv)
result=build_export(project,'docx',directory)
(directory/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
(directory/'fixture-exports.json').write_text(json.dumps({'docx':result,'reviewDecisions':True,'skipListNumbers':True,'expectedText':['First left','Last left']}),encoding='utf-8')
