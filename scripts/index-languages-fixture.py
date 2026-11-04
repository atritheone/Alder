"""Check actual Word locale sorting, not just Alder's regenerated index."""
import json, runpy, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from alder.publishing import build_export, import_document
from alder.document_index import entries
from alder.models import document_text
root = Path(sys.argv[1]).resolve(); root.mkdir(parents=True, exist_ok=True)
if '--check' not in sys.argv:
    p = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'backend/tests/test_index_collation.py'))['fixture']()
    result = build_export(p, 'docx', root)
    (root / 'fixture-project.json').write_text(json.dumps(p), encoding='utf-8')
    (root / 'fixture-exports.json').write_text(json.dumps({'docx': result, 'indexesExpected': 2, 'skipListNumbers': True, 'expectedText': ['The source remains unchanged.']}), encoding='utf-8')
else:
    from docx import Document
    from docx.oxml.ns import qn
    word = Document(root / 'word-resaved.docx')
    native = [[''.join(p.itertext(qn('w:t'))) for p in sdt.find(qn('w:sdtContent')) if p.tag == qn('w:p')]
              for sdt in word._element.body if sdt.tag == qn('w:sdt')]
    native = [[text for text in paragraphs if text] for paragraphs in native]
    expected = [['sv-SE', 'Aachen, 1', 'Places', 'Zebra, 1', 'Åland, 1', 'Örebro, 1', 'Zebra, 1', 'Åland, 1', 'Älmhult, 1', 'Örebro, 1'],
                ['en-US', 'Aachen, 1', 'Åland, 1', 'Älmhult, 1', 'Örebro, 1', 'Places', 'Åland, 1', 'Örebro, 1', 'Zebra, 1', 'Zebra, 1']]
    assert native == expected, native
    restored = import_document(root / 'word-resaved.docx')
    indexes = [n for n in restored['document']['content'] if n['type'] == 'table_of_contents']
    assert len(entries([restored['document']])) == 8
    assert [n['attrs']['indexLanguage'].lower() for n in indexes] == ['sv-se', 'en-us']
    assert [document_text(n).splitlines() for n in indexes] == expected
    print(json.dumps({'status': 'passed', 'nativeIndexes': native, 'warnings': restored['warnings']}))
