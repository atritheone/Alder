"""Keep an editable Word table inside its enclosing Alder list item."""
import re
from .document_revisions import W
PREFIX='AlderListTable:'


def wrap_table(table,level):
    from docx.oxml import OxmlElement
    element=table._tbl;parent=element.getparent();position=parent.index(element)
    wrapper=OxmlElement('w:sdt');properties=OxmlElement('w:sdtPr');wrapper.append(properties)
    tag=OxmlElement('w:tag');tag.set(f'{{{W}}}val',PREFIX+str(level));properties.append(tag)
    alias=OxmlElement('w:alias');alias.set(f'{{{W}}}val','List item table');properties.append(alias)
    content=OxmlElement('w:sdtContent');wrapper.append(content);content.append(element);parent.insert(position,wrapper)


def boundary(wrapper):
    tag=wrapper.find(f'{{{W}}}sdtPr/{{{W}}}tag')
    name=tag.get(f'{{{W}}}val','') if tag is not None else ''
    if not name.startswith(PREFIX):return None
    def fail():raise ValueError('This Word list table has incomplete or changed boundaries. The original file has not been changed.')
    if not re.fullmatch(re.escape(PREFIX)+r'[0-8]',name):fail()
    props=wrapper.find(f'{{{W}}}sdtPr');lock=props.find(f'{{{W}}}lock')
    if props.find(f'{{{W}}}dataBinding') is not None or lock is not None and lock.get(f'{{{W}}}val')!='unlocked':fail()
    content=wrapper.find(f'{{{W}}}sdtContent')
    if content is None:fail()
    return int(name[len(PREFIX):]),content


def read_table(wrapper):
    result=boundary(wrapper)
    if result is None:return None
    level,content=result
    if len(content)!=1 or content[0].tag!=f'{{{W}}}tbl':raise ValueError('This Word list table has changed its contents. The original file has not been changed.')
    return level,content[0]


def lift_table(table):
    """Word's review decisions relocate a whole-table control around its rows."""
    wrappers=[(child,boundary(child)) for child in table if child.tag==f'{{{W}}}sdt']
    wrappers=[pair for pair in wrappers if pair[1] is not None]
    if not wrappers:return None
    wrapper,(level,content)=wrappers[0]
    if len(wrappers)!=1 or any(child is not wrapper and child.tag not in (f'{{{W}}}tblPr',f'{{{W}}}tblGrid') for child in table) or not len(content) or any(child.tag!=f'{{{W}}}tr' for child in content):
        raise ValueError('This Word list-table boundary covers only part of the table. The original file has not been changed.')
    position=table.index(wrapper)
    for index,row in enumerate(list(content)):table.insert(position+index,row)
    table.remove(wrapper)
    return level
