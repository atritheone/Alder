"""Office 2019 decorative-image extension (MS-ODRAWXML section 5.32)."""
DECORATIVE_NS = 'http://schemas.microsoft.com/office/drawing/2017/decorative'
EXTENSION_URI = '{C183D7F6-B498-43B3-948B-1728B52AA6E4}'


def write_decorative(properties, decorative):
    if not decorative: return
    from docx.oxml import OxmlElement
    from lxml import etree
    extensions=OxmlElement('a:extLst')
    extension=OxmlElement('a:ext');extension.set('uri',EXTENSION_URI)
    value=etree.Element('{'+DECORATIVE_NS+'}decorative',nsmap={'adec':DECORATIVE_NS})
    value.set('val','1');extension.append(value);extensions.append(extension);properties.append(extensions)


def read_decorative(properties):
    if properties is None:return False
    return any(node.get('val') in ('1','true') for node in properties.iter('{'+DECORATIVE_NS+'}decorative'))
