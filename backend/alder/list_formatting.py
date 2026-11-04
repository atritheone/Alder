"""The ordinary editable list-marker subset, shared by publication formats."""
import json
NUMBER_FORMATS = {'decimal': 'decimal', 'lower-alpha': 'lowerLetter', 'upper-alpha': 'upperLetter', 'lower-roman': 'lowerRoman', 'upper-roman': 'upperRoman'}
BULLETS = {'disc': '\u2022', 'circle': '\u25cb', 'square': '\u25aa'}


def word_list_name(reader,number):
    cache=getattr(reader,'_list_names',None)
    if cache is None:cache=reader._list_names={}
    if number in cache:return cache[number]
    from docx.oxml.ns import qn
    instance=next((n for n in reader.root.findall(qn('w:num')) if n.get(qn('w:numId'))==str(number)),None)
    identity=instance.find(qn('w:abstractNumId')) if instance is not None else None
    abstract=next((n for n in reader.root.findall(qn('w:abstractNum')) if identity is not None and n.get(qn('w:abstractNumId'))==identity.get(qn('w:val'))),None)
    name=abstract.find(qn('w:name')) if abstract is not None else None
    cache[number]=name.get(qn('w:val')) if name is not None else None
    return cache[number]


def word_list_continuation(reader,number):
    """A continuation can temporarily have no matching preceding list."""
    from .outline_lists import read_word_template
    from .nested_list_conversion import ordinary_depth
    from .nested_outline import number_continuation
    return (word_list_name(reader,number) in ('AlderOrdinaryContinuation','AlderRelativeContinuation') or ordinary_depth(reader,number) and number_continuation(reader,number)) and read_word_template(reader,number) is None


def relative_list_level(level):
    return {'indent':round(7*72/25.4*(level+1)*20)/20,'hanging':10}


def word_relative_list(reader,number):
    from .outline_lists import read_word_template
    from .nested_list_conversion import ordinary_depth
    return (word_list_name(reader,number) in ('AlderRelativeList','AlderRelativeContinuation') or ordinary_depth(reader,number)>0) and read_word_template(reader,number) is None


def list_marker(number, style='decimal'):
    if style in BULLETS:
        return BULLETS[style]
    from .page_numbering import format_page_number
    return format_page_number(number,NUMBER_FORMATS.get(style,'decimal'))


def list_sequences(node):
    """Yield each ordered list and its continuation predecessor in this container."""
    preceding = {}
    for child in node.get('content', []):
        if (child.get('attrs',{}).get('revisionMove') or child.get('attrs',{}).get('revisionBlock') or {}).get('kind')=='deletion':continue
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
            count=sum(1 for item in previous.get('content',[]) if (item.get('attrs',{}).get('revisionMove') or item.get('attrs',{}).get('revisionBlock') or {}).get('kind')!='deletion') if previous else 0
            attrs['order'] = (previous.get('attrs', {}).get('order', 1) + count) if previous else 1
    targets={};ghosts=[]
    def moves(node):
        attrs=node.get('attrs',{});move=attrs.get('revisionMove')
        if node['type']=='ordered_list' and move:
            key=(move['stamp']['id'],move.get('part',0))
            if move['kind']=='insertion':targets[key]=attrs.get('order',1)
            else:ghosts.append((key,attrs))
        for child in node.get('content',[]):moves(child)
    moves(document)
    for key,attrs in ghosts:
        if attrs.get('continuePrevious') and key in targets:attrs['order']=targets[key]
    return document
