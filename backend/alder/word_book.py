"""Editable chapter groups and semantic metadata for Alder/Word exchange."""
import json
from uuid import uuid4
from .book_structure import metadata, validate_structure

NS='urn:alder:book:1'

class WordBookWriter:
    def __init__(self,document):
        from lxml import etree
        self.document=document
        self.root=etree.Element('{'+NS+'}chapters',nsmap={None:NS})
        self.part=None

    def wrap(self,start,section,page_break):
        if not section.get('bookStructure'):return
        from lxml import etree
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn
        from docx.opc.part import XmlPart
        from docx.opc.constants import RELATIONSHIP_TYPE as RT
        identity=uuid4().hex
        entry=etree.SubElement(self.root,'{'+NS+'}chapter',id=identity)
        entry.text=json.dumps({**metadata(section),'pageBreak':bool(page_break)},ensure_ascii=False)
        if self.part is None:
            package=self.document.part.package
            self.part=XmlPart(package.next_partname('/customXml/alderBook%d.xml'),'application/xml',self.root,package)
            self.document.part.relate_to(self.part,RT.CUSTOM_XML)
        control=OxmlElement('w:sdt');props=OxmlElement('w:sdtPr');control.append(props)
        tag=OxmlElement('w:tag');tag.set(qn('w:val'),'AlderChapter:'+identity);props.append(tag)
        alias=OxmlElement('w:alias');alias.set(qn('w:val'),str(section.get('navigationTitle') or 'Chapter')[:255]);props.append(alias)
        content=OxmlElement('w:sdtContent');control.append(content)
        body=self.document._element.body
        for element in list(body)[start:-1]:content.append(element)
        body.insert(start,control)

class WordBookReader:
    def __init__(self,document,xml):
        from docx.opc.constants import RELATIONSHIP_TYPE as RT
        self.entries={}
        for relation in document.part.rels.values():
            if relation.reltype!=RT.CUSTOM_XML or relation.is_external:continue
            data=relation.target_part.blob
            if len(data)>10*1024*1024:continue
            root=xml(data)
            if root.tag!='{'+NS+'}chapters':continue
            for entry in root:
                identity=entry.get('id');value=json.loads(entry.text or '{}')
                if identity in self.entries or not isinstance(value,dict):raise ValueError('Invalid Word book metadata.')
                validate_structure(value)
                if not isinstance(value.get('title'),str) or not 1<=len(value['title'].strip())<=300:raise ValueError('Invalid Word chapter title.')
                self.entries[identity]=value

    def chapter(self,element):
        from docx.oxml.ns import qn
        tag=element.find('./'+qn('w:sdtPr')+'/'+qn('w:tag'))
        name=tag.get(qn('w:val'),'') if tag is not None else ''
        if not name.startswith('AlderChapter:'):return None
        value=self.entries.get(name[len('AlderChapter:'):])
        if value is None:raise ValueError('This Word chapter is missing its book metadata. The original file is preserved.')
        return dict(value)
