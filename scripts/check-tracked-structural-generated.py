"""Check generated objects in native Word list/table move outcomes."""
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from alder.publishing import import_document
from alder.document_revisions import review_document, revision_summary
from alder.document_references import reference_values
from alder.document_index import entries
from alder.models import document_text
from alder.tracked_block_moves import identity_nodes

root = Path(sys.argv[1])
source = json.loads((root / 'fixture-project.json').read_text(encoding='utf-8'))['book']['chapters'][0]['document']
pending = import_document(root / 'word-resaved.docx')['document']
assert len(revision_summary(pending)) == 1


def wording(document):
    result = copy.deepcopy(document)
    for node in identity_nodes(result):
        if node['type'] in ('sequence', 'cross_reference'):
            node['content'] = []
    return document_text(result)


for decision, view in [('accept', 'final'), ('reject', 'original')]:
    reviewed = import_document(root / f'word-{decision}.docx')['document']
    assert not revision_summary(reviewed)
    expected = review_document(source, view)
    for actual in (reviewed, review_document(pending, view)):
        assert wording(actual) == wording(expected)
        assert [n['type'] for n in actual['content']] == [n['type'] for n in expected['content']]
        refs = [n for n in identity_nodes(actual) if n['type'] == 'cross_reference']
        assert len(refs) == 1 and reference_values([actual])[refs[0]['attrs']['targetId']] == 'Conclusion'
        index = entries([actual])
        assert len(index) == 1 and index[0]['terms'] == ['Trees', 'Alder']
        assert index[0]['sortTerms'] == ['', 'Alnus'] and index[0]['indexGroup'] == 'P'
        sequences = [n for n in identity_nodes(actual) if n['type'] == 'sequence']
        assert len(sequences) == 2 and all(n['attrs']['sequenceName'] == 'Figure' and document_text(n).isdigit() for n in sequences)
        citations = [n for n in identity_nodes(actual) if n['type'] == 'citation']
        expected_citations = [n for n in identity_nodes(expected) if n['type'] == 'citation']
        assert len(citations) == 2
        assert [n['attrs']['items'] for n in citations] == [n['attrs']['items'] for n in expected_citations]
print('Structural references, indexes, sequences and citation sources survive both native Word review decisions.')
