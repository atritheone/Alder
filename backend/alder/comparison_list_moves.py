"""Recognise complete, unique list moves across comparison scopes."""
from collections import Counter
from copy import deepcopy


def pair_list_moves(document, before, after, key, marked, stamp):
    def lists(nodes):
        for node in nodes:
            if node['type'] in ('ordered_list', 'bullet_list'):
                yield node
            yield from lists(node.get('content', []))

    counts = [Counter(key(node) for node in lists(nodes)) for nodes in (before, after)]
    candidates = {'deletion': {}, 'insertion': {}}

    def visit(parent, address=()):
        for index, node in enumerate(parent.get('content', [])):
            attrs = node.get('attrs', {})
            change = attrs.get('revisionBlock')
            if change:
                if node['type'] not in ('ordered_list', 'bullet_list') or change.get('count', 1) != 1:
                    continue
                clean = deepcopy(node)
                clean['attrs'].pop('revisionBlock')
                signature = key(clean)
                if all(count[signature] == 1 for count in counts):
                    candidates[change['kind']].setdefault(signature, []).append((parent, index, address, clean))
            elif not attrs.get('revisionMove'):
                visit(node, (*address, index))

    visit(document)
    for signature, sources in candidates['deletion'].items():
        targets = candidates['insertion'].get(signature, [])
        if len(sources) != 1 or len(targets) != 1:
            continue
        source, target = sources[0], targets[0]
        if source[2] == target[2]:
            continue
        record = stamp(True)
        for (parent, index, _, _), kind in ((source, 'deletion'), (target, 'insertion')):
            parent['content'][index] = marked(source[3], kind, record, True)
