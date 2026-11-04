"""Combine independent reviews inside unchanged list and table boundaries."""
from copy import deepcopy
from .document_revisions import review_document, revision_summary
from .document_comparison import canonical
from .combine_inline_reviews import merge_paragraph
from .paragraph_revisions import paragraph_format


def merge_structure(a, b, base, signature, resolve=None, path=()):
    if a['type'] in ('paragraph', 'heading') and b['type'] in ('paragraph', 'heading'):
        merged = merge_paragraph(a, b, base, signature)
        if merged is None and resolve and path and not any(n.get('attrs', {}).get(k) for n in (a, b) for k in ('revisionMove', 'revisionBlock')):
            return resolve(a, b, path)
        return merged
    containers = ('ordered_list', 'bullet_list', 'list_item', 'table', 'table_row', 'table_cell', 'table_header')
    list_types = ('ordered_list', 'bullet_list')
    if a['type'] not in containers or not (a['type'] == b['type'] == base['type'] or all(n['type'] in list_types for n in (a,b,base))):
        return None
    if any(n.get('attrs', {}).get(k) for n in (a, b) for k in ('revisionMove', 'revisionBlock')):
        return None
    if not len(a.get('content', [])) == len(b.get('content', [])) == len(base.get('content', [])):
        return None
    if resolve:
        # A single review operation crossing children must remain one choice.
        # This also covers a Table Properties operation spanning parent/cells.
        for node in (a, b):
            groups = {r['id']: -1 for r in revision_summary({k: v for k, v in node.items() if k != 'content'})}
            for index, child in enumerate(node['content']):
                for record in revision_summary(child):
                    if record['id'] in groups and groups[record['id']] != index: return None
                    groups[record['id']] = index
    appearance = lambda n: {k: deepcopy(v) for k, v in n.items() if k != 'content'}
    if signature([appearance(a)]) == signature([appearance(b)]):
        result = appearance(a)
    else:
        records = []; touched = set()
        for node in (a, b):
            log = node.get('attrs', {}).get('revisionProperties')
            current = [r for r in (log or {}).get('records', []) if r['status'] == 'pending']
            changes = {key for r in current for key in r['before']['attrs'].keys() | r['after']['attrs'].keys()
                       if r['before']['attrs'].get(key) != r['after']['attrs'].get(key)}
            if any(r['before']['type'] != r['after']['type'] for r in current): changes.add('type')
            if touched & changes:
                return None
            records.extend(deepcopy(current)); touched.update(changes)
        result = appearance(base)
        if records:
            log = {'base': {'type': base['type'], 'attrs': {k: v for k, v in base.get('attrs', {}).items() if k != 'blockId' and v is not None}}, 'records': records}
            final = paragraph_format(log); result['type'] = final['type']
            result['attrs'] = {**final['attrs'], 'blockId': base.get('attrs', {}).get('blockId'), 'revisionProperties': log}
    children = []
    for index, (left, right, original) in enumerate(zip(a['content'], b['content'], base['content'])):
        try:
            # Do not separate an item/row move or a split across siblings into
            # independent review choices, even if the child counts coincide.
            if any(canonical(review_document({'type': 'doc', 'content': [n]}, 'original')) != canonical({'type': 'doc', 'content': [original]}) for n in (left, right)):
                return None
        except (ValueError, KeyError):
            return None
        changed = [bool(revision_summary(n)) for n in (left, right)]
        if not all(changed) or signature([left]) == signature([right]):
            children.append(deepcopy(right if changed[1] and not changed[0] else left))
        else:
            merged = merge_structure(left, right, original, signature, resolve, (*path, index))
            if merged is None: return None
            children.append(merged)
    result['content'] = children
    return result
