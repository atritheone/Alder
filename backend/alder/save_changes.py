"""Canonical corrections relative to the submitted, complete save snapshot.

This changes response transport only. Store validation and durable history keep
the same complete representation and expected-revision transaction.
"""
def canonical_changes(source, saved):
    changes = []
    class FullResponse(Exception): pass
    def compare(before, after, path):
        if before is after: return
        if len(changes) > 64:
            # Large imports/migrations can normalise thousands of block ids.
            # Use the existing full response rather than applying thousands of
            # array-copy corrections in the renderer.
            raise FullResponse()
        if type(before) is dict and type(after) is dict:
            for key in before.keys() - after.keys():
                changes.append({'path': [*path, key], 'remove': True})
            for key, value in after.items():
                if key not in before:
                    changes.append({'path': [*path, key], 'value': value})
                else:
                    compare(before[key], value, [*path, key])
        elif type(before) is list and type(after) is list and len(before) == len(after):
            for index, (left, right) in enumerate(zip(before, after)):
                compare(left, right, [*path, index])
        elif type(before) is not type(after) or before != after:
            changes.append({'path': path, 'value': after})
    try:
        compare(source, saved, [])
    except FullResponse:
        return saved
    if len(changes) > 64: return saved
    return {'savedRevision': saved['revision'], 'changes': changes}
