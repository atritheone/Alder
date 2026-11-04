"""Check measured structural form fields/text boxes after native Word review."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from alder.publishing import import_document
from alder.document_revisions import review_document, revision_summary
from alder.models import document_text
from alder.tracked_block_moves import identity_nodes

root = Path(sys.argv[1])
source = json.loads((root / 'fixture-project.json').read_text(encoding='utf-8'))['book']['chapters'][0]['document']
exported = import_document(root / 'alder.docx')['document']
pending = import_document(root / 'word-resaved.docx')['document']
assert len(revision_summary(pending)) == 1
for decision, view in [('accept', 'final'), ('reject', 'original')]:
    reviewed = import_document(root / f'word-{decision}.docx')['document']
    assert not revision_summary(reviewed)
    expected = review_document(source, view)
    measured = next(n for n in identity_nodes(review_document(exported, view)) if n['type'] == 'text_box')
    for actual in (reviewed, review_document(pending, view)):
        assert document_text(actual) == document_text(expected)
        assert [n['type'] for n in actual['content']] == [n['type'] for n in expected['content']]
        fields = [n for n in identity_nodes(actual) if n['type'] == 'form_field']
        assert [n['attrs']['kind'] for n in fields] == ['plain', 'rich', 'checkbox', 'date']
        for node in fields:
            a = node['attrs']
            assert a['label'] == 'Moved ' + a['kind'] and a['tag'] == 'tag_' + a['kind']
            assert a['lockContent'] and a['lockDelete']
        assert fields[2]['attrs']['checked'] and fields[3]['attrs']['dateValue'] == '2026-11-04'
        boxes = [n for n in identity_nodes(actual) if n['type'] == 'text_box']
        assert len(boxes) == 1
        for dimension in ('width', 'minHeight'):
            assert abs(boxes[0]['attrs'][dimension] - measured['attrs'][dimension]) < .1
        assert boxes[0]['attrs']['fill'].lower() == '#c9d8e8'
        for node in (fields[1], boxes[0]):
            assert any(m['type'] == 'strong' for m in node['content'][0]['marks'])
            assert any(m['type'] == 'em' for m in node['content'][-1]['marks'])
print('Structural controls and text boxes retain wording, definitions and both native Word review outcomes.')
