"""Portable named destinations and ranges. Bookmarks never add spoken text."""
import re
import hashlib


def moved_bookmark_name(name):
    return 'AlMove_'+hashlib.sha256(name.encode('utf-8')).hexdigest()[:32]


def restore_moved_bookmark_names(document):
    """Recognise only our deterministic export alias, inside a paired move."""
    from .tracked_block_moves import moved_object_aliases
    aliases=moved_object_aliases(document);starts={};ends=[]
    def walk(node):
        if node['type']=='bookmark':starts[node['attrs']['blockId']]=node['attrs']
        if node['type']=='bookmark_end':ends.append(node['attrs'])
        for child in node.get('content',[]):walk(child)
    walk(document)
    for ghost,live in aliases.items():
        if ghost in starts and live in starts and starts[ghost]['name']==moved_bookmark_name(starts[live]['name']):
            starts[ghost]['name']=starts[live]['name']
            for end in ends:
                if end['targetId']==ghost:end['name']=starts[live]['name']


def bookmark_name(name, used, warnings):
    if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,39}', name):
        raise ValueError('Invalid bookmark name.')
    base=name; suffix=1
    while name.lower() in used:
        suffix += 1;tail=f'_{suffix}';name=base[:40-len(tail)]+tail
    used.add(name.lower())
    if name != base:
        message='Duplicate bookmark names from separate document parts receive unique suffixes in the exported document.'
        if message not in warnings: warnings.append(message)
    return name


def publication_bookmarks(sections, warnings):
    """Resolve identity links on the detached publication, across all sections."""
    used, by_id, by_name, locations = set(), {}, {}, {}
    nodes = [];bookmarks=[]
    from .tracked_block_moves import moved_object_aliases
    aliases=moved_object_aliases({'type':'doc','content':[node for section in sections for node in section['blocks']]})
    def collect(node, section):
        nodes.append(node)
        if node.get('type') == 'bookmark':
            bookmarks.append((node['attrs'],section))
        for child in node.get('content', []): collect(child, section)
    for index, section in enumerate(sections):
        for node in section['blocks']: collect(node, index)
    for attrs,section in sorted(bookmarks,key=lambda entry:entry[0].get('blockId') in aliases):
        original=attrs['name'];live=aliases.get(attrs.get('blockId'))
        if live in by_id:
            name=moved_bookmark_name(by_id[live])
            if name.lower() in used:raise ValueError('A moved bookmark conflicts with another exported bookmark name. Rename that bookmark before exporting.')
            used.add(name.lower())
        else:
            name=bookmark_name(original,used,warnings);by_name.setdefault(original,name)
        attrs['name']=name
        if attrs.get('blockId'):by_id.setdefault(attrs['blockId'],name)
        locations[name]=section
    starts, ends = {}, {}
    for index, node in enumerate(nodes):
        attrs = node.get('attrs', {})
        if node.get('type') == 'bookmark':
            starts[attrs['name']] = (index, node)
        elif node.get('type') == 'bookmark_end':
            attrs.pop('unresolved', None)
            attrs.pop('targetName', None)
            name = by_id.get(attrs.get('targetId')) or by_name.get(attrs.get('targetId'))
            if name:
                attrs['targetName'] = name
                ends.setdefault(name, []).append((index, node))
            else:
                attrs['unresolved'] = True
    incomplete = any(n.get('attrs', {}).get('unresolved') for n in nodes if n.get('type') == 'bookmark_end')
    for name, (start, node) in starts.items():
        closing = ends.get(name, [])
        if len(closing) == 1 and closing[0][0] > start:
            node['attrs']['range'] = True
        else:
            incomplete |= bool(node['attrs'].get('range') or closing)
            node['attrs']['range'] = False
            for _, end in closing:
                end['attrs']['unresolved'] = True
    if incomplete:
        message = 'An incomplete bookmark range was exported as a point destination where possible; all passage text is retained.'
        if message not in warnings: warnings.append(message)
    for node in nodes:
        if node.get('type')=='index_entry' and node.get('attrs',{}).get('rangeId'):
            attrs=node['attrs'];attrs.pop('rangeName',None)
            name=by_id.get(attrs['rangeId']) or by_name.get(attrs['rangeId'])
            if name and starts[name][1]['attrs'].get('range'):attrs['rangeName']=name
            else:
                message='An index page range has a missing, excluded or incomplete bookmark. Repair the range and update fields.'
                if message not in warnings:warnings.append(message)
        if node.get('type') == 'cross_reference':
            attrs = node['attrs']
            name = by_id.get(attrs['targetId']) or by_name.get(attrs['targetId'])
            attrs.pop('targetName', None)
            if name: attrs['targetName'] = name
            else: attrs['unresolved'] = True
        kept = []
        for mark in node.get('marks', []):
            href = mark.get('attrs', {}).get('href', '')
            if mark.get('type') == 'link' and href.startswith('#'):
                name = by_id.get(href[1:]) or by_name.get(href[1:])
                if not name:
                    message = 'A link refers to a missing or excluded bookmark. Its text is retained without the link.'
                    if message not in warnings: warnings.append(message)
                    continue
                mark['attrs']['href'] = '#' + name
            kept.append(mark)
        if 'marks' in node: node['marks'] = kept
    return locations
