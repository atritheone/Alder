"""Bounded Presentation MathML and editable Office Math, without network converters.

MathML is authoritative. LaTeX is an optional editor cache; accessible text is
document content so speech, search and offsets use the usual projection.
"""
import re
from lxml import etree as E

MML = 'http://www.w3.org/1998/Math/MathML'
OM = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
TAGS = {'math','mrow','mi','mn','mo','mtext','mspace','mstyle','mfrac','msqrt','mroot',
        'msub','msup','msubsup','munder','mover','munderover','mtable','mtr','mtd','mpadded'}
ATTRS = {'display','mathvariant','displaystyle','scriptlevel','stretchy','fence','separator',
         'lspace','rspace','accent','accentunder','width','height','depth','voffset','linethickness',
         'columnalign','columnspacing','rowspacing','minsize','maxsize','form'}
ARITY = {'mfrac':2,'mroot':2,'msub':2,'msup':2,'msubsup':3,'munder':2,'mover':2,'munderover':3}
TOKENS = {'mi','mn','mo','mtext'}
VARIANTS = {
    'normal':('roman','p'), 'bold':('roman','b'), 'italic':('roman','i'), 'bold-italic':('roman','bi'),
    'double-struck':('double-struck','p'), 'script':('script','p'), 'bold-script':('script','b'),
    'fraktur':('fraktur','p'), 'bold-fraktur':('fraktur','b'), 'sans-serif':('sans-serif','p'),
    'bold-sans-serif':('sans-serif','b'), 'sans-serif-italic':('sans-serif','i'),
    'sans-serif-bold-italic':('sans-serif','bi'), 'monospace':('monospace','p'),
}

def import_mathml(value):
    if not isinstance(value,str) or len(value)>65536 or re.search(r'<!|<\?',value):raise ValueError('Invalid or oversized equation.')
    try:root=E.fromstring(value.encode('utf-8'),E.XMLParser(resolve_entities=False,no_network=True))
    except E.XMLSyntaxError as exc:raise ValueError('Invalid equation MathML.') from exc
    for n in list(root.iter('{'+MML+'}semantics')):
        children=[c for c in n if E.QName(c).localname not in ('annotation','annotation-xml')]
        if len(children)!=1:raise ValueError('Unsupported equation semantics.')
        n.getparent().replace(n,children[0])
    value=E.tostring(root,encoding='unicode');root=parse(value)
    return {'type':'equation','attrs':{'mathML':value,'latex':''},'content':[{'type':'text','text':describe(root)}]}


def parse(value):
    if not isinstance(value,str) or len(value)>65536 or re.search(r'<!|<\?',value):
        raise ValueError('Invalid or oversized equation.')
    try: root=E.fromstring(value.encode('utf-8'), E.XMLParser(resolve_entities=False,no_network=True))
    except E.XMLSyntaxError as exc: raise ValueError('Invalid equation MathML.') from exc
    count=0
    def visit(node,depth=0):
        nonlocal count
        count+=1
        tag=E.QName(node).localname
        if count>2048 or depth>32 or E.QName(node).namespace!=MML or tag not in TAGS:
            raise ValueError('This equation contains unsupported or overly complex MathML.')
        if any(k not in ATTRS or len(v)>80 or not re.fullmatch(r'[\w .+%\-,]*',v) for k,v in node.attrib.items()):
            raise ValueError('Unsupported equation attribute.')
        if tag in ARITY and len(node)!=ARITY[tag]:raise ValueError('Invalid equation arguments.')
        if tag=='math' and depth:raise ValueError('Nested math roots are not supported.')
        if tag in ('mtable','mtr') and (not len(node) or any(E.QName(c).localname!=('mtr' if tag=='mtable' else 'mtd') for c in node)):
            raise ValueError('Invalid equation matrix.')
        if tag=='mtable' and len({len(row) for row in node})>1:raise ValueError('Matrix rows need the same number of cells.')
        if tag in ('mtr','mtd') and (node.getparent() is None or E.QName(node.getparent()).localname!=('mtable' if tag=='mtr' else 'mtr')):
            raise ValueError('Invalid equation matrix cell.')
        if tag=='mspace' and len(node):raise ValueError('Equation spacing cannot contain terms.')
        if tag in TOKENS and len(node):raise ValueError('An equation token must contain text.')
        if tag not in TOKENS and (node.text or '').strip():raise ValueError('Equation text needs a token.')
        if node.tail and node.tail.strip():raise ValueError('Invalid equation text.')
        for child in node:visit(child,depth+1)
    visit(root)
    if E.QName(root).localname!='math':raise ValueError('An equation needs a math root.')
    if not any(E.QName(n).localname in TOKENS and (n.text or '').strip() for n in root.iter()):raise ValueError('An equation needs at least one term.')
    return root


def validate(node):
    attrs=node.get('attrs') or {}
    parse(attrs.get('mathML'))
    source=attrs.get('latex','')
    if not isinstance(source,str) or len(source)>8192:raise ValueError('Equation source is too long.')
    content=node.get('content',[])
    if len(content)!=1 or content[0].get('type')!='text' or content[0].get('marks') or content[0].get('content'):
        raise ValueError('An equation needs a plain text reading description.')
    text=content[0].get('text')
    if not isinstance(text,str) or not text.strip() or len(text)>4096:raise ValueError('Describe the equation in at most 4096 characters.')
    if node.get('marks'):raise ValueError('Equation formatting belongs to its formula or paragraph.')
    return attrs


def _o(name,*children,**attrs):
    result=E.Element('{'+OM+'}'+name)
    for key,value in attrs.items():result.set('{'+OM+'}'+key,str(value))
    result.extend(children)
    return result


def to_word(node):
    root=parse(validate(node)['mathML'])
    def convert(n,inherited=''):
        tag=E.QName(n).localname;c=list(n)
        variant=n.get('mathvariant',inherited)
        if variant and variant not in VARIANTS:raise ValueError('Unsupported equation alphabet for Word export.')
        def seq(children):return [item for child in children for item in convert(child,variant)]
        def arg(name,child):return _o(name,*convert(child,variant))
        if tag in TOKENS:
            t=_o('t');t.text=n.text or '';t.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
            script,style=VARIANTS.get(variant,('roman','i' if tag=='mi' and len(n.text or '')==1 else 'p'))
            return [_o('r',_o('rPr',_o('scr',val=script),_o('sty',val=style)),t)]
        if tag=='mspace':
            t=_o('t');t.text=' ';t.set('{http://www.w3.org/XML/1998/namespace}space','preserve');return [_o('r',t)]
        if tag in ('math','mrow','mstyle','mpadded','mtd'):
            if len(c)>=3 and all(E.QName(x).localname=='mo' and x.get('fence')=='true' for x in (c[0],c[-1])):
                return [_o('d',_o('dPr',_o('begChr',val=c[0].text or ''),_o('endChr',val=c[-1].text or '')),_o('e',*seq(c[1:-1])))]
            return seq(c)
        if tag=='mfrac':
            props=[_o('type',val='noBar')] if n.get('linethickness') in ('0','0px') else []
            return [_o('f',_o('fPr',*props),arg('num',c[0]),arg('den',c[1]))]
        if tag in ('msqrt','mroot'):
            return [_o('rad',_o('radPr',_o('degHide',val='1' if tag=='msqrt' else '0')),
                       _o('deg',*(convert(c[1],variant) if tag=='mroot' else [])),_o('e',*(convert(c[0],variant) if tag=='mroot' else seq(c))))]
        if tag in ('msub','msup','msubsup'):
            name={'msub':'sSub','msup':'sSup','msubsup':'sSubSup'}[tag]
            return [_o(name,arg('e',c[0]),*( [arg('sub',c[1]),arg('sup',c[2])] if tag=='msubsup' else [arg('sub' if tag=='msub' else 'sup',c[1])]))]
        if tag in ('mover','munder','munderover'):
            base=convert(c[0],variant);which=['under','over'] if tag=='munderover' else [tag[1:]]
            for i,side in enumerate(which):
                mark=''.join(c[i+1].itertext())
                if side=='over' and mark in ('¯','‾','―','_'):
                    base=[_o('bar',_o('barPr',_o('pos',val='top')),_o('e',*base))]
                elif side=='over' and (n.get('accent')=='true' or mark in ('^','ˆ','~','˜','→','˙','¨')):
                    base=[_o('acc',_o('accPr',_o('chr',val=mark)),_o('e',*base))]
                else:base=[_o('limLow' if side=='under' else 'limUpp',_o('e',*base),arg('lim',c[i+1]))]
            return base
        if tag=='mtable':
            return [_o('m',*[_o('mr',*[_o('e',*seq(list(cell))) for cell in row]) for row in c])]
        raise ValueError('Unsupported equation structure for Word export.')
    return _o('oMath',*convert(root))


def _m(name,*children,text=None,**attrs):
    n=E.Element('{'+MML+'}'+name,nsmap={None:MML} if name=='math' else None,**attrs)
    n.text=text;n.extend(children);return n


def from_word(element):
    """Reject unknown Office Math constructs instead of silently losing terms."""
    count=0
    def bounds(n,depth=0):
        nonlocal count
        count+=1
        if depth>48 or count>8192:raise ValueError('This Word equation is too complex to import.')
        for c in n:bounds(c,depth+1)
    bounds(element)
    def convert(n):
        tag=E.QName(n).localname
        if E.QName(n).namespace!=OM:raise ValueError('Unsupported content inside a Word equation. The source has been preserved.')
        if any(E.QName(c).namespace!=OM and c.tag!='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rPr' for c in n):
            raise ValueError('Unsupported content inside a Word equation. The source has been preserved.')
        children=[c for c in n if E.QName(c).namespace==OM and not E.QName(c).localname.endswith('Pr')]
        def row(key):
            found=n.find('{'+OM+'}'+key)
            return _m('mrow',*(convert(c) for c in found if not E.QName(c).localname.endswith('Pr'))) if found is not None else _m('mrow')
        def prop(path,default=''):return n.find(path,{'m':OM}).get('{'+OM+'}val',default) if n.find(path,{'m':OM}) is not None else default
        if tag=='r':
            if any(E.QName(c).localname not in ('rPr','t') for c in n):raise ValueError('Unsupported Word equation run.')
            text=''.join(c.text or '' for c in n if c.tag=='{'+OM+'}t')
            script=prop('m:rPr/m:scr','roman');style=prop('m:rPr/m:sty','i' if script=='roman' else 'p')
            variant=next((key for key,value in VARIANTS.items() if value==(script,style)),None)
            if variant is None:raise ValueError('Unsupported Word equation alphabet. The source has been preserved.')
            attrs={'mathvariant':variant}
            return _m('mn' if text.isnumeric() else 'mi' if text.isalpha() else 'mo',text=text,**attrs)
        if tag in ('oMath','e','num','den','deg','sub','sup','lim','box'):return _m('mrow',*(convert(c) for c in children))
        if tag=='f':return _m('mfrac',row('num'),row('den'),**({'linethickness':'0px'} if prop('m:fPr/m:type')=='noBar' else {}))
        if tag=='rad':return _m('msqrt',row('e')) if prop('m:radPr/m:degHide') in ('1','true','on') or not len(row('deg')) else _m('mroot',row('e'),row('deg'))
        if tag in ('sSub','sSup','sSubSup'):return _m({'sSub':'msub','sSup':'msup','sSubSup':'msubsup'}[tag],row('e'),*([row('sub'),row('sup')] if tag=='sSubSup' else [row('sub' if tag=='sSub' else 'sup')]))
        if tag=='bar':return _m('mover' if prop('m:barPr/m:pos','bot')=='top' else 'munder',row('e'),_m('mo',text='¯'),accent='true')
        if tag=='acc':return _m('mover',row('e'),_m('mo',text=prop('m:accPr/m:chr','ˆ')),accent='true')
        if tag in ('limLow','limUpp'):return _m('munder' if tag=='limLow' else 'mover',row('e'),row('lim'))
        if tag=='nary':
            op=_m('mo',text=prop('m:naryPr/m:chr','∫'))
            sub,sup=row('sub'),row('sup')
            if len(sub) and prop('m:naryPr/m:subHide') not in ('1','true'):op=_m('msub',op,sub)
            if len(sup) and prop('m:naryPr/m:supHide') not in ('1','true'):op=_m('msup',op,sup)
            return _m('mrow',op,row('e'))
        if tag=='d':
            values=[convert(c) for c in children if E.QName(c).localname=='e'];items=[]
            for i,v in enumerate(values):
                if i:items.append(_m('mo',text=prop('m:dPr/m:sepChr','|')))
                items.append(v)
            return _m('mrow',_m('mo',text=prop('m:dPr/m:begChr','(')),*items,_m('mo',text=prop('m:dPr/m:endChr',')')))
        if tag=='m':return _m('mtable',*(convert(c) for c in children))
        if tag=='mr':return _m('mtr',*(_m('mtd',convert(c)) for c in children))
        raise ValueError(f'Unsupported Word equation structure ({tag}). The source has been preserved.')
    root=_m('math',convert(element))
    if element.getparent() is not None and element.getparent().tag=='{'+OM+'}oMathPara':root.set('display','block')
    value=E.tostring(root,encoding='unicode');parse(value)
    description=describe(root)
    return {'type':'equation','attrs':{'mathML':value,'latex':''},'content':[{'type':'text','text':description}]}


def describe(n):
    tag=E.QName(n).localname;c=list(n)
    if tag in TOKENS:
        value=(n.text or '').strip()
        return {'+':'plus','−':'minus','-':'minus','=':'equals','±':'plus or minus','×':'times','÷':'divided by','∑':'sum','∏':'product','∫':'integral','∞':'infinity','<':'less than','>':'greater than','≤':'less than or equal to','≥':'greater than or equal to','≠':'not equal to','α':'alpha','β':'beta','γ':'gamma','θ':'theta','π':'pi','Δ':'delta','(':'open parenthesis',')':'close parenthesis'}.get(value,value)
    if tag=='mspace':return ''
    values=[describe(x) for x in c]
    if tag=='mfrac':return f'fraction {values[0]} over {values[1]} end fraction'
    if tag=='msqrt':return 'square root of '+' '.join(values)+' end root'
    if tag=='mroot':return f'root {values[1]} of {values[0]} end root'
    if tag=='msub':return f'{values[0]} subscript {values[1]}'
    if tag=='msup':return f'{values[0]} to the power {values[1]}'
    if tag=='msubsup':return f'{values[0]} subscript {values[1]} to the power {values[2]}'
    if tag=='mover':
        accent=''.join(c[1].itertext())
        name={'⃗':'vector','→':'vector','¯':'overline','‾':'overline','ˆ':'hat','̂':'hat','~':'tilde','˜':'tilde','̃':'tilde','˙':'dot','̇':'dot','¨':'double dot','̈':'double dot'}.get(accent)
        return f'{name} {values[0]}' if name else f'{values[0]} with {values[1]} above'
    if tag=='munder':return f'{values[0]} with {values[1]} below'
    if tag=='munderover':return f'{values[0]} from {values[1]} to {values[2]}'
    if tag=='mtable':return 'matrix '+'; '.join(values)+' end matrix'
    return ' '.join(v for v in values if v)
