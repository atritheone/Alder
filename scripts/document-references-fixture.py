"""Qualify native REF fields and their cached results with installed Word."""
import json
import runpy
import sys
from pathlib import Path
source = runpy.run_path(str(Path(__file__).with_name('word-processing-fixture.py')))
fixture = runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_document_references.py'))
from alder.publishing import build_export, import_document
from alder.models import validate_project, document_text
from alder.document_references import reference_values
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    project=source['fixture']()
    project['book']['chapters'][0]['document']['content'].extend(fixture['fixture']()['book']['chapters'][0]['document']['content'])
    result=build_export(project,'docx',root)
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result}),encoding='utf-8')
else:
    opened=import_document(root/'word-resaved.docx')
    project=fixture['fixture']();project['book']['chapters'][0]['document']=opened['document'];project=validate_project(project)
    document=project['book']['chapters'][0]['document'];values=reference_values([document])
    fields=[n for n in fixture['walk'](document) if n['type']=='cross_reference']
    assert len(fields)==2, fields
    assert [document_text(field).strip() for field in fields]==['Current heading','Current passage'],fields
    assert [values[field['attrs']['targetId']] for field in fields]==['Current heading','Current passage']
    print(json.dumps({'status':'passed','fields':len(fields),'wording':[document_text(field) for field in fields]}))
