"""Paragraph-anchored square wrapping shared by HTML and native Word drawings."""
import math


def image_wrapping(attrs):
    side = attrs.get('wrap') or 'none'
    gap = attrs.get('wrapGap') if attrs.get('wrapGap') is not None else 12
    if side not in ('none', 'left', 'right'):
        raise ValueError('Choose inline, left or right picture wrapping.')
    if type(gap) not in (int, float) or not math.isfinite(gap) or not 0 <= gap <= 192:
        raise ValueError('Picture text spacing must be between 0 and 192 pixels.')
    return side, gap


def wrapping_css(attrs):
    side, gap = image_wrapping(attrs)
    if side == 'none':
        return ''
    return f'float:{side};clear:{side};margin:0 {gap if side == "left" else 0:g}px {gap:g}px {gap if side == "right" else 0:g}px'


def write_word_wrapping(shape, attrs):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    side, gap = image_wrapping(attrs)
    if side == 'none':
        return
    inline = shape._inline
    anchor = OxmlElement('wp:anchor')
    anchor.attrib.update(dict(simplePos='0', relativeHeight='0', behindDoc='0', locked='0', layoutInCell='1', allowOverlap='0',
                         distT='0', distB=str(round(gap * 9525)),
                         distL=str(round(gap * 9525)) if side == 'right' else '0',
                         distR=str(round(gap * 9525)) if side == 'left' else '0'))
    position = OxmlElement('wp:simplePos');position.attrib.update(dict(x='0', y='0'));anchor.append(position)
    horizontal = OxmlElement('wp:positionH');horizontal.set('relativeFrom','column')
    align = OxmlElement('wp:align');align.text=side;horizontal.append(align);anchor.append(horizontal)
    vertical = OxmlElement('wp:positionV');vertical.set('relativeFrom','paragraph')
    offset = OxmlElement('wp:posOffset');offset.text='0';vertical.append(offset);anchor.append(vertical)
    for tag in ('extent','effectExtent'):
        node = inline.find(qn('wp:'+tag))
        if node is not None:anchor.append(node)
    wrapping = OxmlElement('wp:wrapSquare');wrapping.set('wrapText','bothSides');anchor.append(wrapping)
    for node in list(inline):anchor.append(node)
    inline.getparent().replace(inline,anchor)


def read_word_wrapping(anchor):
    """Return only layouts represented exactly by the paragraph-side controls."""
    from docx.oxml.ns import qn
    if anchor is None:return {}
    horizontal=anchor.find(qn('wp:positionH'));vertical=anchor.find(qn('wp:positionV'))
    square=anchor.find(qn('wp:wrapSquare'))
    if (horizontal is None or vertical is None or square is None
            or anchor.get('behindDoc','0') not in ('0','false')
            or anchor.get('simplePos','0') not in ('0','false')
            or horizontal.get('relativeFrom')!='column' or vertical.get('relativeFrom')!='paragraph'):
        return None
    align=horizontal.find(qn('wp:align'));offset=vertical.find(qn('wp:posOffset'))
    if align is None or align.text not in ('left','right') or offset is None or offset.text!='0':return None
    if square.get('wrapText', 'bothSides') not in ('bothSides', 'right' if align.text == 'left' else 'left'):
        return None
    transform = anchor.find('.//' + qn('a:xfrm'))
    if transform is not None and transform.get('rot', '0') != '0':
        return None
    try:
        distances={edge:int(anchor.get('dist'+edge,'0')) for edge in ('T','B','L','R')}
        gap=distances['R' if align.text=='left' else 'L']
        if distances['T'] or distances['L' if align.text=='left' else 'R'] or gap!=distances['B']:return None
        result={'wrap':align.text,'wrapGap':gap/9525}
        image_wrapping(result)
        return result
    except (ValueError,TypeError):return None
