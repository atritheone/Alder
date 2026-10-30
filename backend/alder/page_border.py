"""Uniform page-edge borders, distinct from paragraph borders and body margins."""
import math
import re


def validate_page_border(value):
    if value is None:return
    if not isinstance(value,dict) or set(value)!={'style','width','color','distance','display'}:
        raise ValueError('Invalid page border.')
    if value['style'] not in ('single','double','dashed','dotted') or value['display'] not in ('allPages','firstPage','notFirstPage'):
        raise ValueError('Invalid page border style or page choice.')
    width=value['width'];distance=value['distance']
    if type(width) not in (int,float) or not math.isfinite(width) or not .25<=width<=6 or width*8!=int(width*8):
        raise ValueError('Page border width must be 0.25–6 points in eighth-point increments.')
    if type(distance) not in (int,float) or not math.isfinite(distance) or distance!=int(distance) or not 0<=distance<=31:
        raise ValueError('Page border distance must be 0–31 whole points.')
    if not isinstance(value['color'],str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',value['color']):
        raise ValueError('Invalid page border colour.')


def write_page_border(section,value):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    props=section._sectPr
    for old in props.findall(qn('w:pgBorders')):props.remove(old)
    if value is None:return
    validate_page_border(value)
    borders=OxmlElement('w:pgBorders');borders.set(qn('w:offsetFrom'),'page');borders.set(qn('w:display'),value['display']);borders.set(qn('w:zOrder'),'back')
    for side in ('top','left','bottom','right'):
        edge=OxmlElement('w:'+side)
        for key,val in {'val':value['style'],'sz':int(value['width']*8),'space':int(value['distance']),'color':value['color'][1:]}.items():edge.set(qn('w:'+key),str(val))
        borders.append(edge)
    props.insert_element_before(borders,'w:lnNumType','w:pgNumType','w:cols','w:formProt','w:vAlign','w:noEndnote','w:titlePg','w:textDirection','w:bidi','w:rtlGutter','w:docGrid')


def read_page_border(section,warnings):
    from docx.oxml.ns import qn
    borders=section._sectPr.find(qn('w:pgBorders'))
    if borders is None:return None
    edges=[borders.find(qn('w:'+side)) for side in ('top','left','bottom','right')]
    if all(edge is None or edge.get(qn('w:val')) in ('nil','none') for edge in edges):return None
    try:
        if borders.get(qn('w:offsetFrom'),'text')!='page' or any(edge is None for edge in edges):raise ValueError()
        values=[]
        for edge in edges:
            if any(edge.get(qn('w:'+key)) not in (None,'0','false','off') for key in ('shadow','frame')):raise ValueError()
            if any(edge.get(qn('w:'+key)) is not None for key in ('themeColor','themeTint','themeShade','id')):raise ValueError()
            color=edge.get(qn('w:color'),'auto')
            value={'style':edge.get(qn('w:val')),'width':int(edge.get(qn('w:sz'),'8'))/8,
                   'distance':int(edge.get(qn('w:space'),'0')),'color':'#000000' if color=='auto' else '#'+color.lower(),
                   'display':borders.get(qn('w:display'),'allPages')}
            validate_page_border(value);values.append(value)
        if any(value!=values[0] for value in values):raise ValueError()
        return values[0]
    except (ValueError,TypeError):
        warnings.append('DOCX page borders with unequal sides, art, text-relative offsets or unsupported effects were omitted; the original file is unchanged.')
        return None


def draw_page_border(canvas,size,border,is_first):
    if not border or border['display']=='firstPage' and not is_first or border['display']=='notFirstPage' and is_first:return
    from reportlab.lib.colors import HexColor
    canvas.saveState();canvas.setStrokeColor(HexColor(border['color']))
    width=border['width'];distance=border['distance'];style=border['style']
    if style=='dashed':canvas.setDash([width*3,width*2])
    elif style=='dotted':canvas.setDash([width,width])
    def stroke(inset,thickness):
        canvas.setLineWidth(thickness);canvas.rect(inset,inset,max(0,size[0]-2*inset),max(0,size[1]-2*inset),stroke=1,fill=0)
    if style=='double':stroke(distance+width/2,width);stroke(distance+5*width/2,width)
    else:stroke(distance+width/2,width)
    canvas.restoreState()
