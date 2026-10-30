"""Editable rectangular text objects, shared HTML and native Word semantics."""
import math
import re

DEFAULTS = dict(width=240, minHeight=48, padding=8, borderWidth=1,
                borderColor='#253f60', fill='#ffffff', color='#000000',
                fontFamily='Cambria', fontSize=12, lineHeight=1.2,
                align='left', wrap='none', wrapGap=12)


def properties(attrs):
    from .image_wrapping import image_wrapping
    result = {**DEFAULTS, **attrs}
    for key, low, high in (('width',24,2000),('minHeight',0,2000),('padding',0,96),
                           ('borderWidth',0,12),('fontSize',6,72),('lineHeight',1,3)):
        value = result[key]
        if type(value) not in (int,float) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f'Invalid text box {key}.')
    if result['width'] <= 2*(result['padding']+result['borderWidth']):
        raise ValueError('The text box needs room for its text.')
    for key in ('borderColor','fill','color'):
        if not isinstance(result[key],str) or not re.fullmatch(r'#[\da-fA-F]{6}',result[key]):
            raise ValueError('Choose a text box colour.')
    if not isinstance(result['fontFamily'],str) or not re.fullmatch(r'[\w .,\-]{1,100}',result['fontFamily'],re.UNICODE):
        raise ValueError('Invalid text box font.')
    if result['align'] not in ('left','center','right','justify'):raise ValueError('Invalid text box alignment.')
    image_wrapping(result)
    return result


def validate(node):
    properties(node.get('attrs') or {})
    for child in node.get('content',[]):
        if child['type'] not in ('text','hard_break') or child.get('content'):
            raise ValueError('Text boxes contain formatted text and line breaks.')
        if any(mark['type'] not in ('strong','em','underline','strike','subscript','superscript','text_style','link','revision_insertion','revision_deletion','revision_format') for mark in child.get('marks',[])):
            raise ValueError('Unsupported text box formatting.')


def style(attrs):
    from .image_wrapping import wrapping_css
    a=properties(attrs)
    return (f'display:inline-block;box-sizing:border-box;vertical-align:top;max-width:100%;width:{a["width"]:g}px;'
            f'min-height:{a["minHeight"]:g}px;padding:{a["padding"]:g}px;border:{a["borderWidth"]:g}px solid {a["borderColor"]};'
            f'background:{a["fill"]};color:{a["color"]};font-family:\'{a["fontFamily"]}\';font-size:{a["fontSize"]:g}pt;'
            f'line-height:{a["lineHeight"]:g};text-align:{a["align"]};text-indent:0;white-space:pre-wrap;overflow-wrap:anywhere;'+wrapping_css(a))


WPS='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'


def write_word(paragraph, node, inline, geometry, counter):
    from lxml import etree
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.text.paragraph import Paragraph
    from .image_wrapping import write_word_wrapping
    from types import SimpleNamespace
    a=properties(node.get('attrs') or {})
    if not isinstance(geometry,dict) or any(type(geometry.get(k)) not in (int,float) or not math.isfinite(geometry[k]) or not 1<=geometry[k]<=10000 for k in ('width','height')):
        raise ValueError('Text boxes need measured desktop layout for Word export. Export from Alder.')
    width,height=(round(geometry[k]*9525) for k in ('width','height'))
    drawing=OxmlElement('w:drawing'); frame=OxmlElement('wp:inline');drawing.append(frame)
    extent=OxmlElement('wp:extent');extent.attrib.update(dict(cx=str(width),cy=str(height)));frame.append(extent)
    prop=OxmlElement('wp:docPr');prop.attrib.update(dict(id=str(counter),name=f'Alder text box {counter}'));frame.append(prop)
    graphic=OxmlElement('a:graphic');frame.append(graphic)
    data=OxmlElement('a:graphicData');data.set('uri',WPS);graphic.append(data)
    shape=etree.SubElement(data,f'{{{WPS}}}wsp',nsmap={'wps':WPS})
    nonvisual=etree.SubElement(shape,f'{{{WPS}}}cNvSpPr');nonvisual.set('txBox','1')
    sp=etree.SubElement(shape,f'{{{WPS}}}spPr')
    transform=OxmlElement('a:xfrm');sp.append(transform)
    off=OxmlElement('a:off');off.attrib.update(dict(x='0',y='0'));transform.append(off)
    size=OxmlElement('a:ext');size.attrib.update(dict(cx=str(width),cy=str(height)));transform.append(size)
    rect=OxmlElement('a:prstGeom');rect.set('prst','rect');rect.append(OxmlElement('a:avLst'));sp.append(rect)
    fill=OxmlElement('a:solidFill');colour=OxmlElement('a:srgbClr');colour.set('val',a['fill'][1:]);fill.append(colour);sp.append(fill)
    line=OxmlElement('a:ln');line.set('w',str(round(a['borderWidth']*9525)));sp.append(line)
    if a['borderWidth']:
        fill=OxmlElement('a:solidFill');colour=OxmlElement('a:srgbClr');colour.set('val',a['borderColor'][1:]);fill.append(colour);line.append(fill)
    else:line.append(OxmlElement('a:noFill'))
    txbx=etree.SubElement(shape,f'{{{WPS}}}txbx');body=OxmlElement('w:txbxContent');txbx.append(body)
    p=OxmlElement('w:p');body.append(p);story=Paragraph(p,paragraph._parent)
    from .docx_support import apply_paragraph_properties
    apply_paragraph_properties(story,dict(align=a['align'],spaceBefore=0,spaceAfter=0,lineHeight=a['lineHeight']),a['lineHeight'])
    for child in node.get('content',[]):
        inline(story,{**child,'marks':[{'type':'text_style','attrs':{k:a[k] for k in ('fontFamily','fontSize','color')}}]+child.get('marks',[])})
    bodypr=etree.SubElement(shape,f'{{{WPS}}}bodyPr')
    bodypr.attrib.update(dict(rot='0',vert='horz',wrap='square',anchor='t',anchorCtr='0',upright='1',
                         **{edge+'Ins':str(round((a['padding']+a['borderWidth']/2)*9525)) for edge in ('l','r','t','b')}))
    bodypr.append(OxmlElement('a:noAutofit'))
    paragraph.add_run()._r.append(drawing)
    write_word_wrapping(SimpleNamespace(_inline=frame),a)


def read_word(drawing, read_paragraph, parent, warnings):
    from docx.oxml.ns import qn
    from docx.text.paragraph import Paragraph
    from .image_wrapping import read_word_wrapping
    body=next(drawing.iter(qn('w:txbxContent')),None)
    if body is None:return None
    content=[]
    paragraphs=list(body.iter(qn('w:p')))
    for p in paragraphs:
        if content:content.append({'type':'hard_break'})
        node=read_paragraph(Paragraph(p,parent))
        for child in node.get('content',[]):
            if child['type'] in ('text','hard_break'):content.append(child)
            else:
                from .models import document_text
                text=document_text(child)
                if text:content.append({'type':'text','text':text})
                warnings.append('An unsupported object inside a Word text box was converted to text.')
    shape=next(drawing.iter(f'{{{WPS}}}wsp'),None)
    frame=next(drawing.iter(qn('wp:anchor')),None)
    wrapping=read_word_wrapping(frame)
    if shape is None or wrapping is None or next(body.iter(qn('w:tbl')),None) is not None:
        warnings.append('A Word text box with unsupported positioning or content was converted to formatted text.')
        return content
    transform=shape.find('.//'+qn('a:xfrm'))
    geometry=shape.find('.//'+qn('a:prstGeom'))
    if (transform is not None and transform.get('rot','0')!='0') or geometry is None or geometry.get('prst')!='rect':
        warnings.append('A rotated or nonrectangular Word text box was converted to formatted text.')
        return content
    extent=next(drawing.iter(qn('wp:extent')),None)
    props=shape.find(f'{{{WPS}}}spPr');bodypr=shape.find(f'{{{WPS}}}bodyPr')
    if extent is None or props is None or bodypr is None:return content
    try:
        a=properties({**(wrapping or {}),'width':float(extent.get('cx'))/9525,'minHeight':float(extent.get('cy'))/9525})
        line=props.find(qn('a:ln'));a['borderWidth']=float(line.get('w','0'))/9525 if line is not None else 0
        if line is not None and line.find(qn('a:noFill')) is not None:a['borderWidth']=0
        for owner,key in ((props,'fill'),(line,'borderColor')):
            colour=owner.find(qn('a:solidFill')+'/'+qn('a:srgbClr')) if owner is not None else None
            if colour is not None:a[key]='#'+colour.get('val')
        insets=[float(bodypr.get(edge+'Ins','0'))/9525 for edge in ('l','r','t','b')]
        if max(insets)-min(insets)>.1 or bodypr.get('vert','horz')!='horz':raise ValueError('Unsupported text direction or insets.')
        a['padding']=max(0,insets[0]-a['borderWidth']/2)
        if paragraphs:
            from .docx_support import paragraph_attributes
            first=paragraph_attributes(Paragraph(paragraphs[0],parent))
            a['align']=first.get('align','left');a['lineHeight']=first.get('lineHeight',1.2)
            for key in ('fontFamily','fontSize','color'):
                if first.get(key) is not None:a[key]=first[key]
        properties(a)
        if len(paragraphs)>1:warnings.append('Word text-box paragraphs were retained as formatted lines with uniform paragraph alignment.')
        node={'type':'text_box','attrs':a,'content':content};validate(node)
        return [node]
    except (ValueError,TypeError):
        warnings.append('A Word text box with unsupported properties was converted to formatted text.')
        return content
