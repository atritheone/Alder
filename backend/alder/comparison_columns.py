"""Recognise one complete column band without guessing changed cell ownership."""
from copy import deepcopy
from uuid import uuid4


def column_boundary_change(before, after, old_address, new_address, output_address, canonical, stamp, locate_tree):
    old_rows, new_rows = before.get('content', []), after.get('content', [])
    if not old_rows or len(old_rows) != len(new_rows): return None
    old_width, new_width = len(old_rows[0].get('content', [])), len(new_rows[0].get('content', []))
    if old_width == new_width or not min(old_width, new_width): return None
    appearance = lambda node: canonical({k: v for k, v in node.items() if k != 'content'})
    if appearance(before) != appearance(after) or any(appearance(a) != appearance(b) for a, b in zip(old_rows, new_rows)): return None
    for rows, width in ((old_rows, old_width), (new_rows, new_width)):
        if any(len(row.get('content', [])) != width or any(cell.get('attrs', {}).get('colspan', 1) != 1 or cell.get('attrs', {}).get('rowspan', 1) != 1 for cell in row['content']) for row in rows): return None
    insertion = new_width > old_width
    longer, shorter = (after, before) if insertion else (before, after)
    count, width = abs(new_width - old_width), min(old_width, new_width)
    left = [[canonical(cell) for cell in row['content']] for row in longer['content']]
    right = [[canonical(cell) for cell in row['content']] for row in shorter['content']]
    # Prefix/suffix checks keep large tables linear. Duplicate candidates are
    # ambiguous, so retain the existing refusal instead of inventing ownership.
    prefix = 0
    while prefix < width and all(a[prefix] == b[prefix] for a, b in zip(left, right)): prefix += 1
    suffix = width
    while suffix > 0 and all(a[suffix - 1 + count] == b[suffix - 1] for a, b in zip(left, right)): suffix -= 1
    if prefix != suffix: return None
    index = prefix
    result = deepcopy(longer)
    record = stamp()
    for r, row in enumerate(result['content']):
        for c, cell in enumerate(row['content']):
            changed = index <= c < index + count
            short_column = c if c < index else c - count
            out = (*output_address, r, c)
            long_side = 'new' if insertion else 'old'
            locate_tree(long_side, cell, (*(new_address if insertion else old_address), r, c), out)
            if changed:
                attrs = cell.setdefault('attrs', {})
                identity = attrs.get('blockId') or 'block_' + uuid4().hex
                attrs.update(blockId=identity, revisionBlock={
                    'kind': 'insertion' if insertion else 'deletion', 'stamp': record,
                    'originalId': identity, 'part': r * count + c - index, 'count': len(old_rows) * count})
            else:
                other = shorter['content'][r]['content'][short_column]
                locate_tree('old' if insertion else 'new', other, (*(old_address if insertion else new_address), r, short_column), out)
    return result
