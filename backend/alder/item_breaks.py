"""Review an inserted list-item boundary without making its text an insertion."""
from copy import deepcopy
from uuid import uuid4
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def boundary_properties(props):
    result = deepcopy(props)
    for child in list(result):
        if child.tag == f'{{{W}}}pPrChange':
            result.remove(child)
        elif child.tag == f'{{{W}}}rPr':
            for change in list(child):
                if change.tag in (f'{{{W}}}ins', f'{{{W}}}del'):
                    child.remove(change)
            if not len(child):
                result.remove(child)
    return result


def write_continuation_split(paragraph, previous, stamp, writer):
    """Rejecting a mark uses the right paragraph's old properties. Retain the
    left paragraph there, including its numbering and authored appearance."""
    from .table_revisions import append_change
    props = paragraph._p.get_or_add_pPr()
    if props.find(f'{{{W}}}pPrChange') is not None:
        raise ValueError('Review overlapping list formatting before exporting this item split to Word.')
    append_change(props, 'pPr', boundary_properties(previous._p.pPr), stamp, writer)


def read_continuation_split(paragraph, numbering, reader, list_reader):
    from docx.text.paragraph import Paragraph
    from .list_item_boundaries import read_item_paragraph
    from .cell_revisions import signature
    props = paragraph._p.pPr
    change = props.find(f'{{{W}}}pPrChange') if props is not None else None
    old = change.find(f'{{{W}}}pPr') if change is not None else None
    if old is None or props.find(f'{{{W}}}numPr') is None:
        return False
    prior_xml = deepcopy(paragraph._p); prior_xml.remove(prior_xml.pPr); prior_xml.insert(0, deepcopy(old))
    prior = Paragraph(prior_xml, paragraph._parent)
    boundary = read_item_paragraph(prior)
    numbered = old.find(f'{{{W}}}numPr') is not None
    if boundary is None and not numbered:
        return False
    def fail():
        raise ValueError('This Word item split has independent or incomplete formatting. The original file has not been changed.')
    left = paragraph._p.getprevious()
    if left is None or left.tag != f'{{{W}}}p' or left.pPr is None:
        if numbered:return False
        fail()
    revision = reader.paragraph_break(left)
    if numbered and (not revision or revision['kind'] != 'insertion'):return False
    stamp = reader.stamp(change)
    if not revision or revision['kind'] != 'insertion' or any(revision['stamp'].get(key, '') != stamp.get(key, '') for key in ('author', 'date')):
        fail()
    previous_props,old_props=boundary_properties(left.pPr),boundary_properties(old)
    if numbered:
        previous_appearance=list_reader.appearance(previous_props,fail)
        old_appearance=list_reader.appearance(old_props,fail)
    else:
        previous_appearance,old_appearance=signature(previous_props),signature(old_props)
    if previous_appearance != old_appearance:
        fail()
    counts = dict(numbering.counts)
    info = numbering.info(paragraph)
    numbering.counts = counts
    prior_info=numbering.info(prior) if numbered else None
    numbering.counts=counts
    if not info or (numbered and (prior_info is None or prior_info[:2]!=info[:2])) or (boundary and info[1]!=boundary[0]):
        fail()
    if numbered:
        left_info=numbering.info(Paragraph(left,paragraph._parent));numbering.counts=counts
        if left_info is None or left_info[:2]!=prior_info[:2]:fail()
    # The newly created paragraph owns its current appearance. Rejecting the
    # split restores the left paragraph's exact old properties above; accepting
    # it keeps the right paragraph's independently editable properties.
    props.remove(change)
    return True


def write_item_join(paragraph, change, number, level, base_indent, spec, numbering, writer):
    """Only the right item's numbering is removed; its paragraph survives."""
    from docx.text.paragraph import Paragraph
    from docx.shared import Pt
    from .table_revisions import append_change
    props = paragraph._p.pPr
    if props.find(f'{{{W}}}pPrChange') is not None:
        raise ValueError('Review overlapping list formatting before exporting this item join to Word.')
    xml = deepcopy(paragraph._p); prior = Paragraph(xml, paragraph._parent)
    prior.style = paragraph.style.base_style
    authored = paragraph.paragraph_format.left_indent.pt - base_indent
    prior.paragraph_format.left_indent = Pt(authored + (spec['indent'] if spec else 0))
    first = paragraph.paragraph_format.first_line_indent
    if spec:
        prior.paragraph_format.first_line_indent = Pt((first.pt if first is not None else 0) - spec['hanging'])
    numbering.apply(prior, number, level)
    append_change(props, 'pPr', prior._p.pPr, change['stamp'], writer)


def read_item_join(paragraph, numbering, reader):
    from docx.text.paragraph import Paragraph
    from .list_item_boundaries import read_item_paragraph
    from .cell_revisions import signature
    boundary = read_item_paragraph(paragraph)
    props = paragraph._p.pPr
    change = props.find(f'{{{W}}}pPrChange') if props is not None else None
    old = change.find(f'{{{W}}}pPr') if change is not None else None
    if not boundary or old is None or old.find(f'{{{W}}}numPr') is None:
        return None
    def fail():
        raise ValueError('This Word item join has independent or incomplete formatting. The original file has not been changed.')
    xml = deepcopy(paragraph._p); xml.remove(xml.pPr); xml.insert(0, deepcopy(old))
    prior = Paragraph(xml, paragraph._parent)
    counts = dict(numbering.counts); info = numbering.info(prior); numbering.counts = counts
    if not info or info[1] != boundary[0] or paragraph.style.base_style.style_id != prior.style.style_id:
        fail()
    if signature(props, ('pPrChange', 'pStyle', 'numPr', 'ind')) != signature(old, ('pStyle', 'numPr', 'ind')):
        fail()
    from .outline_lists import read_word_template
    template = read_word_template(numbering, info[0]); spec = template[info[1]] if template else None
    from .list_formatting import word_relative_list, relative_list_level
    if spec is None and word_relative_list(numbering, info[0]): spec = relative_list_level(info[1])
    a = old.find(f'{{{W}}}ind'); b = props.find(f'{{{W}}}ind')
    if any(key.rsplit('}', 1)[-1] not in ('left', 'right', 'firstLine', 'hanging') for element in (a, b) if element is not None for key in element.attrib): fail()
    def value(element, key, default=0): return int(element.get(f'{{{W}}}{key}', str(default))) if element is not None else default
    left = value(a, 'left', round(spec['indent'] * 20) if spec else 0) - round(spec['indent'] * 20 if spec else 0)
    first = value(a, 'firstLine') - value(a, 'hanging') + round(spec['hanging'] * 20 if spec else 0)
    current_first = value(b, 'firstLine') - value(b, 'hanging')
    # Word expands an ordinary number's inherited hanging indent into old pPr.
    permitted_first = {current_first, -200} if not spec and current_first == 0 else {current_first}
    if value(b, 'left', round(boundary[1] * 20)) != left + round(boundary[1] * 20) or value(b, 'right') != value(a, 'right') or first not in permitted_first: fail()
    stamp = reader.stamp(change); props.remove(change)
    return info, stamp


def restore_item_joins(document):
    boundaries = {}
    def walk(node):
        result = deepcopy({key: value for key, value in node.items() if key != 'content'})
        children = []
        for child in node.get('content', []):
            change = child.get('attrs', {})
            if child['type'] == 'revision_break' and change.get('scope') == 'item' and change['kind'] == 'deletion':
                if id(result) in boundaries or node['type'] != 'paragraph' or change['nextId'] != node.get('attrs', {}).get('blockId'):
                    raise ValueError('A deleted item boundary has moved apart.')
                boundaries[id(result)] = change
            else:
                children.extend(walk(child))
        if node['type'] == 'list_item':
            items = []; group = []; attrs = result.get('attrs', {})
            for child in children:
                change = boundaries.get(id(child))
                if change:
                    if not group: raise ValueError('A deleted item boundary is missing its preceding item.')
                    items.append({'type': 'list_item', 'attrs': attrs, 'content': group})
                    group = []; attrs = deepcopy(change['rightAttrs'])
                group.append(child)
            return [*items, {'type': 'list_item', 'attrs': attrs, 'content': group}]
        if any(id(child) in boundaries for child in children):
            raise ValueError('A deleted item boundary is outside its item.')
        if 'content' in node: result['content'] = children
        return [result]
    return walk(document)[0]


def item_break_view(document, view):
    if view == 'markup':
        return document
    if view == 'original':
        document = restore_item_joins(document)
    joins = {}

    def walk(node):
        result = deepcopy({key: value for key, value in node.items() if key != 'content'})
        children = []
        for child in node.get('content', []):
            if child['type'] == 'revision_break' and child['attrs'].get('scope') == 'item':
                if view == 'original':
                    if id(result) in joins:
                        raise ValueError('An item has overlapping pending boundaries.')
                    joins[id(result)] = child['attrs']['nextId']
                continue
            children.append(walk(child))
        if node['type'] == 'list_item' and view == 'original':
            if any(id(child) in joins for child in children[:-1]):
                raise ValueError('An original-view item boundary has moved apart.')
            if children and id(children[-1]) in joins:
                joins[id(result)] = joins[id(children[-1])]
        if node['type'] in ('ordered_list', 'bullet_list') and view == 'original':
            combined = []
            for child in children:
                previous = combined[-1] if combined else None
                target = joins.pop(id(previous), None) if previous else None
                if not target:
                    combined.append(child)
                    continue
                left = previous.get('content', [])
                right = child.get('content', [])
                if not left or not right or left[-1]['type'] != 'paragraph' or right[0]['type'] != 'paragraph' or right[0].get('attrs', {}).get('blockId') != target:
                    raise ValueError('An original-view item boundary has moved apart.')
                left[-1].setdefault('content', []).extend(right[0].get('content', []))
                left.extend(right[1:])
                if id(child) in joins:
                    joins[id(previous)] = joins[id(child)]
            if combined and id(combined[-1]) in joins:
                raise ValueError('An original-view item boundary is incomplete.')
            children = combined
        elif view == 'original' and node['type'] != 'list_item' and any(id(child) in joins for child in children):
            raise ValueError('An original-view item boundary is outside its list.')
        if 'content' in node:
            result['content'] = children
        return result
    return walk(document)


def restore_word_item_splits(document):
    """A native inserted paragraph mark between numbered items is also an
    inserted item boundary. Consume it before ordinary paragraph restoration."""
    def walk(node):
        for child in node.get('content', []):
            walk(child)
        if node['type'] not in ('ordered_list', 'bullet_list'):
            return
        items = node.get('content', [])
        for index, item in enumerate(items):
            blocks = item.get('content', [])
            if not blocks or blocks[-1]['type'] != 'paragraph':
                continue
            paragraph = blocks[-1]
            change = paragraph.get('attrs', {}).get('revisionBreak')
            if not change or change['kind'] != 'insertion':
                continue
            if index + 1 == len(items) or not items[index + 1].get('content') or items[index + 1]['content'][0]['type'] != 'paragraph':
                raise ValueError('An inserted Word item boundary has no following item. The original file has not been changed.')
            following = items[index + 1]['content'][0]
            identity = following.setdefault('attrs', {}).setdefault('blockId', 'block_' + uuid4().hex)
            paragraph['attrs'].pop('revisionBreak')
            paragraph.setdefault('content', []).append({'type': 'revision_break', 'attrs': {**change, 'scope': 'item', 'nextId': identity}})
    walk(document)
