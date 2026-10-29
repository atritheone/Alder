"""Figure/table caption numbering and adjacent native Word caption anchors."""
import uuid


def number_captions(documents):
    counters = {'Figure':0, 'Table':0}
    def walk(node):
        if node['type'] == 'sequence':
            label = node['attrs']['sequenceName']; counters[label] += 1
            node['content'] = [{'type':'text', 'text':str(counters[label])}]
        for child in node.get('content', []): walk(child)
    for document in documents: walk(document)


def associate_captions(document):
    """Recover only an immediately adjacent, unambiguous object association."""
    def object_target(node, label):
        kind = node['type']
        if (label == 'Table' and kind == 'table') or (label == 'Figure' and kind in ('image','inline_image')):
            attrs = node.setdefault('attrs', {}); attrs.setdefault('blockId', 'block_'+uuid.uuid4().hex)
            return attrs['blockId']
        if kind == 'paragraph' and label == 'Figure':
            images=[child for child in node.get('content', []) if child['type'] in ('image','inline_image')]
            if len(images)==1:return object_target(images[0],label)
        return None
    def walk(node):
        children=node.get('content', [])
        for index,child in enumerate(children):
            attrs=child.get('attrs') or {}; label=attrs.get('captionLabel')
            if label and not attrs.get('captionTargetId'):
                neighbors = ([index+1,index-1] if label == 'Table' else [index-1,index+1])
                for neighbor in neighbors:
                    if 0 <= neighbor < len(children):
                        target=object_target(children[neighbor],label)
                        if target: attrs['captionTargetId']=target;break
            walk(child)
    walk(document)


def restore_caption_references(document):
    """Recover exported caption formats from their actual bookmark spans.

    Names alone are insufficient: Word may have edited the bookmark boundaries.
    Keep unrelated or partial ranges, and retain ranges used by ordinary links.
    """
    targets, markers, linked = {}, set(), set()
    def collect(node):
        for mark in node.get('marks', []):
            href = mark.get('attrs', {}).get('href', '')
            if mark.get('type') == 'link' and href.startswith('#'): linked.add(href[1:])
        attrs = node.get('attrs') or {}
        if attrs.get('captionLabel') or node['type'] == 'heading':
            starts, ranges, content = {}, [], []
            for child in node.get('content', []):
                ca = child.get('attrs', {})
                if child['type'] == 'bookmark':
                    key = ca.get('blockId') or ca['name']
                    starts[key] = (len(content), ca['name'])
                elif child['type'] == 'bookmark_end':
                    key = ca['targetId']; start = starts.get(key)
                    if start: ranges.append((key,start[0],len(content),start[1]))
                else: content.append(child)
            if node['type'] == 'heading':
                for key,start,end,name in ranges:
                    if name.startswith('AlderHeading_') and start == 0 and end == len(content):
                        attrs.setdefault('blockId', 'block_'+uuid.uuid4().hex)
                        targets[key] = targets[name] = (attrs['blockId'], None)
                        markers.add(key); markers.add(name)
            numbers = [i for i,n in enumerate(content) if n['type'] == 'sequence' and n['attrs']['sequenceName'] == attrs.get('captionLabel')]
            if len(numbers) == 1:
                position = numbers[0]
                for key,start,end,name in ranges:
                    format = None
                    if name.startswith('AlderHeading_') and start == 0 and end == len(content): format = 'text'
                    elif name.startswith('AlderLabel_') and start == 0 and end == position+1: format = 'labelNumber'
                    elif name.startswith('AlderNumber_') and start == position and end == position+1: format = 'number'
                    if format:
                        attrs.setdefault('blockId', 'block_'+uuid.uuid4().hex)
                        targets[key] = targets[name] = (attrs['blockId'],format)
                        markers.add(key); markers.add(name)
        for child in node.get('content', []): collect(child)
    collect(document)
    def restore(node):
        attrs = node.get('attrs') or {}
        if node['type'] == 'cross_reference' and attrs['targetId'] in targets:
            attrs['targetId'], format = targets[attrs['targetId']]
            if format is not None and not (format == 'text' and attrs.get('referenceFormat') == 'page'): attrs['referenceFormat'] = format
        if 'content' in node:
            kept = []
            for child in node['content']:
                ca = child.get('attrs', {})
                keys = {ca.get('blockId'),ca.get('name')} if child['type'] == 'bookmark' else {ca.get('targetId'),ca.get('name')} if child['type'] == 'bookmark_end' else set()
                if keys & markers and not keys & linked: continue
                restore(child); kept.append(child)
            node['content'] = kept
    restore(document)
