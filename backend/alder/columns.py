"""Section column settings and native Word exchange."""
import math

def column_css(value):
    value=value or {'count':1,'gapMm':8}
    return f"column-count:{value['count']};column-gap:{value['gapMm']:g}mm;column-rule:{'0.5pt solid #888' if value.get('separator') else 'none'};column-fill:auto"

def validate_columns(value, geometry=None):
    if value is None:return
    if not isinstance(value,dict) or set(value)-{'count','gapMm','separator'}:raise ValueError('Invalid column settings.')
    count,gap=value.get('count'),value.get('gapMm')
    if type(count) is not int or not 1<=count<=12 or type(gap) not in (int,float) or not math.isfinite(gap) or not 0<=gap<=100 or ('separator' in value and type(value['separator']) is not bool):raise ValueError('Use 1–12 columns with a gap of 0–100 mm.')
    if geometry and (geometry['width']-geometry['margins']['left']-geometry['margins']['right']-gap*(count-1))/count<20:raise ValueError('Each column needs at least 20 mm of writing width. Use fewer columns, a smaller gap or wider paper.')

def write_columns(section,value):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    value=value or {'count':1,'gapMm':8}
    for old in section._sectPr.findall(qn('w:cols')):section._sectPr.remove(old)
    element=OxmlElement('w:cols')
    for key,val in [('num',str(value['count'])),('space',str(round(value['gapMm']*1440/25.4))),('equalWidth','1'),('sep','1' if value.get('separator') else '0')]:element.set(qn('w:'+key),val)
    section._sectPr.append(element)

def read_columns(section,warnings):
    from docx.oxml.ns import qn
    element=section._sectPr.find(qn('w:cols'))
    if element is None:return None
    try:
        count=int(element.get(qn('w:num'),'1'));gap=int(element.get(qn('w:space'),'720'))*25.4/1440
        children=element.findall(qn('w:col'))
        if element.get(qn('w:equalWidth'),'1') in ('0','false','off') and children:
            count=len(children);gap=sum(int(c.get(qn('w:space'),'0')) for c in children[:-1])/max(1,count-1)*25.4/1440
            warnings.append('Unequal Word columns were converted to equal widths. Retain the original for its exact column geometry.')
        result={'count':count,'gapMm':gap,'separator':element.get(qn('w:sep'),'0') not in ('0','false','off')}
        validate_columns(result);return result
    except (ValueError,TypeError):
        warnings.append('Unsupported Word column settings were converted to one column.');return None
