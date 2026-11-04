"""Check desktop page fields through Word's native tracked structural moves."""
import copy
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
pending = import_document(root / 'word-resaved.docx')['document']
assert len(revision_summary(pending)) == 1


def wording(document):
    result = copy.deepcopy(document)
    for node in identity_nodes(result):
        if node['type'] == 'document_field':
            node['content'] = []  # Word may refresh cached PAGE values when laying out review markup.
    return document_text(result)


def structure(node):
    return (node['type'], [structure(child) for child in node.get('content', []) if child['type'] != 'text'])


for decision, view in [('accept', 'final'), ('reject', 'original')]:
    reviewed = import_document(root / f'word-{decision}.docx')['document']
    assert not revision_summary(reviewed)
    expected = review_document(source, view)
    for actual in (reviewed, review_document(pending, view)):
        assert wording(actual) == wording(expected)
        assert structure(actual) == structure(expected)
        fields = [n for n in identity_nodes(actual) if n['type'] == 'document_field']
        assert len(fields) == 1
        assert fields[0]['attrs']['fieldKind'] == 'page'
        assert document_text(fields[0]).isdigit()
print('Structural page fields retain native definitions, containers and both Word review outcomes.')
