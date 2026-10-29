"""Qualify revision runs in native Word before enabling editor tracking."""
import json
import runpy
import sys
from pathlib import Path
from zipfile import ZipFile
from lxml import etree
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend/tests'))
source = runpy.run_path(str(Path(__file__).with_name('word-processing-fixture.py')))
revision = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'backend/tests/test_document_revisions.py'))
formatting = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'backend/tests/test_revision_formatting.py'))
paragraph_formatting = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'backend/tests/test_paragraph_revisions.py'))
from alder.document_revisions import WordRevisionWriter, WordRevisionReader, W
from alder.publishing import build_export
from docx import Document
root = Path(sys.argv[1]).resolve(); root.mkdir(parents=True, exist_ok=True)
if '--check' not in sys.argv:
    project = source['fixture']()
    body = project['book']['chapters'][0]['document']['content']
    body.extend(revision['project_fixture']()['book']['chapters'][0]['document']['content'])
    node = revision['fixture']()['content'][0]['content'][1]
    node['marks'].append({'type': 'revision_deletion', 'attrs': {'id': 'change_nested', 'author': 'Second reviewer', 'date': '2026-10-29T02:00:00Z'}})
    body.append({'type': 'paragraph', 'content': [node]})
    body.extend(paragraph_formatting['project_fixture']()['book']['chapters'][0]['document']['content'])
    result = build_export(project, 'docx', root)
    (root / 'fixture-exports.json').write_text(json.dumps({'docx': result}), encoding='utf-8')
else:
    with ZipFile(root / 'word-resaved.docx') as archive:
        xml = etree.fromstring(archive.read('word/document.xml'))
    reader = WordRevisionReader(xml)
    changes = [node for node in xml.iter() if node.tag in (f'{{{W}}}ins', f'{{{W}}}del') and node.getparent().tag != f'{{{W}}}rPr']
    assert len(changes) == 4, [etree.tostring(n).decode() for n in changes]
    assert sum(reader.mark(node)['type'] == 'revision_deletion' for node in changes) == 2
    assert {reader.mark(node)['attrs']['author'] for node in changes} == {'Reviewer', 'Second reviewer'}
    deleted = [node.text for node in xml.iter(f'{{{W}}}delText')]
    assert deleted == ['Old', 'New'], deleted
    old = next(node for node in changes if node.tag == f'{{{W}}}del')
    assert old.find(f'.//{{{W}}}b') is not None
    breaks = [change for p in xml.iter(f'{{{W}}}p') if (change := reader.paragraph_break(p))]
    assert [change['kind'] for change in breaks] == ['deletion', 'insertion'], breaks
    assert all(change['stamp']['author'] == 'Structure reviewer' for change in breaks)
    formats = [revision for properties in xml.iter(f'{{{W}}}rPr') if (revision := reader.formatting(properties))]
    assert len(formats) == 1
    assert formats[0]['attrs']['base'] == [{'type': 'em'}], formats
    assert formats[0]['attrs']['records'][0]['stamp']['author'] == 'Format reviewer'
    assert formats[0]['attrs']['records'][0]['patches'] == [{'type': 'strong', 'before': None, 'after': {}}], formats
    from alder.publishing import import_document
    from alder.document_revisions import review_document
    from alder.models import document_text
    exported = json.loads((root / 'fixture-exports.json').read_text(encoding='utf-8'))
    original = import_document(Path(exported['docx']['path']))['document']
    returned = import_document(root / 'word-resaved.docx')['document']
    for view in ('final', 'original'):
        assert document_text(review_document(original, view)) == document_text(review_document(returned, view)), view
        for doc in (original, returned):
            p = next(n for n in review_document(doc, view)['content'] if document_text(n) == 'Reviewed paragraph')
            assert p['attrs'].get('align', 'left') == ('left' if view == 'original' else 'center'), p
    paragraphs = [n for n in returned['content'] if n.get('attrs', {}).get('revisionProperties')]
    assert len(paragraphs) == 1 and paragraphs[0]['attrs']['revisionProperties']['records'][0]['stamp']['author'] == 'Paragraph reviewer'
    print(json.dumps({'status': 'passed', 'revisions': len(changes), 'authors': 2, 'deletedTextRetained': True, 'paragraphRevisions': len(breaks), 'formattingRevisions': len(formats), 'paragraphFormattingRevisions': len(paragraphs)}))
