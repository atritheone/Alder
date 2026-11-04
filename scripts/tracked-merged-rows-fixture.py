import json
import sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(root/'backend'),str(root/'backend/tests')]
from test_tracked_table_rows import merged_fixture
from alder.publishing import build_export

directory=Path(sys.argv[1]).resolve();directory.mkdir(parents=True,exist_ok=True)
project=merged_fixture('insertion' if '--insert' in sys.argv else 'deletion')
result=build_export(project,'docx',directory)
(directory/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
(directory/'fixture-exports.json').write_text(json.dumps({'docx':result,'reviewDecisions':True,'skipListNumbers':True,'expectedText':['First left','Last left']}),encoding='utf-8')
