from pathlib import Path
import json
import sys
root = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(root / 'backend'), str(root / 'backend/tests')]
from test_tracked_comment_moves import fixture, commented_rows
from alder.publishing import build_export

directory = Path(sys.argv[1]).resolve(); directory.mkdir(parents=True, exist_ok=True)
kind = sys.argv[2] if len(sys.argv) > 2 else 'table'
rows = kind in ('row-insertion', 'row-deletion')
project = commented_rows(kind.removeprefix('row-'), '--group' in sys.argv) if rows else fixture(kind)
exported = build_export(project, 'docx', directory)
(directory / 'fixture-project.json').write_text(json.dumps(project), encoding='utf-8')
(directory / 'fixture-exports.json').write_text(json.dumps({'docx': exported, **({'reviewDecisions': True} if rows else {'movesExpected': 1}), 'skipListNumbers': True,
    'expectedText': ['First left' if rows else 'Merged header' if kind == 'table' else 'First item']}), encoding='utf-8')
