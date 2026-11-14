"""Apply bounded JSON corrections to an owned saved snapshot, then fully validate.

No filesystem paths, Python attributes or executable operations are accepted.
The normal Store.update revision check remains the sole commit boundary.
"""
from .models import ValidationError
from copy import copy
import json


def apply_project_changes(project, changes, *, persistent=False):
    if not isinstance(changes, list) or len(changes) > 64:
        raise ValidationError('An incremental save accepts at most 64 changes.')
    if persistent: project = copy(project)
    for change in changes:
        if not isinstance(change, dict): raise ValidationError('Invalid project change.')
        path = change.get('path')
        if not isinstance(path, list) or not 1 <= len(path) <= 64:
            raise ValidationError('Invalid project change path.')
        if type(change.get('remove', False)) is not bool or ('value' not in change and not change.get('remove')):
            raise ValidationError('A project change requires a value or removal.')
        parent = project
        for index, key in enumerate(path):
            if isinstance(parent, dict):
                if not isinstance(key, str): raise ValidationError('Project object keys must be strings.')
            elif isinstance(parent, list):
                if type(key) is not int or not 0 <= key < len(parent): raise ValidationError('Project array index is out of range.')
            else: raise ValidationError('Project change parent is not a container.')
            if index < len(path) - 1:
                if isinstance(parent, dict) and key not in parent: raise ValidationError('Project change parent does not exist.')
                if persistent and isinstance(parent[key], (dict,list)): parent[key] = copy(parent[key])
                parent = parent[key]
            elif change.get('remove'):
                if not isinstance(parent, dict) or key not in parent: raise ValidationError('Only existing project properties can be removed.')
                del parent[key]
            else:
                parent[key] = change['value']
    return project


def plain_text_edit(base, submitted, changes):
    """Validate a narrow text-only change against a trusted canonical snapshot.

    Only existing text cells/empty text runs and their derived chapter text can
    change. Every identity, mark, formatting value, asset/reference, container,
    style and project relation is inherited from the same acknowledged revision.
    Other edits use validate_project, including newline/structural changes.
    """
    if base.get('schemaVersion') != 2 or base.get('settings',{}).get('documentKind') != 'txt': return None
    if set(base)!=set(submitted) or any(submitted[key] is not value for key,value in base.items() if key not in ('book','updatedAt')): return None
    chapters = base.get('book',{}).get('chapters',[])
    if len(chapters) != 1: return None
    book = submitted.get('book',{})
    if set(book)!=set(base['book']) or any(book[key] is not value for key,value in base['book'].items() if key!='chapters') or len(book.get('chapters',[]))!=1: return None
    chapter = book['chapters'][0]
    if set(chapter)!=set(chapters[0]) or any(chapter[key] is not value for key,value in chapters[0].items() if key not in ('document','text')): return None
    root = chapters[0]['document']
    if root.get('type') != 'doc' or root.get('attrs') or root.get('marks'): return None
    prefix = ['book','chapters',0]
    for change in changes:
        path = change['path']
        if change.get('remove'): return None
        if isinstance(change.get('value'),str):
            try: change['value'].encode('utf-8')
            except UnicodeError: return None
        if path == ['updatedAt']:
            if not isinstance(change.get('value'),str): return None
        elif path == [*prefix,'text']:
            if not isinstance(change.get('value'),str): return None
        elif len(path) == 9 and path[:5] == [*prefix,'document','content'] and path[6] == 'content' and path[8] == 'text':
            if not isinstance(change.get('value'),str): return None
        elif len(path) == 7 and path[:5] == [*prefix,'document','content'] and path[6] == 'content':
            children = change.get('value')
            if not isinstance(children,list) or len(children)>1 or any(set(node)-{'type','text'} or node.get('type')!='text' or not isinstance(node.get('text'),str) for node in children if isinstance(node,dict)) or any(not isinstance(node,dict) for node in children): return None
        else: return None
    # The entire plain shape is checked; this is not a client-supplied "plain"
    # flag or a hash used to waive validation of an arbitrary document.
    edited = submitted['book']['chapters'][0]['document']
    count = 1
    lines = []
    for paragraph in edited.get('content',[]):
        if not isinstance(paragraph,dict) or paragraph.get('type')!='paragraph' or set(paragraph)-{'type','attrs','marks','content'} or paragraph.get('marks') or set(paragraph.get('attrs') or {})-{'blockId'}: return None
        children = paragraph.get('content',[])
        if not isinstance(children,list): return None
        count += 1 + len(children)
        if count > 250000: return None
        for child in children:
            if not isinstance(child,dict) or set(child)-{'type','text'} or child.get('type')!='text' or not isinstance(child.get('text'),str): return None
        lines.append(''.join(child['text'] for child in children))
    text = '\n'.join(lines)
    try: text.encode('utf-8')
    except UnicodeError: return None
    result = copy(submitted)
    if submitted['book']['chapters'][0].get('text') != text:
        result = apply_project_changes(result,[{'path':[*prefix,'text'],'value':text}],persistent=True)
    return result


def plain_input_bytes(submitted, canonical, payload):
    """Exact raw snapshot size without serialising another whole manuscript.

    The narrow path only normalises these three scalar fields; all other JSON
    containers/keys/values retain their source shape and order.
    """
    size=len(payload.encode('utf-8'))
    pairs=[(submitted['revision'],canonical['revision']),
           (submitted['updatedAt'],canonical['updatedAt']),
           (submitted['book']['chapters'][0]['text'],canonical['book']['chapters'][0]['text'])]
    for before,after in pairs:
        if before is after: continue
        size+=len(json.dumps(before,ensure_ascii=False,allow_nan=False).encode('utf-8'))
        size-=len(json.dumps(after,ensure_ascii=False,allow_nan=False).encode('utf-8'))
    return size
