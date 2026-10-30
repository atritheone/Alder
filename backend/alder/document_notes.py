"""Separate note bodies anchored to an inline reference, with native Word parts."""
import copy
import json

KINDS = ('footnote', 'endnote')

def requires_note_geometry(documents,settings):
    """Word can clip a continuing note when later sections change paper size.
    Only the desktop page map can establish whether a note actually crosses."""
    from .page_geometry import page_geometry
    current=dict(settings);geometries=set();footnotes=False
    def geometry():
        g=page_geometry(current);m=g['margins']
        return (g['width'],g['height'],m['top'],m['bottom'],m['left']+m['right'])
    geometries.add(geometry())
    def walk(node):
        nonlocal footnotes
        if node.get('type')=='section_break':
            current.update(node.get('attrs',{}).get('page') or {});geometries.add(geometry())
        if node.get('type')=='document_note' and node.get('attrs',{}).get('kind')=='footnote':footnotes=True
        for child in node.get('content',[]):walk(child)
    for document in documents:walk(document)
    return footnotes and len(geometries)>1
NODES = {'doc', 'paragraph', 'text', 'hard_break', 'document_field', 'image', 'inline_image', 'bullet_list', 'ordered_list', 'list_item', 'table', 'table_row', 'table_cell', 'table_header'}
MARKS = {'strong', 'em', 'underline', 'strike', 'subscript', 'superscript', 'text_style', 'link', 'highlight'}


def validate_note(attrs):
    if attrs.get('kind') not in KINDS:
        raise ValueError('Choose a footnote or endnote.')
    body = attrs.get('body')
    if not isinstance(body, dict) or body.get('type') != 'doc' or not body.get('content'):
        raise ValueError('A note requires a body containing paragraphs.')
    count=0
    def check(node,depth=0):
        nonlocal count
        count+=1
        if count>250000 or depth>50:raise ValueError('Note structure is too large or deeply nested.')
        if not isinstance(node,dict) or not isinstance(node.get('content',[]),list) or not isinstance(node.get('marks',[]),list) or not isinstance(node.get('attrs',{}),dict) or any(not isinstance(mark,dict) for mark in node.get('marks',[])):
            raise ValueError('Invalid note content.')
        if node.get('type') not in NODES or any(mark.get('type') not in MARKS for mark in node.get('marks', [])):
            raise ValueError('Notes support formatted paragraphs, lists, tables, images and links.')
        if node.get('attrs', {}).get('revisionProperties') or node.get('attrs', {}).get('captionLabel'):
            raise ValueError('Review changes and captions are not supported inside a note.')
        if node.get('type')=='document_field' and node.get('attrs',{}).get('fieldKind')!='merge':
            raise ValueError('Only merge fields are supported inside notes.')
        if node.get('type') in ('image', 'inline_image') and node.get('attrs', {}).get('wrap', 'none') != 'none':
            raise ValueError('Pictures in notes use inline or standalone placement.')
        for child in node.get('content', []): check(child,depth+1)
    check(body)
    if any(node.get('type') not in ('paragraph','image','bullet_list','ordered_list','table') for node in body['content']):
        raise ValueError('A note body must contain paragraphs, lists, tables or images.')


def notes(documents):
    result = []
    def walk(node):
        if any(mark['type'] == 'revision_deletion' for mark in node.get('marks', [])): return
        if node['type'] == 'document_note': result.append(node)
        for child in node.get('content', []): walk(child)
    for document in documents: walk(document)
    return result


def prepared_body(body):
    body = copy.deepcopy(body)
    from .list_formatting import resolve_list_orders
    resolve_list_orders(body)
    def prepare(node):
        if node['type']=='paragraph':node['attrs'] = {'fontSize':9, 'lineHeight':1.2, 'spaceBefore':0, 'spaceAfter':3, **node.get('attrs', {})}
        for child in node.get('content',[]):prepare(child)
    prepare(body)
    if body['content'][0]['type']!='paragraph':body['content'].insert(0,{'type':'paragraph'})
    return body


class WordNotesWriter:
    def __init__(self, document, options=None):
        from .note_options import note_options
        self.options=note_options(options)
        self.section_options=[self.options]
        self.document = document
        self.pending = {kind: [] for kind in KINDS}

    def section(self, options=None):
        from .note_options import note_options
        self.section_options.append(note_options(options) if options is not None else self.section_options[-1])

    def reference(self, paragraph, node):
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn
        kind = node['attrs']['kind']
        identifier = len(self.pending[kind]) + 1
        self.pending[kind].append((identifier, node))
        run = paragraph.add_run()
        run.font.superscript = True
        reference = OxmlElement('w:' + kind + 'Reference'); reference.set(qn('w:id'), str(identifier))
        run._r.append(reference)

    def finish(self, block, prepare_story=None):
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn
        from docx.parts.story import StoryPart
        from docx.opc.packuri import PackURI
        from docx.opc.constants import RELATIONSHIP_TYPE as RT
        from docx.blkcntnr import BlockItemContainer
        from docx.oxml.table import CT_Tc
        def has_table(node):
            return node.get('type') == 'table' or any(has_table(child) for child in node.get('content', []))
        if any(has_table(node['attrs']['body']) for items in self.pending.values() for _, node in items):
            # Word's 2010 compatibility layout can clip a long endnote row
            # even with cantSplit disabled. Native Word 2013+ layout flows it.
            settings = self.document.settings.element
            compat = settings.find(qn('w:compat'))
            if compat is None:
                compat = OxmlElement('w:compat')
                settings.insert_element_before(compat, 'w:docVars', 'w:rsids', 'm:mathPr', 'w:themeFontLang')
            setting = next((item for item in compat.findall(qn('w:compatSetting')) if item.get(qn('w:name')) == 'compatibilityMode'), None)
            if setting is None:
                setting = OxmlElement('w:compatSetting'); compat.append(setting)
            setting.set(qn('w:name'), 'compatibilityMode')
            setting.set(qn('w:uri'), 'http://schemas.microsoft.com/office/word')
            setting.set(qn('w:val'), '15')
        # Reuse the paragraph exporter with a detached table-cell container;
        # the part owns links, so their relationships point to the note part.
        for kind, items in self.pending.items():
            if not items: continue
            root = OxmlElement('w:' + kind + 's')
            part = StoryPart(PackURI('/word/' + kind + 's.xml'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.' + kind + 's+xml', root, self.document.part.package)
            part.get_style = self.document.part.get_style
            part.get_style_id = self.document.part.get_style_id
            self.document.part.relate_to(part, getattr(RT, kind.upper() + 'S'))
            owner = type('NoteOwner', (), {'part': part})()
            for special_id, special in ((-1, 'separator'), (0, 'continuationSeparator')):
                note = OxmlElement('w:' + kind); note.set(qn('w:id'), str(special_id)); note.set(qn('w:type'), special)
                p = OxmlElement('w:p'); r = OxmlElement('w:r'); r.append(OxmlElement('w:' + special)); p.append(r); note.append(p); root.append(note)
            for identifier, node in items:
                note = OxmlElement('w:' + kind); note.set(qn('w:id'), str(identifier)); root.append(note)
                temporary = CT_Tc.new(); container = BlockItemContainer(temporary, owner)
                body=prepared_body(node['attrs']['body'])
                if prepare_story:prepare_story(body)
                for paragraph in body['content']: block(container, paragraph)
                # CT_Tc.new() has an empty placeholder paragraph.
                paragraphs = list(temporary)[2:] if temporary[0].tag == qn('w:tcPr') else list(temporary)[1:]
                for element in paragraphs: note.append(element)
                first = next(element for element in note if element.tag == qn('w:p'))
                run = OxmlElement('w:r'); properties = OxmlElement('w:rPr'); vertical = OxmlElement('w:vertAlign'); vertical.set(qn('w:val'), 'superscript'); properties.append(vertical); run.append(properties); run.append(OxmlElement('w:' + kind + 'Ref'))
                text_run = OxmlElement('w:r'); text = OxmlElement('w:t'); text.set(qn('xml:space'), 'preserve'); text.text = ' '; text_run.append(text)
                at = 1 if first.find(qn('w:pPr')) is not None else 0
                first.insert(at, run); first.insert(at+1, text_run)
            settings = self.document.settings.element
            properties = settings.find(qn('w:' + kind + 'Pr'))
            if properties is None:
                properties = OxmlElement('w:' + kind + 'Pr')
                settings.insert_element_before(properties, *(('w:endnotePr',) if kind=='footnote' else ()), 'w:compat','w:docVars','w:rsids','m:mathPr','w:themeFontLang','w:clrSchemeMapping','w:shapeDefaults','w:decimalSymbol','w:listSeparator')
            def write_options(properties,options):
                for key, value in [('pos', options.get('placement','docEnd')), ('numFmt', options['format']), ('numStart', str(options['start'])), ('numRestart', {'section':'eachSect','page':'eachPage'}.get(options['restart'],'continuous'))]:
                    for old in list(properties.findall(qn('w:' + key))): properties.remove(old)
                    child = OxmlElement('w:' + key); child.set(qn('w:val'), value); properties.append(child)
            write_options(properties,self.options[kind])
            for section,options in zip(self.document.sections,self.section_options):
                old=section._sectPr.find(qn('w:'+kind+'Pr'))
                if old is not None:section._sectPr.remove(old)
                current=OxmlElement('w:'+kind+'Pr');write_options(current,options[kind])
                section._sectPr.insert_element_before(current,*(('w:endnotePr',) if kind=='footnote' else ()), 'w:type','w:pgSz','w:pgMar','w:paperSrc','w:pgBorders','w:lnNumType','w:pgNumType','w:cols')



class WordNotesReader:
    def __init__(self, document, warnings):
        from docx.opc.constants import RELATIONSHIP_TYPE as RT
        from docx.oxml import parse_xml
        from docx.oxml.ns import qn
        self.items, self.warnings = {}, warnings
        from .note_options import read_word_section_options
        self.section_options=read_word_section_options(document,warnings)
        self.options=self.section_options[0]
        for kind in KINDS:
            for relationship in document.part.rels.values():
                if relationship.reltype != getattr(RT, kind.upper() + 'S') or relationship.is_external: continue
                part = relationship.target_part
                part.get_style = document.part.get_style
                part.get_style_id = document.part.get_style_id
                root = parse_xml(part.blob)
                for note in root:
                    if note.get(qn('w:type'), 'normal') != 'normal': continue
                    self.items[(kind, note.get(qn('w:id')))] = (note, part)

    def reference(self, element, paragraph, container=None):
        from docx.oxml.ns import qn
        from docx.text.paragraph import Paragraph
        from uuid import uuid4
        kind = element.tag.rsplit('}', 1)[-1].removesuffix('Reference')
        if element.get(qn('w:customMarkFollows')) in ('1','true','on'):
            raise ValueError('Custom Word note reference marks are unsupported. The source file has been preserved.')
        entry = self.items.get((kind, element.get(qn('w:id'))))
        if not entry: raise ValueError('A Word note reference has no note body. The source file has been preserved.')
        note, part = entry
        if any(node.tag in (qn('w:footnoteReference'),qn('w:endnoteReference')) for node in note.iter()):
            raise ValueError('Nested Word notes are unsupported. The source file has been preserved.')
        owner = type('NoteOwner', (), {'part': part})()
        content = []
        if container is not None:
            from docx.blkcntnr import BlockItemContainer
            content = container(BlockItemContainer(copy.deepcopy(note),owner))
            first = content[0] if content else None
            # The note reference is a silent native field. Strip only its
            # separating space, never list numbering or the first authored word.
            if first and first['type']=='paragraph' and first.get('content') and first['content'][0]['type']=='text':
                value=first['content'][0]['text']
                first['content'][0]['text']=value[1:] if value[:1] in (' ','\t') else value
                if not first['content'][0]['text']:first['content'].pop(0)
        for child in note:
            if container is not None:break
            if child.tag == qn('w:p'):
                node = paragraph(Paragraph(copy.deepcopy(child), owner))
                # The native reference marker has no authored wording; Word
                # separates it from the first paragraph by one space/tab.
                if not content and node.get('content') and node['content'][0]['type'] == 'text':
                    value = node['content'][0]['text']
                    node['content'][0]['text'] = value[1:] if value[:1] in (' ', '\t') else value
                    if not node['content'][0]['text']: node['content'].pop(0)
                content.append(node)
            else:
                text = ''.join(t.text or '' for t in child.iter(qn('w:t')))
                if text: content.append({'type':'paragraph', 'content':[{'type':'text', 'text':text}]})
                message = 'A complex Word note object was converted to text; inspect the original for its layout.'
                if message not in self.warnings: self.warnings.append(message)
        from .publishing import _normalise_import_blocks
        body = _normalise_import_blocks({'type':'doc', 'content':content or [{'type':'paragraph'}]})
        value = {'blockId':'note_' + uuid4().hex, 'kind':kind, 'body':body}
        validate_note(value)
        return {'type':'document_note', 'attrs':value}


def html_note(attrs, number, resources=None):
    import html
    from .running_matter import portable_story
    value = {'kind':attrs['kind'],'body':portable_story(attrs['body'],resources)}
    identifier = attrs['blockId']
    return '<sup data-document-note="' + html.escape(json.dumps(value, ensure_ascii=False), quote=True) + '" data-note-id="' + html.escape(identifier, quote=True) + '"><a href="#note_' + html.escape(identifier, quote=True) + '">' + html.escape(str(number)) + '</a></sup>'


def number_notes(documents,settings=None):
    from .page_numbering import format_page_number
    from .note_options import note_options
    options=note_options(settings)
    counters=dict.fromkeys(KINDS,0);totals=dict.fromkeys(KINDS,0)
    def walk(node):
        nonlocal options
        if any(mark['type']=='revision_deletion' for mark in node.get('marks',[])) or node['type']=='table_of_contents':return
        if node['type']=='section_break':
            if node.get('attrs',{}).get('noteOptions') is not None:options=note_options(node['attrs']['noteOptions'])
            for kind in KINDS:counters[kind]=0
        if node['type']=='document_note':
            attrs=node['attrs'];kind=attrs['kind'];counters[kind]+=1;totals[kind]+=1
            count=counters[kind] if options[kind]['restart']=='section' else totals[kind]
            attrs['_noteLabel']=format_page_number(count+options[kind]['start']-1,options[kind]['format'])
        for child in node.get('content',[]):walk(child)
    for document in documents:walk(document)


def text_with_note_references(document):
    from .models import document_text
    def prepare(node):
        if node['type'] == 'document_note':
            attrs = node['attrs']
            return {'type':'text','text':'[' + ('Footnote ' if attrs['kind']=='footnote' else 'Endnote ') + attrs.get('_noteLabel','1') + ']'}
        return {**node, 'content':[prepare(child) for child in node.get('content',[])]} if 'content' in node else node
    return document_text(prepare(document))


def restore_note_references(document):
    """Bind a verified one-note Word bookmark back to the note identity.

    Only Alder's generated ranges are removed; a user's named bookmark stays.
    Repeated DOCX/HTML exchange must not accumulate synthetic destinations.
    """
    targets={}
    def scan(node):
        children=node.get('content',[]);output=[];at=0
        while at<len(children):
            start=children[at]
            if at+2<len(children) and start['type']=='bookmark' and children[at+1]['type']=='document_note' and children[at+2]['type']=='bookmark_end':
                attrs=start['attrs'];end=children[at+2]['attrs'];note=children[at+1]
                if end.get('targetId')==attrs.get('blockId') or end.get('name')==attrs.get('name'):
                    for key in (attrs.get('blockId'),attrs.get('name')):
                        if key:targets[key]=note['attrs']['blockId']
                    if attrs.get('name','').startswith('AlderNote_'):
                        output.append(note);at+=3;continue
            scan(start);output.append(start);at+=1
        if 'content' in node:node['content']=output
    scan(document)
    def bind(node):
        attrs=node.get('attrs',{})
        if node['type']=='cross_reference' and attrs.get('targetId') in targets:attrs['targetId']=targets[attrs['targetId']]
        for mark in node.get('marks',[]):
            target=mark.get('attrs',{}).get('href','')
            if mark['type']=='link' and target.startswith('#') and target[1:] in targets:mark['attrs']['href']='#'+targets[target[1:]]
        for child in node.get('content',[]):bind(child)
    bind(document)
