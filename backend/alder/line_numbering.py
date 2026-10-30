"""Optional physical line labels. They never become authored text."""
import math
def validate_line_numbering(value):
    if value is None:return
    if not isinstance(value,dict) or set(value)!={'start','step','distance','restart'}:raise ValueError('Invalid line numbering.')
    for key,maximum in (('start',32767),('step',1000)):
        if type(value[key]) is not int or not 1<=value[key]<=maximum:raise ValueError('Invalid line-number start or interval.')
    if type(value['distance']) not in (int,float) or not math.isfinite(value['distance']) or not 0<=value['distance']<=100:raise ValueError('Line-number distance must be 0–100 points.')
    if value['restart'] not in ('newPage','newSection','continuous'):raise ValueError('Invalid line-number restart rule.')

def write_line_numbering(section,value):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    props=section._sectPr
    for old in props.findall(qn('w:lnNumType')):props.remove(old)
    if value is None:return
    validate_line_numbering(value);item=OxmlElement('w:lnNumType')
    # Word's start is the number of labels skipped before the first line.
    for k,v in {'start':value['start']-1,'countBy':value['step'],'distance':round(value['distance']*20),'restart':value['restart']}.items():item.set(qn('w:'+k),str(v))
    props.insert_element_before(item,'w:pgNumType','w:cols','w:formProt','w:vAlign','w:noEndnote','w:titlePg','w:textDirection','w:bidi','w:rtlGutter','w:docGrid')

def read_line_numbering(section,warnings):
    from docx.oxml.ns import qn
    item=section._sectPr.find(qn('w:lnNumType'))
    if item is None:return None
    try:
        result={'start':int(item.get(qn('w:start'),'0'))+1,'step':int(item.get(qn('w:countBy'),'1')),'distance':int(item.get(qn('w:distance'),'100'))/20,'restart':item.get(qn('w:restart'),'newPage')}
        validate_line_numbering(result);return result
    except (ValueError,TypeError,OverflowError):
        warnings.append('Unsupported DOCX line numbering was omitted; the original file is unchanged.');return None
