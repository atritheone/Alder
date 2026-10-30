"""Inline content controls. Restrictions govern editing, not file security."""
from datetime import date
import re

DEFAULTS = dict(kind='plain', label='', tag='', lockContent=False, lockDelete=False,
                checked=False, dateValue='')
MARKS = {'strong','em','underline','strike','subscript','superscript','text_style','link'}


def properties(value):
    if not isinstance(value,dict): raise ValueError('Invalid form field properties.')
    a = {**DEFAULTS, **value}
    if a['kind'] not in ('plain','rich','checkbox','date'):
        raise ValueError('Choose a supported form field type.')
    for key in ('label','tag'):
        if not isinstance(a[key],str) or len(a[key]) > 200 or re.search(r'[\x00-\x1f]',a[key]):
            raise ValueError('Field names and tags must contain at most 200 printable characters.')
    for key in ('lockContent','lockDelete','checked'):
        if type(a[key]) is not bool: raise ValueError('Invalid form field setting.')
    value=a['dateValue']
    if not isinstance(value,str): raise ValueError('Choose a valid calendar date.')
    if value:
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value): raise ValueError('Choose a valid calendar date.')
        date.fromisoformat(value)
    return a


def field_value(a, content=None):
    if a['kind'] not in ('checkbox','date'): return content or []
    value = ('\u2612' if a['checked'] else '\u2610') if a['kind']=='checkbox' else a['dateValue']
    return [{'type':'text','text':value}] if value else []


def validate(node):
    a=properties(node.get('attrs') or {})
    content=node.get('content',[])
    if node['type']=='form_block':
        if a['kind']!='rich' or node.get('marks'):
            raise ValueError('A block form field contains rich text.')
        from .document_notes import validate_note
        try:validate_note({'kind':'footnote','body':{'type':'doc','content':content}})
        except ValueError as exc:raise ValueError('A rich text block contains formatted paragraphs, lists, tables and inline or standalone images.') from exc
        return a
    if any(not isinstance(n,dict) or n.get('type') not in ('text','hard_break') or n.get('content') or
           not isinstance(n.get('marks',[]),list) or
           any(a['kind']!='rich' or not isinstance(m,dict) or m.get('type') not in MARKS for m in n.get('marks',[])) for n in content):
        raise ValueError('Use text and line breaks in a form field; rich text can also contain formatting and links.')
    if a['kind'] in ('checkbox','date') and content != field_value(a):
        raise ValueError('The field value does not match its checkbox or date setting.')
    if any(not isinstance(m,dict) or not isinstance(m.get('type'),str) or m['type'].startswith('revision_') for m in node.get('marks',[])):
        raise ValueError('Form fields do not support tracked changes yet.')
    return a


W14='http://schemas.microsoft.com/office/word/2010/wordml'


def canonical_content(content):
    """HTML's legacy mark names use the same canonical form as the editor."""
    result=[]
    for node in content:
        node=dict(node)
        if node.get('marks'):
            node['marks']=[{**m,'type':{'textStyle':'text_style','bold':'strong','italic':'em'}.get(m['type'],m['type'])} for m in node['marks']]
        if 'content' in node:node['content']=canonical_content(node['content'])
        result.append(node)
    return result


def word_control(node, identifier):
    from lxml import etree
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    a=validate(node)
    sdt=OxmlElement('w:sdt');pr=OxmlElement('w:sdtPr');sdt.append(pr)
    for key,value in (('alias',a['label']),('tag',a['tag']),('id',str(identifier))):
        el=OxmlElement('w:'+key);el.set(qn('w:val'),value);pr.append(el)
    if a['lockContent'] or a['lockDelete']:
        lock=OxmlElement('w:lock');lock.set(qn('w:val'),
            'sdtContentLocked' if a['lockContent'] and a['lockDelete'] else 'contentLocked' if a['lockContent'] else 'sdtLocked');pr.append(lock)
    if a['kind']=='checkbox':
        check=etree.SubElement(pr,f'{{{W14}}}checkbox',nsmap={'w14':W14})
        for name,value in (('checked','1' if a['checked'] else '0'),('checkedState','2612'),('uncheckedState','2610')):
            el=etree.SubElement(check,f'{{{W14}}}{name}');el.set(f'{{{W14}}}val',value)
            if name!='checked':el.set(f'{{{W14}}}font','Segoe UI Symbol')
    elif a['kind']=='date':
        item=OxmlElement('w:date');pr.append(item)
        if a['dateValue']:item.set(qn('w:fullDate'),a['dateValue']+'T00:00:00Z')
        for name,value in (('dateFormat','yyyy-MM-dd'),('lid','en-US'),('storeMappedDataAs','dateTime'),('calendar','gregorian')):
            el=OxmlElement('w:'+name);el.set(qn('w:val'),value);item.append(el)
    else:
        item=OxmlElement('w:text' if a['kind']=='plain' else 'w:richText');pr.append(item)
        if a['kind']=='plain':item.set(qn('w:multiLine'),'1')
    body=OxmlElement('w:sdtContent');sdt.append(body)
    return sdt,body


def write_word(paragraph, node, inline, identifier):
    from docx.oxml import OxmlElement
    sdt,body=word_control(node,identifier)
    start=len(paragraph._p)
    for child in node.get('content',[]):inline(paragraph,{**child,'marks':node.get('marks',[])+child.get('marks',[])})
    for run in list(paragraph._p)[start:]:body.append(run)
    # Empty controls remain empty semantic content; Word supplies its own prompt.
    if not len(body):body.append(OxmlElement('w:r'))
    paragraph._p.append(sdt)


def write_word_block(container, node, block, identifier):
    from docx.oxml.ns import qn
    sdt,body=word_control(node,identifier)
    root=container._element.body if hasattr(container._element,'body') else container._element
    before=set(root)
    for child in node['content']:block(container,child)
    for child in list(root):
        if child not in before and child.tag!=qn('w:sectPr'):body.append(child)
    section=root.find(qn('w:sectPr'))
    if section is not None:section.addprevious(sdt)
    else:root.append(sdt)


def read_word(element, read_paragraph, parent, warnings, read_container=None):
    import copy
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.text.paragraph import Paragraph
    pr=element.find(qn('w:sdtPr'));body=element.find(qn('w:sdtContent'))
    if pr is None or body is None:return None
    known={qn('w:'+name) for name in ('alias','tag','id','lock','rPr','placeholder','showingPlcHdr','text','richText','date','temporary','dataBinding')}
    known.update({f'{{{W14}}}checkbox', '{http://schemas.microsoft.com/office/word/2012/wordml}appearance', '{http://schemas.microsoft.com/office/word/2012/wordml}color'})
    if any(child.tag not in known for child in pr) or any(n.tag==qn('w:sdt') for n in body.iter()):
        warnings.append('An unsupported or nested Word content control was converted to its current wording; its form behaviour is not retained.')
        return None
    if any(n.tag in (qn('w:ins'),qn('w:del'),qn('w:rPrChange')) for n in body.iter()):
        raise ValueError('Tracked changes inside a form field are not supported. Resolve them in the source file before importing; the source has been preserved.')
    a=properties({})
    for name,key in (('alias','label'),('tag','tag')):
        el=pr.find(qn('w:'+name))
        if el is not None:a[key]=el.get(qn('w:val'),'')
    lock=pr.find(qn('w:lock'))
    if lock is not None:
        value=lock.get(qn('w:val'),'unlocked')
        if value not in ('unlocked','sdtLocked','contentLocked','sdtContentLocked'):
            raise ValueError('This Word form has unsupported editing restrictions. Its source has been preserved.')
        a['lockContent']=value in ('contentLocked','sdtContentLocked');a['lockDelete']=value in ('sdtLocked','sdtContentLocked')
    is_block=any(child.tag in (qn('w:p'),qn('w:tbl')) for child in body)
    if is_block:
        if read_container is None:raise ValueError('A block control is not valid inside a Word paragraph.')
        from docx.blkcntnr import BlockItemContainer
        blocks=read_container(BlockItemContainer(body,parent))
        content=[]
    else:
        p=OxmlElement('w:p')
        for child in body:p.append(copy.deepcopy(child))
        content=read_paragraph(Paragraph(p,parent)).get('content',[])
    check=pr.find(f'{{{W14}}}checkbox');datum=pr.find(qn('w:date'))
    if check is not None:
        a['kind']='checkbox';checked=check.find(f'{{{W14}}}checked')
        a['checked']=checked is not None and checked.get(f'{{{W14}}}val','1') in ('1','true','on')
        if any((item:=check.find(f'{{{W14}}}{name}')) is not None and item.get(f'{{{W14}}}val','').upper()!=value for name,value in (('checkedState','2612'),('uncheckedState','2610'))):
            warnings.append('A Word checkbox uses standard checked/unchecked squares in Alder; its checked state is retained.')
    elif datum is not None:
        a['kind']='date';a['dateValue']=datum.get(qn('w:fullDate'),'')[:10]
        fmt=datum.find(qn('w:dateFormat'))
        if fmt is not None and fmt.get(qn('w:val'))!='yyyy-MM-dd':
            warnings.append('A Word date control uses ISO year-month-day display in Alder.')
    elif pr.find(qn('w:text')) is not None:a['kind']='plain'
    else:a['kind']='rich'
    if pr.find(qn('w:showingPlcHdr')) is not None:
        content=[]
        if is_block:blocks=[{'type':'paragraph'}]
    if pr.find(qn('w:dataBinding')) is not None or pr.find(qn('w:temporary')) is not None:
        warnings.append('Word XML binding or automatic control removal was not retained; the field remains editable locally.')
    if is_block and a['kind']=='rich':
        node={'type':'form_block','attrs':a,'content':blocks or [{'type':'paragraph'}]}
        validate(node)
        return node
    if is_block:
        if any(n['type']!='paragraph' for n in blocks):raise ValueError('This non-rich Word control contains unsupported block objects. The source has been preserved.')
        for p in blocks:
            if content:content.append({'type':'hard_break'})
            content.extend(p.get('content',[]))
        if len(blocks)>1:warnings.append('A non-rich block control keeps its text as line breaks within an inline field.')
    if a['kind']=='date':
        from .models import document_text
        displayed=''.join(document_text(n) for n in content).strip()
        if not a['dateValue'] and displayed:
            try:
                if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',displayed):raise ValueError()
                date.fromisoformat(displayed);a['dateValue']=displayed
            except ValueError:
                a['kind']='plain'
                warnings.append('A Word date control without a calendar value was retained as a plain text field to preserve its displayed wording.')
        elif displayed and displayed!=a['dateValue']:
            warnings.append('A Word date control uses ISO year-month-day display in Alder.')
    # Plain/date/checkbox controls may inherit run appearance, but do not own
    # independently formatted values. Keep the common appearance on the wrapper.
    marks=[]
    if a['kind']!='rich':
        text=[n for n in content if n['type']=='text']
        marks=text[0].get('marks',[]) if text else []
        if a['kind']=='plain' and any(n.get('marks',[])!=marks for n in text):
            a['kind']='rich';marks=[]
            warnings.append('A plain Word field with mixed formatting was retained as a rich text field.')
        else:content=[{k:v for k,v in n.items() if k!='marks'} for n in content]
    node={'type':'form_field','attrs':a,'content':field_value(a,content)}
    if marks:node['marks']=marks
    validate(node)
    return {'type':'paragraph','attrs':blocks[0].get('attrs',{}) if blocks else {},'content':[node]} if is_block else node
