"""Nine-level native numbering templates, independent of authored prose."""
import json
import math
import re
from .list_formatting import NUMBER_FORMATS, BULLETS, list_marker


def validate_list_template(template):
    if not isinstance(template,list) or len(template)!=9:raise ValueError('An outline list requires nine numbering levels.')
    for level,spec in enumerate(template):
        if not isinstance(spec,dict) or set(spec)!={'format','pattern','start','restart','indent','hanging'}:raise ValueError('Invalid outline numbering level.')
        if spec['format'] not in {*NUMBER_FORMATS,*BULLETS}:raise ValueError('Unsupported outline number format.')
        pattern=spec['pattern']
        if not isinstance(pattern,str) or not 1<=len(pattern)<=80 or re.search(r'[\x00-\x1f]',pattern):raise ValueError('A numbering pattern needs 1–80 printable characters.')
        if any(int(n)<1 or int(n)>level+1 or spec['format'] in BULLETS for n in re.findall(r'%(\d)',pattern)):raise ValueError('A number pattern can include only its own or earlier levels.')
        if type(spec['start']) is not int or not 1<=spec['start']<=100000:raise ValueError('Invalid outline start number.')
        if type(spec['restart']) is not int or not 0<=spec['restart']<=level:raise ValueError('Invalid outline restart level.')
        for key in ('indent','hanging'):
            if type(spec[key]) not in (int,float) or not math.isfinite(spec[key]) or not 0<=spec[key]<=(288 if key=='indent' else min(144,spec['indent'])):raise ValueError('Invalid outline list indentation.')


def next_label(template,counts,level):
    spec=template[level]
    counts[level]=spec['start'] if counts[level] is None else counts[level]+1
    for i in range(level+1,9):
        if template[i]['restart'] and level<template[i]['restart']:counts[i]=None
    def number(match):
        index=int(match[1])-1
        return list_marker(counts[index] if counts[index] is not None else template[index]['start'],template[index]['format']) if index<=level else ''
    return re.sub(r'%([1-9])',number,spec['pattern'])


def outline_layout(document):
    """Return list/first-paragraph records without mutating source content."""
    result=[]
    def scope(parent):
        previous={}
        for node in parent.get('content',[]):
            attrs=node.get('attrs',{});template=attrs.get('listTemplate')
            if node.get('type') in ('ordered_list','bullet_list') and template is not None:
                validate_list_template(template)
                key=json.dumps(template,sort_keys=True,separators=(',',':'))
                predecessor=previous.get(key) if attrs.get('continuePrevious') else None
                counts=predecessor['counts'][:] if predecessor else [None]*9
                if not predecessor:counts[0]=attrs.get('order',template[0]['start'])-1
                root={'root':node,'template':template,'previous':predecessor['node'] if predecessor else None}
                def visit(listing,level):
                    if level>=9:raise ValueError('Outline lists support up to nine levels.')
                    record={**root,'node':listing,'level':level,'items':[]};result.append(record)
                    for item in listing.get('content',[]):
                        label=next_label(template,counts,level)
                        content=item.get('content',[])
                        if content:record['items'].append({'node':content[0],'label':label,'number':counts[level],'counts':counts[:]})
                        def nested(child):
                            if child.get('type') in ('table_cell','table_header'):scope(child)
                            elif child.get('type') in ('ordered_list','bullet_list'):visit(child,level+1)
                            else:
                                for descendant in child.get('content',[]):nested(descendant)
                        for child in content:nested(child)
                visit(node,0);previous[key]={'node':node,'counts':counts[:]}
            else:scope(node)
    scope(document)
    return result


def paint_outline_labels(document):
    """Export-only labels/geometry on the detached publication snapshot."""
    for record in outline_layout(document):
        level=record['level'];template=record['template'];spec=template[level]
        record['node'].setdefault('attrs',{})['_outlineIndent']=spec['indent']-(template[level-1]['indent'] if level else 0)
        for item in record['items']:
            item['node'].setdefault('attrs',{}).update(_outlineLabel=item['label'],_outlineHanging=spec['hanging'])


def word_outline_bindings(document,sections):
    from .docx_support import NumberingWriter
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    writer=NumberingWriter(document);numbers={};bindings={};lists={}
    for section in sections:
        for record in outline_layout({'type':'doc','content':section['blocks']}):
            root=record['root'];template=record['template'];level=record['level']
            if level==0:
                number=numbers.get(id(record['previous']))
                if number is None:
                    number=writer.create(True)
                    instance=next(n for n in writer.root.findall(qn('w:num')) if int(n.get(qn('w:numId')))==number)
                    abstract_id=instance.find(qn('w:abstractNumId')).get(qn('w:val'))
                    abstract=next(n for n in writer.root.findall(qn('w:abstractNum')) if n.get(qn('w:abstractNumId'))==abstract_id)
                    kind=OxmlElement('w:multiLevelType');kind.set(qn('w:val'),'multilevel');abstract.insert(0,kind)
                    for i,spec in enumerate(template):
                        element=abstract.findall(qn('w:lvl'))[i]
                        for child in list(element):element.remove(child)
                        for name,value in [('start',root.get('attrs',{}).get('order',spec['start']) if i==0 else spec['start']),('numFmt',NUMBER_FORMATS.get(spec['format'],'bullet')),('lvlRestart',spec['restart']),('suff','space'),('lvlText',spec['pattern']),('lvlJc','left')]:
                            # The parent-level restart is implicit. Word drops
                            # some levels when it is redundantly explicit.
                            if name=='lvlRestart' and value==i:continue
                            child=OxmlElement('w:'+name);element.append(child)
                            child.set(qn('w:val'),str(value))
                        props=OxmlElement('w:pPr');element.append(props);indent=OxmlElement('w:ind');props.append(indent)
                        indent.set(qn('w:left'),str(round(spec['indent']*20)));indent.set(qn('w:hanging'),str(round(spec['hanging']*20)))
                numbers[id(root)]=number
            number=numbers[id(root)];lists[id(record['node'])]=record
            for item in record['items']:bindings[id(item['node'])]=(number,level,template[level])
    return bindings,lists


def read_word_template(reader,number):
    from docx.oxml.ns import qn
    cache=getattr(reader,'_outline_templates',None)
    if cache is None:cache=reader._outline_templates={}
    if number in cache:return cache[number]
    cache[number]=None
    instance=next((n for n in reader.root.findall(qn('w:num')) if n.get(qn('w:numId'))==str(number)),None)
    if instance is None:return None
    identity=instance.find(qn('w:abstractNumId'))
    if identity is None:return None
    abstract=next((n for n in reader.root.findall(qn('w:abstractNum')) if n.get(qn('w:abstractNumId'))==identity.get(qn('w:val'))),None)
    if abstract is None:return None
    multi=abstract.find(qn('w:multiLevelType'))
    if multi is None or multi.get(qn('w:val'))!='multilevel':return None
    def value(node,name,default=None):
        child=node.find(qn('w:'+name));return child.get(qn('w:val')) if child is not None else default
    template=[]
    try:
        for level in range(9):
            spec=next((n for n in abstract.findall(qn('w:lvl')) if n.get(qn('w:ilvl'))==str(level)),None)
            if spec is None or value(spec,'suff','tab')!='space' or value(spec,'lvlJc','left')!='left' or any(spec.find(qn('w:'+key)) is not None for key in ('isLgl','lvlPicBulletId','pStyle')):return None
            fmt=value(spec,'numFmt');pattern=value(spec,'lvlText','')
            marker=next((key for key,v in NUMBER_FORMATS.items() if v==fmt),None)
            if fmt=='bullet':marker=next((key for key,v in BULLETS.items() if v==pattern),'disc')
            if marker is None:return None
            indent=spec.find('./'+qn('w:pPr')+'/'+qn('w:ind'))
            override=next((n for n in instance.findall(qn('w:lvlOverride')) if n.get(qn('w:ilvl'))==str(level)),None)
            if override is not None and override.find(qn('w:lvl')) is not None:return None
            start=int(value(override,'startOverride',value(spec,'start','1'))) if override is not None else int(value(spec,'start','1'))
            template.append({'format':marker,'pattern':pattern,'start':start,'restart':int(value(spec,'lvlRestart',str(level))),'indent':int(indent.get(qn('w:left'),'0'))/20 if indent is not None else 0,'hanging':int(indent.get(qn('w:hanging'),'0'))/20 if indent is not None else 0})
        validate_list_template(template)
    except (TypeError,ValueError):return None
    cache[number]=template;return template
