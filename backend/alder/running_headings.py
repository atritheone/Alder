"""Bind semantic heading fields to Word's actual paragraph styles."""
import re


def heading_text(node):
    from .document_fields import is_heading_field
    from .models import document_text
    def clean(value):
        if value.get('type')=='document_field' and is_heading_field(value.get('attrs',{}).get('fieldKind')):return {'type':'text','text':''}
        return {**value,'content':[clean(child) for child in value['content']]} if 'content' in value else value
    return re.sub(r'\s+',' ',document_text(clean(node))).strip()


def refresh_body_headings(sections,warnings):
    """Body STYLEREF needs document order, not a page calculation."""
    from .document_fields import is_heading_field
    from .document_comments import walk
    nodes=[]
    for section in sections:
        if section['title']:nodes.append({'type':'heading','attrs':{'level':1},'content':[{'type':'text','text':section['title']}]})
        nodes.extend(n for block in section['blocks'] for n in walk(block) if n.get('type')!='table_of_contents')
    headings={level:[] for level in range(1,7)}
    for i,node in enumerate(nodes):
        if node.get('type')=='heading':headings[int(node.get('attrs',{}).get('level',1))].append((i,heading_text(node)))
    latest={}
    for i,node in enumerate(nodes):
        if node.get('type')=='heading': latest[int(node.get('attrs',{}).get('level',1))]=heading_text(node)
        kind=node.get('attrs',{}).get('fieldKind')
        if node.get('type')!='document_field' or not is_heading_field(kind):continue
        level=int(kind[-1]); value=latest.get(level,headings[level][0][1] if headings[level] else None)
        node['attrs']['unresolved']=value is None
        if value is not None:node['content']=[{'type':'text','text':value}] if value else []
        else:
            message=f'A Heading {level} field has no matching heading. Its last visible value is retained.'
            if message not in warnings:warnings.append(message)
    return {level:items[0][1] for level,items in headings.items() if items}


def export_heading_styles(sections, settings, style_ids):
    from .document_fields import is_heading_field
    from .document_comments import walk
    from .running_matter import stories
    used = set()
    styles = {level:set() for level in range(1,7)}
    usage = {}
    def fields(node):
        for child in walk(node):
            kind = child.get('attrs',{}).get('fieldKind')
            if child.get('type')=='document_field' and is_heading_field(kind): used.add(kind)
    for story in stories(settings.get('runningMatter')): fields(story)
    for section in sections:
        if section['title']:
            styles[1].add('1');usage.setdefault('1',set()).add(1)
        for block in section['blocks']:
            fields(block)
            for node in walk(block):
                attrs=node.get('attrs',{})
                for story in stories(attrs.get('runningMatter')): fields(story)
                if node['type'] not in ('paragraph','heading','code_block'):continue
                level=int(attrs.get('level',1)) if node['type']=='heading' else 0
                style=style_ids.get(attrs.get('styleId')) or (str(level) if level else 'Normal')
                usage.setdefault(style,set()).add(level)
                if level:styles[level].add(style)
    result={}
    for kind in used:
        level=int(kind[-1]); targets=styles[level]
        if len(targets)>1 or any(usage[target]!={level} for target in targets):
            raise ValueError(f'Word can update a Heading {level} field only when those headings use one paragraph style that is not shared with other text. Give these headings the same dedicated style before exporting to DOCX.')
        target=next(iter(targets),str(level))
        if '"' in target or '\\' in target:
            raise ValueError('Remove quotes and backslashes from the heading style name before exporting its running-heading field to DOCX.')
        result[kind]=target
    return result


def import_heading_styles(document):
    from docx.oxml.ns import qn
    from docx.text.paragraph import Paragraph
    usage={}
    for element in document._element.body.iter(qn('w:p')):
        paragraph=Paragraph(element,document)
        style=paragraph.style
        level=0
        outline=element.find('./'+qn('w:pPr')+'/'+qn('w:outlineLvl'))
        current=style
        seen=set()
        while outline is None and current is not None and current.style_id not in seen:
            seen.add(current.style_id)
            outline=current.element.find('./'+qn('w:pPr')+'/'+qn('w:outlineLvl'))
            current=current.base_style
        if outline is not None:
            try:level=int(outline.get(qn('w:val')))+1
            except (ValueError,TypeError):pass
        if not 1<=level<=6:
            match=re.fullmatch(r'Heading ([1-6])',style.name,re.I)
            level=int(match[1]) if match else 0
        usage.setdefault(style.name.casefold(),set()).add(level)
    by_level={level:{name for name,levels in usage.items() if level in levels} for level in range(1,7)}
    result={}
    for level,names in by_level.items():
        if not names or names=={f'heading {level}'}:result[str(level)]='heading'+str(level)
        if len(names)==1:
            name=next(iter(names))
            if usage[name]=={level}:result[name]='heading'+str(level)
    return result
