"""Recognise exact list boundary edits before treating wording as replaced."""
from copy import deepcopy
from uuid import uuid4
from .models import document_text


def item_boundary_change(before, after, old_path, new_path, out_path, canonical, stamp, locate, locate_tree):
    def item(node): return node['type'] == 'list_item'
    def sibling(path): return (*path[:-1], path[-1] + 1)
    if before and len(after) >= 2 and all(item(n) for n in (before[0], *after[:2])):
        left, right = after[0].get('content', []), after[1].get('content', [])
        if left and right and left[-1]['type'] == right[0]['type'] == 'paragraph':
            appearance = lambda n: canonical({k: v for k, v in n.items() if k != 'content'})
            merged = deepcopy(after[0])
            merged['content'][-1].setdefault('content', []).extend(deepcopy(right[0].get('content', [])))
            merged['content'].extend(deepcopy(right[1:]))
            if appearance(left[-1]) == appearance(right[0]) and canonical(merged) == canonical(before[0]):
                result = deepcopy(after[:2]); index = len(left) - 1
                result[0]['content'][-1].setdefault('content', []).append({'type': 'revision_break', 'attrs': {
                    'kind': 'insertion', 'scope': 'item', 'stamp': stamp(), 'nextId': result[1]['content'][0]['attrs']['blockId'], 'blockId': 'block_' + uuid4().hex}})
                locate_tree('new', after[0], new_path, out_path)
                locate_tree('new', after[1], sibling(new_path), sibling(out_path))
                for i, node in enumerate(before[0]['content']):
                    if i < index: locate_tree('old', node, (*old_path, i), (*out_path, i))
                    elif i > index: locate_tree('old', node, (*old_path, i), (*sibling(out_path), i - index))
                    else:
                        cut = len(document_text(left[-1]))
                        locate('old', (*old_path, i), 0, cut, (*out_path, i))
                        locate('old', (*old_path, i), cut, len(document_text(node)), (*sibling(out_path), 0))
                return 1, 2, result
    if len(before) >= 2 and after and all(item(n) for n in (*before[:2], after[0])):
        left, right = before[0].get('content', []), before[1].get('content', [])
        if left and right and right[0]['type'] == 'paragraph':
            merged = deepcopy(before[0]); merged['content'].extend(deepcopy(right))
            if canonical(merged) == canonical(after[0]):
                result = deepcopy(after[0]); target = result['content'][len(left)]
                target.setdefault('content', []).insert(0, {'type': 'revision_break', 'attrs': {
                    'kind': 'deletion', 'scope': 'item', 'stamp': stamp(), 'nextId': target['attrs']['blockId'],
                    'rightType': 'list_item', 'rightAttrs': deepcopy(before[1].get('attrs', {})), 'blockId': 'block_' + uuid4().hex}})
                locate_tree('new', after[0], new_path, out_path)
                for i, node in enumerate(left): locate_tree('old', node, (*old_path, i), (*out_path, i))
                for i, node in enumerate(right): locate_tree('old', node, (*sibling(old_path), i), (*out_path, len(left) + i))
                return 2, 1, [result]
    return None
