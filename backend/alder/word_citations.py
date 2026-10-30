"""Portable Alder citation content controls, with collected CSL-JSON metadata.

These are not Word CITATION fields: native Word's style engine is different.
Word preserves the managed text and metadata through ordinary open/resave.
"""
from copy import deepcopy
import json
from uuid import uuid4

NS = 'urn:alder:citations:1'

class WordCitationsWriter:
    def __init__(self, document):
        from lxml import etree
        self.document = document
        self.root = etree.Element('{'+NS+'}citations', nsmap={None:NS})
        self.part = None
    def control(self, node):
        from lxml import etree
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn
        from docx.opc.part import XmlPart
        from docx.opc.constants import RELATIONSHIP_TYPE as RT
        identity = uuid4().hex
        entry=etree.SubElement(self.root,'{'+NS+'}entry',id=identity)
        entry.text=json.dumps({'type':node['type'],'attrs':node.get('attrs',{})},ensure_ascii=False)
        if self.part is None:
            package=self.document.part.package
            self.part=XmlPart(package.next_partname('/customXml/alderCitations%d.xml'),'application/xml',self.root,package)
            self.document.part.relate_to(self.part,RT.CUSTOM_XML)
        control=OxmlElement('w:sdt'); props=OxmlElement('w:sdtPr'); control.append(props)
        tag=OxmlElement('w:tag');tag.set(qn('w:val'),'AlderCitation:'+identity);props.append(tag)
        alias=OxmlElement('w:alias');alias.set(qn('w:val'),'Alder citation' if node['type']=='citation' else 'Alder bibliography');props.append(alias)
        lock=OxmlElement('w:lock');lock.set(qn('w:val'),'sdtContentLocked');props.append(lock)
        content=OxmlElement('w:sdtContent');control.append(content)
        return control,content
    def inline(self,paragraph,node,write_inline):
        control,content=self.control(node);start=len(paragraph._p)
        for child in node.get('content',[]):write_inline(paragraph,child)
        for run in list(paragraph._p)[start:]:content.append(run)
        paragraph._p.append(control)
    def block(self,container,node,write_block):
        control,content=self.control(node)
        # A detached cell gives the existing paragraph exporter the same style
        # and relationship owner without adding a table to the document.
        from docx.oxml import OxmlElement
        from docx.blkcntnr import BlockItemContainer
        holder=BlockItemContainer(OxmlElement('w:tc'),container)
        for child in node['content']:write_block(holder,child)
        content.extend(list(holder._element))
        placeholder=container.add_paragraph()._p;placeholder.addprevious(control);placeholder.getparent().remove(placeholder)

class WordCitationsReader:
    def __init__(self,document,xml):
        from docx.opc.constants import RELATIONSHIP_TYPE as RT
        self.entries={}
        for relation in document.part.rels.values():
            if relation.reltype!=RT.CUSTOM_XML or relation.is_external:continue
            blob=relation.target_part.blob
            if len(blob)>10*1024*1024:continue
            root=xml(blob)
            if root.tag!='{'+NS+'}citations':continue
            for entry in root:
                identity=entry.get('id');value=json.loads(entry.text or '{}')
                if identity in self.entries:raise ValueError('Duplicate citation metadata identity in DOCX.')
                if value.get('type') not in ('citation','bibliography'):raise ValueError('Invalid citation metadata in DOCX.')
                self.entries[identity]=value
    def metadata(self,element):
        from docx.oxml.ns import qn
        tag=element.find('./'+qn('w:sdtPr')+'/'+qn('w:tag'))
        name=tag.get(qn('w:val'),'') if tag is not None else ''
        if not name.startswith('AlderCitation:'):return None
        value=self.entries.get(name[len('AlderCitation:'):])
        if value is None:raise ValueError('This Word citation is missing its collected source metadata. The original file is preserved.')
        return deepcopy(value)
    def inline(self,element):
        from docx.oxml.ns import qn
        value=self.metadata(element)
        if value is None:return None
        if value['type']!='citation':raise ValueError('A bibliography cannot be embedded inside a paragraph.')
        text=''.join(node.text or '' for node in element.iter(qn('w:t')))
        value['content']=[{'type':'text','text':text}] if text else []
        from .models import validate_document
        validate_document({'type':'doc','content':[{'type':'paragraph','content':[value]}]})
        return value
    def block(self,element,parent,paragraph):
        from docx.oxml.ns import qn
        from docx.text.paragraph import Paragraph
        value=self.metadata(element)
        if value is None:return None
        if value['type']!='bibliography':raise ValueError('An inline citation was placed outside a paragraph.')
        value['attrs']['entryStyle']=None
        content=element.find(qn('w:sdtContent'))
        if content is None or any(child.tag!=qn('w:p') for child in content):raise ValueError('This bibliography contains unsupported Word objects. The original file is preserved.')
        value['content']=[paragraph(Paragraph(child,parent)) for child in content]
        from .models import validate_document
        validate_document({'type':'doc','content':[value]})
        return value
