"""Native Word qualification for a note starting with a multi-paragraph list."""
import json,runpy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.publishing import build_export,import_document
from alder.document_notes import notes
from alder.models import document_text
root=Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    fixture=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_list_item_boundaries.py'))['fixture']
    project,body=fixture('endnote' if '--endnote' in sys.argv else 'footnote','none')
    exported=build_export(project,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':exported,'expectedText':['Body'],'skipListNumbers':True}),encoding='utf-8')
else:
    project=json.loads((root/'fixture-project.json').read_text(encoding='utf-8'))
    before=notes([project['book']['chapters'][0]['document']])[0]['attrs']['body']
    actual=notes([import_document(root/'word-resaved.docx')['document']])[0]['attrs']['body']
    assert document_text(actual)==document_text(before)
    listing=actual['content'][0];assert listing['type']=='ordered_list' and listing['attrs']['order']==3
    assert len(listing['content'])==2 and len(listing['content'][0]['content'])==2
    attrs=listing['content'][0]['content'][1]['attrs'];assert attrs['fontSize']==15 and abs(attrs['leftIndent']-9)<.051 and attrs['firstLineIndent']==3
    print('Native note list boundaries, authored formatting and reference-only prefix passed.')
