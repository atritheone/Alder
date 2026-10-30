"""The ordinary editable list-marker subset, shared by publication formats."""
import json
NUMBER_FORMATS = {'decimal': 'decimal', 'lower-alpha': 'lowerLetter', 'upper-alpha': 'upperLetter', 'lower-roman': 'lowerRoman', 'upper-roman': 'upperRoman'}
BULLETS = {'disc': '\u2022', 'circle': '\u25cb', 'square': '\u25aa'}


def list_marker(number, style='decimal'):
    if style in BULLETS:
        return BULLETS[style]
    from .page_numbering import format_page_number
    return format_page_number(number,NUMBER_FORMATS.get(style,'decimal'))


def list_sequences(node):
    """Yield each ordered list and its continuation predecessor in this container."""
    preceding = {}
    for child in node.get('content', []):
        if child.get('type') in ('ordered_list', 'orderedList'):
            attrs = child.get('attrs') or {}
            marker = json.dumps(attrs['listTemplate'],sort_keys=True) if attrs.get('listTemplate') is not None else attrs.get('listStyle') or 'decimal'
            yield child, preceding.get(marker) if attrs.get('continuePrevious') else None
            preceding[marker] = child
        yield from list_sequences(child)


def resolve_list_orders(document):
    for node, previous in list_sequences(document):
        attrs = node.setdefault('attrs', {})
        if attrs.get('continuePrevious'):
            attrs['order'] = (previous.get('attrs', {}).get('order', 1) + len(previous.get('content', []))) if previous else 1
    return document
