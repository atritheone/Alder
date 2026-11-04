"""Compare actual Word comment anchors/threads after resave and both decisions."""
from pathlib import Path
import json
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from alder.document_comments import walk
from alder.document_revisions import review_document
from alder.publishing import import_document


def comments(document):
    threads = {}; active = set()
    for node in walk(document):
        if node['type'] == 'comment_anchor':
            attrs = node['attrs']; identity = attrs['threadId']
            item = threads.setdefault(identity, {'edges': [], 'text': '', 'resolved': attrs['thread']['resolved'],
                'entries': [(entry['author'], entry['text']) for entry in attrs['thread']['entries']]})
            item['edges'].append(attrs['edge'])
            if attrs['edge'] == 'start': active.add(identity)
            else: active.discard(identity)
        elif node['type'] == 'text':
            for identity in active: threads[identity]['text'] += node['text']
    assert not active
    assert all(item['edges'] == ['start', 'end'] for item in threads.values())
    return list(threads.values())


directory = Path(sys.argv[1])
source = json.loads((directory / 'fixture-project.json').read_text(encoding='utf-8'))['book']['chapters'][0]['document']
assert any(n['type'] == 'comment_anchor' for n in walk(source)), 'Fixture must contain an actual comment.'
for name, views in [('word-resaved.docx', ['original', 'final']), ('word-accept.docx', ['final']), ('word-reject.docx', ['original'])]:
    restored = import_document(directory / name)['document']
    for view in views:
        expected = comments(review_document(source, view))
        actual = comments(review_document(restored, view))
        assert actual == expected, (name, view, actual, expected)
print('Word retained the exact comment passages, replies and resolution in both review decisions and on resave.')
