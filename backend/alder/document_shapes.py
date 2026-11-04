"""Small editable, inline DrawingML shapes; no executable or imported SVG."""
import html
import json
import math
import re

KINDS={'rectangle':'rect','triangle':'triangle','diamond':'diamond','line':'line','arrow':'rightArrow'}
DEFAULTS=dict(kind='rectangle',width=160,height=80,strokeWidth=1,stroke='#253f60',fill='#ffffff',alt='',decorative=False)
WPS='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'

def properties(value):
    if any(key not in DEFAULTS and key!='blockId' for key in value):raise ValueError('Unsupported shape property.')
    a={**DEFAULTS,**value}
    if not isinstance(a['kind'],str) or a['kind'] not in KINDS:raise ValueError('Choose a supported shape.')
    for key,low,high in (('width',8,2000),('height',8,2000),('strokeWidth',0,12)):
        if type(a[key]) not in (int,float) or not math.isfinite(a[key]) or not low<=a[key]<=high:raise ValueError('Invalid shape '+key+'.')
    if a['strokeWidth']>=min(a['width'],a['height']):raise ValueError('The outline is too thick for this shape.')
    for key in ('stroke','fill'):
        if not (key=='fill' and a[key]=='none') and (not isinstance(a[key],str) or not re.fullmatch(r'#[\da-fA-F]{6}',a[key])):raise ValueError('Choose a shape colour.')
    if not isinstance(a['alt'],str) or len(a['alt'])>4096 or type(a['decorative']) is not bool:raise ValueError('Invalid shape description.')
    return a

def path(value):
    a=properties(value);s=a['strokeWidth']/2;w=a['width']-2*s;h=a['height']-2*s
    if a['kind']=='line':points=[(s,s+h/2),(s+w,s+h/2)]
    elif a['kind']=='triangle':points=[(s+w/2,s),(s+w,s+h),(s,s+h)]
    elif a['kind']=='diamond':points=[(s+w/2,s),(s+w,s+h/2),(s+w/2,s+h),(s,s+h/2)]
    elif a['kind']=='arrow':
        head=min(w,h)/2;points=[(s,s+h/4),(s+w-head,s+h/4),(s+w-head,s),(s+w,s+h/2),(s+w-head,s+h),(s+w-head,s+3*h/4),(s,s+3*h/4)]
    else:points=[(s,s),(s+w,s),(s+w,s+h),(s,s+h)]
    return ' '.join(('M' if i==0 else 'L')+f'{x:g} {y:g}' for i,(x,y) in enumerate(points))+('' if a['kind']=='line' else ' Z')

def to_html(value):
    a=properties(value);meta=html.escape(json.dumps(a),quote=True)
    accessible='role="presentation" aria-hidden="true"' if a['decorative'] else 'role="img" aria-label="'+html.escape(a['alt'] or a['kind']+' shape',quote=True)+'"'
    fill='none' if a['kind']=='line' else a['fill']
    return f'<span data-document-shape="{meta}" {accessible} style="display:inline-block;vertical-align:baseline;width:{a["width"]:g}px;height:{a["height"]:g}px;line-height:0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {a["width"]:g} {a["height"]:g}" width="{a["width"]:g}" height="{a["height"]:g}" style="display:block;overflow:visible"><path d="{path(a)}" fill="{fill}" stroke="{a["stroke"]}" stroke-width="{a["strokeWidth"]:g}" stroke-linejoin="miter" stroke-linecap="butt"/></svg></span>'

def write_word(paragraph,value,counter):
    from docx.oxml import OxmlElement
    from lxml import etree as E
    from .image_accessibility import write_decorative
    a=properties(value);width,height=(round(a[k]*9525) for k in ('width','height'))
    drawing=OxmlElement('w:drawing');frame=OxmlElement('wp:inline');drawing.append(frame)
    extent=OxmlElement('wp:extent');extent.attrib.update(dict(cx=str(width),cy=str(height)));frame.append(extent)
    props=OxmlElement('wp:docPr');props.attrib.update(dict(id=str(counter),name=f'Alder shape {counter}',descr=a['alt']));frame.append(props);write_decorative(props,a['decorative'])
    graphic=OxmlElement('a:graphic');frame.append(graphic);data=OxmlElement('a:graphicData');data.set('uri',WPS);graphic.append(data)
    shape=E.SubElement(data,f'{{{WPS}}}wsp',nsmap={'wps':WPS});E.SubElement(shape,f'{{{WPS}}}cNvSpPr')
    sp=E.SubElement(shape,f'{{{WPS}}}spPr');transform=OxmlElement('a:xfrm');sp.append(transform)
    offset=OxmlElement('a:off');offset.attrib.update(dict(x='0',y='0'));transform.append(offset)
    ext=OxmlElement('a:ext');ext.attrib.update(dict(cx=str(width),cy=str(height)));transform.append(ext)
    if a['kind']=='line':
        # Word replaces a zero-height line transform with its inline frame's
        # height. An editable two-point path retains the horizontal direction.
        geometry=OxmlElement('a:custGeom')
        for tag in ('avLst','gdLst','ahLst','cxnLst'):geometry.append(OxmlElement('a:'+tag))
        rect=OxmlElement('a:rect');rect.attrib.update(dict(l='0',t='0',r='r',b='b'));geometry.append(rect)
        paths=OxmlElement('a:pathLst');geometry.append(paths);path=OxmlElement('a:path');path.attrib.update(dict(w='100000',h='100000',fill='none'));paths.append(path)
        for tag,x in (('moveTo','0'),('lnTo','100000')):
            step=OxmlElement('a:'+tag);point=OxmlElement('a:pt');point.attrib.update(dict(x=x,y='50000'));step.append(point);path.append(step)
    else:
        geometry=OxmlElement('a:prstGeom');geometry.set('prst',KINDS[a['kind']]);geometry.append(OxmlElement('a:avLst'))
    sp.append(geometry)
    def colour(parent,value):
        if value=='none':parent.append(OxmlElement('a:noFill'));return
        solid=OxmlElement('a:solidFill');rgb=OxmlElement('a:srgbClr');rgb.set('val',value.lstrip('#'));solid.append(rgb);parent.append(solid)
    colour(sp,'none' if a['kind']=='line' else a['fill'])
    line=OxmlElement('a:ln');line.set('w',str(round(a['strokeWidth']*9525)));line.set('cap','flat');sp.append(line);colour(line,a['stroke'] if a['strokeWidth'] else 'none')
    line.append(OxmlElement('a:miter'));E.SubElement(shape,f'{{{WPS}}}bodyPr')
    paragraph.add_run()._r.append(drawing)

def read_word(drawing):
    from docx.oxml.ns import qn
    from .image_accessibility import read_decorative
    shape=next(drawing.iter(f'{{{WPS}}}wsp'),None)
    if shape is None or next(drawing.iter(qn('w:txbxContent')),None) is not None:return None
    def fail():raise ValueError('This Word shape uses unsupported geometry or positioning. The original file has not been changed.')
    frame=next(drawing.iter(qn('wp:inline')),None);sp=shape.find(f'{{{WPS}}}spPr')
    if frame is None or sp is None:fail()
    graphics=list(drawing.iter(qn('a:graphicData')))
    if len(graphics)!=1 or graphics[0].get('uri')!=WPS or len(graphics[0])!=1 or graphics[0][0] is not shape:fail()
    geometry=sp.find(qn('a:prstGeom'));transform=sp.find(qn('a:xfrm'));extent=frame.find(qn('wp:extent'));props=frame.find(qn('wp:docPr'))
    custom=sp.find(qn('a:custGeom'));kind=None
    if custom is not None:
        paths=custom.find(qn('a:pathLst'))
        if paths is None or len(paths)!=1:fail()
        path=paths[0];steps=list(path)
        if path.get('w')!='100000' or path.get('h')!='100000' or len(steps)!=2:fail()
        for step,tag,x in zip(steps,('moveTo','lnTo'),('0','100000')):
            point=step.find(qn('a:pt'))
            if step.tag!=qn('a:'+tag) or point is None or point.get('x')!=x or point.get('y')!='50000':fail()
        if any(len(c) for c in custom if c.tag not in (qn('a:pathLst'),qn('a:rect'))):fail()
        kind='line'
    elif geometry is not None and geometry.get('prst') in KINDS.values() and geometry.get('prst')!='line':
        if any(len(c) for c in geometry):fail()
        kind=next(k for k,v in KINDS.items() if v==geometry.get('prst'))
    if not kind or extent is None:fail()
    if transform is not None:
        if any(transform.get(k,'0') not in ('0','false') for k in ('rot','flipH','flipV')):fail()
        off=transform.find(qn('a:off'));ext=transform.find(qn('a:ext'))
        if off is not None and any(float(off.get(k,'0'))!=0 for k in ('x','y')):fail()
        if ext is not None and any(abs(float(ext.get(k,'0'))-float(extent.get(k,'0')))>1 for k in ('cx','cy')):fail()
    if any(sp.find(qn('a:'+tag)) is not None for tag in ('gradFill','blipFill','pattFill','effectLst','effectDag','scene3d','sp3d')):fail()
    def colour(parent,default):
        if parent is None:return default
        if parent.find(qn('a:noFill')) is not None:return 'none'
        fill=parent.find(qn('a:solidFill'))
        if fill is None:return default
        rgb=fill.find(qn('a:srgbClr'))
        if rgb is None or len(rgb):fail()
        return '#'+rgb.get('val','')
    line=sp.find(qn('a:ln'));stroke=colour(line,DEFAULTS['stroke'])
    if line is not None and (line.find(qn('a:headEnd')) is not None or line.find(qn('a:tailEnd')) is not None or line.find(qn('a:prstDash')) is not None):fail()
    a=properties(dict(kind=kind,width=float(extent.get('cx'))/9525,height=float(extent.get('cy'))/9525,strokeWidth=0 if stroke=='none' else float(line.get('w','9525'))/9525 if line is not None else 1,stroke=DEFAULTS['stroke'] if stroke=='none' else stroke,fill=colour(sp,'none'),alt=props.get('descr','') if props is not None else '',decorative=read_decorative(props)))
    return {'type':'shape','attrs':a}


def validate_word_bounds(sections,settings,styles):
    """Bound simple fixed-size drawings; complex containers need desktop geometry."""
    from .page_geometry import page_geometry
    if settings.get('measuredRowSplits') is not None:return
    page=settings
    named={style['id']:style for style in styles}
    def walk(node,complex_container=False):
        nonlocal page
        kind=node['type'];attrs=node.get('attrs',{})
        if kind=='section_break':page=attrs.get('page',{});return
        if kind=='shape':
            if complex_container:raise ValueError('Use desktop DOCX export to check shapes inside lists, tables or other containers.')
            g=page_geometry(page);columns=page.get('columns') or {};count=columns.get('count',1);gap=columns.get('gapMm',8)
            width=(g['width']-g['margins']['left']-g['margins']['right']-gap*(count-1))/count*96/25.4
            height=(g['height']-g['margins']['top']-g['margins']['bottom'])*96/25.4
            if attrs.get('width',160)>width+1 or attrs.get('height',80)>height+1:raise ValueError('A shape is too large for its page or column. Resize it before Word export.')
        paragraph={**named.get(attrs.get('styleId'),{}),**{k:v for k,v in attrs.items() if v is not None}}
        restricted=complex_container or kind not in ('doc','paragraph','heading','shape','text') or any(paragraph.get(k) for k in ('leftIndent','rightIndent','firstLineIndent'))
        for child in node.get('content',[]):walk(child,restricted)
    for section in sections:
        for node in section['blocks']:walk(node)
