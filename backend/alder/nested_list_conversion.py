"""Native ordinary numbering inside a reviewed independent outline boundary."""
import re
from .document_revisions import W

PREFIX='AlderNestedOrdinary:'


def ordinary_depth(reader,number):
    from .list_formatting import word_list_name
    name=word_list_name(reader,number) or ''
    if not name.startswith(PREFIX):return 0
    match=re.fullmatch(re.escape(PREFIX)+r'([1-8]):([01])',name)
    if not match:raise ValueError('Invalid independent ordinary Word numbering.')
    return int(match[1])


def create_ordinary(numbering,ordered,start,marker,continued,depth):
    from .list_formatting import relative_list_level
    if not 1<=depth<=8:raise ValueError('Independent Word numbering requires a parent within the first eight list levels.')
    number=numbering.create(ordered,start,marker,continued)
    instance=next(n for n in numbering.root.findall(f'{{{W}}}num') if n.get(f'{{{W}}}numId')==str(number))
    identity=instance.find(f'{{{W}}}abstractNumId').get(f'{{{W}}}val')
    abstract=next(n for n in numbering.root.findall(f'{{{W}}}abstractNum') if n.get(f'{{{W}}}abstractNumId')==identity)
    abstract.find(f'{{{W}}}name').set(f'{{{W}}}val',f'{PREFIX}{depth}:{int(bool(continued))}')
    for level,item in enumerate(abstract.findall(f'{{{W}}}lvl')):
        item.find(f'{{{W}}}pPr/{{{W}}}ind').set(f'{{{W}}}left',str(round(relative_list_level(depth+level)['indent']*20)))
    return number


def validate_ordinary(abstract,depth):
    from .list_formatting import relative_list_level,NUMBER_FORMATS,BULLETS
    def val(node,name,default=None):
        child=node.find(f'{{{W}}}{name}')
        return child.get(f'{{{W}}}val') if child is not None else default
    levels=abstract.findall(f'{{{W}}}lvl')
    def fail():raise ValueError('This independent ordinary Word list has changed its numbering definition.')
    if len(levels)!=9:fail()
    first=val(levels[0],'numFmt')
    for level,item in enumerate(levels):
        indent=item.find(f'{{{W}}}pPr/{{{W}}}ind')
        fmt=val(item,'numFmt');pattern=val(item,'lvlText')
        if item.get(f'{{{W}}}ilvl')!=str(level) or fmt!=first or not (fmt in NUMBER_FORMATS.values() and pattern==f'%{level+1}.' or fmt=='bullet' and pattern in BULLETS.values()):fail()
        if val(item,'suff')!='space' or val(item,'lvlJc')!='left' or val(item,'lvlRestart',str(level))!=str(level):fail()
        if indent is None or indent.get(f'{{{W}}}left')!=str(round(relative_list_level(depth+level)['indent']*20)) or indent.get(f'{{{W}}}hanging')!='200':fail()
        if any(c.tag.rsplit('}',1)[-1] not in ('start','numFmt','suff','lvlText','lvlJc','pPr','lvlRestart') for c in item):fail()
