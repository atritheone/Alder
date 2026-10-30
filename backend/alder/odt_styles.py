"""The editable OpenDocument style subset (ODF 1.3, Part 3).

Values are converted to Alder's points; page geometry uses millimetres.
No application extension or embedded Alder document is needed for exchange.
"""
import math
import re
import xml.etree.ElementTree as ET

NS={key:'urn:oasis:names:tc:opendocument:xmlns:'+name+':1.0' for key,name in
    [('office','office'),('style','style'),('text','text'),('table','table'),('draw','drawing'),('fo','xsl-fo-compatible'),('svg','svg-compatible'),('meta','meta'),('manifest','manifest')]}
NS.update(xlink='http://www.w3.org/1999/xlink',dc='http://purl.org/dc/elements/1.1/')
for prefix,uri in NS.items():ET.register_namespace(prefix,uri)
def q(value):
    prefix,name=value.split(':',1);return '{'+NS[prefix]+'}'+name
def element(parent,tag,attrs=None,text=None):
    node=ET.SubElement(parent,q(tag),{q(k):str(v) for k,v in (attrs or {}).items() if v is not None})
    node.text=text;return node
def length(value,default=None):
    match=re.fullmatch(r'\s*(-?\d+(?:\.\d+)?)(pt|pc|cm|mm|in|px)\s*',value or '')
    if not match:return default
    number=float(match[1])*{'pt':1,'pc':12,'cm':72/2.54,'mm':72/25.4,'in':72,'px':.75}[match[2]]
    return number if math.isfinite(number) and abs(number)<=100000 else default
def colour(value):return value if isinstance(value,str) and re.fullmatch(r'#[\da-fA-F]{6}',value) else None
def number(value,maximum=100000):
    try:
        result=int(value)
        if 0<=result<=maximum:return result
    except (TypeError,ValueError):pass
    raise ValueError('OpenDocument contains an invalid or excessive count.')

class Styles:
    def __init__(self,roots):
        self.named={};self.defaults={};self.fonts={};self.lists={};self.pages={};self.masters={};self.cache={}
        for root in roots:
            for node in root.iter():
                name=node.get(q('style:name'))
                if node.tag==q('style:style') and name:self.named[(node.get(q('style:family')),name)]=node
                elif node.tag==q('style:default-style'):self.defaults[node.get(q('style:family'))]=node
                elif node.tag==q('style:font-face') and name:self.fonts[name]=node.get(q('svg:font-family'),name).strip("\"'")
                elif node.tag==q('text:list-style') and name:self.lists[name]=node
                elif node.tag==q('style:page-layout') and name:self.pages[name]=node
                elif node.tag==q('style:master-page') and name:self.masters[name]=node
    def resolve(self,family,name='',trail=()):
        key=(family,name)
        if key in self.cache:return self.cache[key]
        if key in trail or len(trail)>50:raise ValueError('OpenDocument style inheritance contains a cycle.')
        node=self.named.get(key) if name else self.defaults.get(family)
        result=dict(self.resolve(family,'',trail+(key,))) if name else {}
        if node is not None:
            parent=node.get(q('style:parent-style-name'))
            if parent:result.update(self.resolve(family,parent,trail+(key,)))
            for child in node:
                if child.tag in (q('style:text-properties'),q('style:paragraph-properties'),q('style:table-cell-properties'),q('style:table-row-properties'),q('style:table-column-properties'),q('style:table-properties'),q('style:graphic-properties')):
                    values=dict(child.attrib)
                    if child.tag==q('style:paragraph-properties') and q('fo:background-color') in values:
                        result['_paragraphBackground']=values.pop(q('fo:background-color'))
                    result.update(values)
                    tabs=child.find(q('style:tab-stops'))
                    if tabs is not None:result['_tabs']=list(tabs)
            master=node.get(q('style:master-page-name'))
            if master:result['_master']=master
        self.cache[key]=result;return result
    def characters(self,properties):
        attrs={}
        font=properties.get(q('style:font-name')) or properties.get(q('fo:font-family'))
        if font:attrs['fontFamily']=self.fonts.get(font,font).strip("\"'")[:100]
        size=length(properties.get(q('fo:font-size')))
        if size is not None:attrs['fontSize']=max(6,min(72,size))
        for field,key in [('color','fo:color')]:
            value=colour(properties.get(q(key)))
            if value:attrs[field]=value
        marks=[]
        background=colour(properties.get(q('fo:background-color')))
        if background:marks.append({'type':'highlight','attrs':{'color':background}})
        if properties.get(q('fo:font-weight')) in ('bold','700','800','900'):marks.append({'type':'strong'})
        if properties.get(q('fo:font-style'))=='italic':marks.append({'type':'em'})
        if properties.get(q('style:text-underline-style'),'none')!='none':marks.append({'type':'underline'})
        if properties.get(q('style:text-line-through-style'),'none')!='none':marks.append({'type':'strike'})
        position=properties.get(q('style:text-position'),'')
        if position.startswith('sub'):marks.append({'type':'subscript'})
        elif position.startswith('super'):marks.append({'type':'superscript'})
        if attrs:marks.append({'type':'text_style','attrs':attrs})
        return marks
    def paragraph(self,properties):
        attrs={}
        for mark in self.characters(properties):
            if mark['type']=='text_style':attrs.update({k:v for k,v in mark['attrs'].items() if k!='background'})
        background=properties.get('_paragraphBackground')
        if colour(background) or background=='transparent':attrs['paragraphBackground']=background
        padding=length(properties.get(q('fo:padding')))
        if padding is not None:attrs['paragraphPadding']=max(0,min(31,padding))
        border=properties.get(q('fo:border'),'').split()
        if border and border[0]=='none':attrs['paragraphBorderWidth']=0
        elif len(border)>=3:
            width=length(border[0])
            if width is not None:attrs['paragraphBorderWidth']=max(0,min(12,width))
            if colour(border[-1]):attrs['paragraphBorderColor']=border[-1]
        for key,prop in [('spaceBefore','fo:margin-top'),('spaceAfter','fo:margin-bottom'),('leftIndent','fo:margin-left'),('rightIndent','fo:margin-right'),('firstLineIndent','fo:text-indent')]:
            value=length(properties.get(q(prop)))
            if value is not None:attrs[key]=max(-144 if key in ('leftIndent','rightIndent','firstLineIndent') else 0,min(144,value))
        alignment=properties.get(q('fo:text-align'))
        if alignment in ('left','right','center','justify','start','end'):attrs['align']={'start':'left','end':'right'}.get(alignment,alignment)
        leading=properties.get(q('fo:line-height'),'')
        if re.fullmatch(r'\d+(?:\.\d+)?%',leading):attrs.update(lineSpacingMode='multiple',lineHeight=max(.8,min(4,float(leading[:-1])/100)))
        elif length(leading) is not None:attrs.update(lineSpacingMode='exact',lineSpacing=max(1,min(144,length(leading))))
        minimum=length(properties.get(q('style:line-height-at-least')))
        if minimum is not None:attrs.update(lineSpacingMode='atLeast',lineSpacing=max(1,min(144,minimum)))
        for key,prop in [('keepTogether','fo:keep-together'),('keepWithNext','fo:keep-with-next')]:
            if q(prop) in properties:attrs[key]=properties[q(prop)]=='always'
        if q('fo:break-before') in properties:attrs['pageBreakBefore']=properties[q('fo:break-before')]=='page'
        if q('fo:widows') in properties:attrs['widowOrphan']=number(properties[q('fo:widows')],maximum=100)>1
        if properties.get(q('style:writing-mode')) in ('rl-tb','lr-tb'):attrs['textDirection']='rtl' if properties[q('style:writing-mode')]=='rl-tb' else 'ltr'
        language=properties.get(q('fo:language'))
        if language and language!='none':attrs['textLanguage']=language+(('-'+properties[q('fo:country')]) if properties.get(q('fo:country')) not in (None,'none') else '')
        if '_tabs' in properties:
            attrs['tabStops']=[]
            for tab in properties['_tabs']:
                position=length(tab.get(q('style:position')))
                if position is None or not 0<position<=1440:continue
                attrs['tabStops'].append({'position':position,'align':{'char':'decimal'}.get(tab.get(q('style:type'),'left'),tab.get(q('style:type'),'left')),'leader':{'.':'dot','-':'dash','_':'line'}.get(tab.get(q('style:leader-text')),'none')})
            attrs['tabStops']=sorted({item['position']:item for item in attrs['tabStops'] if item['align'] in ('left','right','center','decimal')}.values(),key=lambda item:item['position'])[:64]
        return attrs

def text_properties(attrs,marks,font_name):
    values={}
    if attrs.get('fontFamily'):values['style:font-name']=font_name(attrs['fontFamily'])
    if attrs.get('fontSize'):values['fo:font-size']=f"{attrs['fontSize']:g}pt"
    for field,prop in [('color','fo:color'),('background','fo:background-color')]:
        if colour(attrs.get(field)):values[prop]=attrs[field]
    for mark in marks:
        kind=mark['type']
        if kind=='text_style':values.update(text_properties(mark.get('attrs',{}),[],font_name))
        elif kind in ('strong','em'):values['fo:font-weight' if kind=='strong' else 'fo:font-style']='bold' if kind=='strong' else 'italic'
        elif kind in ('underline','strike'):values['style:text-underline-style' if kind=='underline' else 'style:text-line-through-style']='solid'
        elif kind in ('subscript','superscript'):values['style:text-position']=('sub' if kind=='subscript' else 'super')+' 58%'
        elif kind=='highlight' and colour(mark.get('attrs',{}).get('color')):values['fo:background-color']=mark['attrs']['color']
    if attrs.get('textLanguage'):
        pieces=attrs['textLanguage'].split('-');values['fo:language']=pieces[0]
        if len(pieces)>1:values['fo:country']=pieces[1]
    return values

def paragraph_properties(attrs):
    values={}
    if attrs.get('paragraphBackground'):values['fo:background-color']=attrs['paragraphBackground']
    if attrs.get('paragraphPadding') is not None:values['fo:padding']=f"{attrs['paragraphPadding']:g}pt"
    if attrs.get('paragraphBorderWidth') is not None or attrs.get('paragraphBorderColor'):
        values['fo:border']=f"{attrs.get('paragraphBorderWidth') or 0:g}pt solid {attrs.get('paragraphBorderColor') or '#999999'}"
    for field,prop in [('spaceBefore','fo:margin-top'),('spaceAfter','fo:margin-bottom'),('leftIndent','fo:margin-left'),('rightIndent','fo:margin-right'),('firstLineIndent','fo:text-indent')]:
        if attrs.get(field) is not None:values[prop]=f"{attrs[field]:g}pt"
    if attrs.get('align'):values['fo:text-align']=attrs['align']
    mode=attrs.get('lineSpacingMode')
    if mode in ('exact','atLeast') and attrs.get('lineSpacing'):
        values['fo:line-height' if mode=='exact' else 'style:line-height-at-least']=f"{attrs['lineSpacing']:g}pt"
    elif attrs.get('lineHeight'):values['fo:line-height']=f"{attrs['lineHeight']*100:g}%"
    for field,prop in [('keepTogether','fo:keep-together'),('keepWithNext','fo:keep-with-next')]:
        if attrs.get(field) is not None:values[prop]='always' if attrs[field] else 'auto'
    if attrs.get('pageBreakBefore') is not None:values['fo:break-before']='page' if attrs['pageBreakBefore'] else 'auto'
    if attrs.get('widowOrphan') is not None:values.update({'fo:widows':'2' if attrs['widowOrphan'] else '1','fo:orphans':'2' if attrs['widowOrphan'] else '1'})
    if attrs.get('textDirection') in ('rtl','ltr'):values['style:writing-mode']='rl-tb' if attrs['textDirection']=='rtl' else 'lr-tb'
    return values
