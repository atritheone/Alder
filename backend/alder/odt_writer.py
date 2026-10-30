"""Editable ODF text packages using native paragraphs, lists, tables and notes.

This deliberately does not embed a private Alder document as an interchange
shortcut. Unsupported features are reported by the ordinary export warning UI.
"""
import hashlib
import json
import re
import zipfile
import xml.etree.ElementTree as ET

from .odt_styles import q, element, text_properties, paragraph_properties

MIME = 'application/vnd.oasis.opendocument.text'
NUMBER_FORMATS = {'decimal':'1','lower-alpha':'a','upper-alpha':'A','lower-roman':'i','upper-roman':'I'}


class Writer:
    def __init__(self, project, settings, warnings):
        from .publishing import _Resources
        self.project, self.settings, self.warnings = project, settings, warnings
        self.resources = _Resources(project, settings, warnings)
        self.content = ET.Element(q('office:document-content'), {q('office:version'):'1.3'})
        self.fonts = element(self.content, 'office:font-face-decls')
        self.automatic = element(self.content, 'office:automatic-styles')
        self.body = element(element(self.content, 'office:body'), 'office:text')
        self.styles = ET.Element(q('office:document-styles'), {q('office:version'):'1.3'})
        self.style_fonts = element(self.styles, 'office:font-face-decls')
        self.common = element(self.styles, 'office:styles')
        self.page_styles = element(self.styles, 'office:automatic-styles')
        self.masters = element(self.styles, 'office:master-styles')
        self.cache, self.font_names, self.files = {}, {}, {}
        self.table_count = self.note_count = 0

    def warn(self, message):
        if message not in self.warnings: self.warnings.append(message)

    def font(self, name):
        if name not in self.font_names:
            identifier = 'F' + str(len(self.font_names) + 1)
            self.font_names[name] = identifier
            for parent in (self.fonts, self.style_fonts):
                element(parent, 'style:font-face', {'style:name':identifier, 'svg:font-family':name})
        return self.font_names[name]

    def style(self, family, properties=None, characters=None, tabs=None, master=None):
        key = json.dumps([family, properties, characters, tabs, master], sort_keys=True)
        if key in self.cache: return self.cache[key]
        name = 'A' + str(len(self.cache) + 1)
        self.cache[key] = name
        node = element(self.automatic, 'style:style', {'style:name':name, 'style:family':family, 'style:master-page-name':master})
        if properties or tabs is not None:
            props = element(node, 'style:' + family + '-properties', properties)
            if tabs is not None:
                stops = element(props, 'style:tab-stops')
                for stop in tabs:
                    attrs = {'style:position':f"{stop['position']:g}pt", 'style:type':'char' if stop['align']=='decimal' else stop['align']}
                    if stop['align']=='decimal': attrs['style:char']='.'
                    if stop['leader'] != 'none': attrs.update({'style:leader-style':'solid', 'style:leader-text':{'dot':'.','dash':'-','line':'_'}[stop['leader']]})
                    element(stops, 'style:tab-stop', attrs)
        if characters: element(node, 'style:text-properties', characters)
        return name

    @staticmethod
    def append_text(parent, value):
        # ODF collapses XML whitespace. Explicit space/tab elements preserve
        # leading, repeated and trailing spaces and authored tab characters.
        for part in re.split(r'( +|\t|\n)', value):
            if not part: continue
            if part.startswith(' '): element(parent, 'text:s', {'text:c':len(part)})
            elif part=='\t': element(parent, 'text:tab')
            elif part=='\n': element(parent, 'text:line-break')
            elif len(parent): parent[-1].tail = (parent[-1].tail or '') + part
            else: parent.text = (parent.text or '') + part

    def inline(self, parent, node):
        from .publishing import _safe_link, plain_text
        kind, attrs = node['type'], node.get('attrs', {})
        marks = node.get('marks', [])
        if any(mark['type'].startswith('revision_') for mark in marks):
            raise ValueError('ODT does not preserve tracked changes. Choose the final or original review view, or save as Alder/DOCX.')
        link = next((m.get('attrs', {}).get('href') for m in marks if m['type']=='link'), None)
        if link and _safe_link(link): parent = element(parent, 'text:a', {'xlink:href':link, 'xlink:type':'simple'})
        properties = text_properties({}, marks, self.font)
        if properties: parent = element(parent, 'text:span', {'text:style-name':self.style('text', characters=properties)})
        if kind=='text': self.append_text(parent, node.get('text', ''))
        elif kind=='hard_break': element(parent, 'text:line-break')
        elif kind in ('inline_image','image'): self.picture(parent, attrs)
        elif kind=='document_note':
            from .document_notes import prepared_body
            self.note_count += 1
            note = element(parent, 'text:note', {'text:id':'note'+str(self.note_count), 'text:note-class':attrs['kind']})
            element(note, 'text:note-citation', text=attrs.get('_noteLabel', str(self.note_count)))
            body = element(note, 'text:note-body')
            for child in prepared_body(attrs['body'])['content']: self.block(body, child)
        elif kind=='bookmark': element(parent, 'text:bookmark-start' if attrs.get('range') else 'text:bookmark', {'text:name':attrs['name']})
        elif kind=='bookmark_end':
            if attrs.get('targetName') and not attrs.get('unresolved'): element(parent, 'text:bookmark-end', {'text:name':attrs['targetName']})
        elif kind=='document_field' and attrs.get('fieldKind') in ('page','pageCount','title','author','subject'):
            tag = {'page':'page-number','pageCount':'page-count','title':'title','author':'initial-creator','subject':'subject'}[attrs['fieldKind']]
            field_attrs = {'text:select-page':'current'} if tag=='page-number' else {}
            field = element(parent, 'text:'+tag, field_attrs)
            self.append_text(field, plain_text(node) or '1')
        elif kind in ('comment_anchor', 'index_entry'):
            self.warn('ODT omits review comments and index markers. Retain Alder or DOCX for those editable features.')
        elif kind=='form_field':
            self.warn('ODT keeps form field values as ordinary text; field types and editing restrictions are not retained. Use Alder or DOCX for editable forms.')
            for child in node.get('content', []): self.inline(parent,child)
        elif kind=='text_box':
            self.warn('ODT converts text boxes to their formatted wording at the anchor; box geometry is not retained.')
            for child in node.get('content', []): self.inline(parent, child)
        else:
            self.warn('ODT keeps calculated references, citations and other unsupported fields as their current wording; they will not update automatically.')
            for child in node.get('content', []): self.inline(parent, child)

    def picture(self, parent, attrs):
        image = self.resources.image(attrs)
        if not image: return
        path = 'Pictures/' + hashlib.sha256(image['data']).hexdigest() + '.png'
        self.files[path] = image['data']
        width = attrs.get('width') or image['width']
        height = attrs.get('height') or image['height'] * width / image['width']
        frame = element(parent, 'draw:frame', {'draw:name':'Image'+str(len(self.files)), 'text:anchor-type':'as-char', 'svg:width':f'{width*.75:g}pt', 'svg:height':f'{height*.75:g}pt'})
        element(frame, 'draw:image', {'xlink:href':path, 'xlink:type':'simple', 'xlink:show':'embed', 'xlink:actuate':'onLoad'})
        if attrs.get('alt'): element(frame, 'svg:desc', text=attrs['alt'])
        if attrs.get('wrap') not in (None, 'none'):
            self.warn('ODT converts wrapped pictures to inline placement; their dimensions and alternative text are retained.')

    def block(self, parent, node, depth=0):
        if depth>50: raise ValueError('ODT structure is too deeply nested.')
        kind, attrs = node['type'], node.get('attrs', {})
        if kind=='form_block':
            self.warn('ODT keeps form content as ordinary blocks, without editable fields or restrictions.')
            for child in node['content']:self.block(parent,child,depth)
        elif kind in ('paragraph','heading','code_block'):
            values = dict(attrs)
            if kind=='heading':
                from .publishing import DOCUMENT_FORMAT
                values = {**DOCUMENT_FORMAT['heading'], 'fontSize':DOCUMENT_FORMAT['headingSizes'][attrs.get('level', 1)-1], **values}
            if kind=='code_block': values['fontFamily']='Consolas'
            style = self.style('paragraph', paragraph_properties(values), text_properties(values, [{'type':'strong'}] if kind=='heading' else [], self.font), values.get('tabStops'))
            p = element(parent, 'text:h' if kind=='heading' else 'text:p', {'text:style-name':style, **({'text:outline-level':attrs.get('level', 1)} if kind=='heading' else {})})
            if attrs.get('captionLabel'): self.warn('ODT retains caption wording and typography, but not automatic caption numbering.')
            for child in node.get('content', []): self.inline(p, child)
        elif kind in ('bullet_list','ordered_list'):
            name = 'List' + str(len(self.automatic))
            listing = element(self.automatic, 'text:list-style', {'style:name':name})
            template = attrs.get('listTemplate')
            for level in range(1, 11):
                level_attrs = {'text:level':level}
                if kind=='ordered_list':
                    spec = template[min(level-1, 8)] if template else {}
                    level_attrs.update({'style:num-format':NUMBER_FORMATS.get(spec.get('format') or attrs.get('listStyle'), '1'), 'style:num-suffix':'.', 'text:start-value':spec.get('start', 1)})
                    if template:
                        self.warn('ODT converts custom outline numbering to ordinary numbered levels; retain Alder or DOCX for custom patterns and restart rules.')
                    entry = element(listing, 'text:list-level-style-number', level_attrs)
                else:
                    level_attrs['text:bullet-char']={'circle':'\u25e6','square':'\u25aa'}.get(attrs.get('listStyle'), '\u2022')
                    entry = element(listing, 'text:list-level-style-bullet', level_attrs)
                element(entry, 'style:list-level-properties', {'text:space-before':f'{level*18:g}pt','text:min-label-width':'18pt'})
            output = element(parent, 'text:list', {'text:style-name':name})
            for i, item in enumerate(node.get('content', [])):
                value = {'text:start-value':attrs.get('order', 1)} if kind=='ordered_list' and i==0 else {}
                li = element(output, 'text:list-item', value)
                for child in item.get('content', []): self.block(li, child, depth+1)
        elif kind=='table': self.table(parent, node, depth)
        elif kind=='image': self.picture(element(parent, 'text:p'), attrs)
        elif kind in ('page_break','section_break','column_break'):
            if kind!='page_break': self.warn('ODT converts section and column breaks to page breaks and uses the document-wide page layout.')
            element(parent, 'text:p', {'text:style-name':self.style('paragraph', {'fo:break-before':'page'})})
        elif kind=='horizontal_rule':
            element(parent, 'text:p', {'text:style-name':self.style('paragraph', {'fo:border-bottom':'0.75pt solid #999999'})})
        else:
            if kind not in ('doc','blockquote','list_item'):
                self.warn('ODT retains generated contents, bibliography and unsupported containers as ordinary editable blocks.')
            if kind=='blockquote': self.warn('ODT keeps blockquote wording and character formatting without its container decoration.')
            for child in node.get('content', []): self.block(parent, child, depth+1)

    def table(self, parent, node, depth):
        from .docx_support import table_grid
        self.table_count += 1
        rows = node.get('content', [])
        columns, placed = table_grid(rows)
        anchors = {(r,c):(height,width,cell) for r,c,height,width,cell in placed}
        covered = {(rr,cc) for r,c,h,w,_ in placed for rr in range(r,r+h) for cc in range(c,c+w) if (r,c)!=(rr,cc)}
        widths = [0]*columns
        for _, c, _, _, cell in placed:
            for i,width in enumerate(cell.get('attrs', {}).get('colwidth') or []): widths[c+i] = width or widths[c+i]
        from .page_geometry import page_geometry
        geometry = page_geometry(self.settings)
        available = (geometry['width'] - geometry['margins']['left'] - geometry['margins']['right'])*72/25.4
        widths = [value*.75 if value else available/columns for value in widths]
        output = element(parent, 'table:table', {'table:name':'Table'+str(self.table_count), 'table:style-name':self.style('table', {'style:width':f'{sum(widths):g}pt','table:align':node.get('attrs', {}).get('align') or 'left','table:border-model':'collapsing'})})
        for width in widths:
            element(output, 'table:table-column', {'table:style-name':self.style('table-column', {'style:column-width':f'{width:g}pt'})})
        headers = None
        for r,row in enumerate(rows):
            is_header = bool(row.get('content')) and all(cell['type']=='table_header' for cell in row['content'])
            if is_header and (r==0 or headers is not None):
                if headers is None: headers = element(output, 'table:table-header-rows')
                target = headers
            else: headers = None; target = output
            props = {'fo:keep-together':'auto' if row.get('attrs', {}).get('allowSplit') else 'always'}
            if row.get('attrs', {}).get('minHeight'): props['style:min-row-height']=f"{row['attrs']['minHeight']:g}pt"
            tr = element(target, 'table:table-row', {'table:style-name':self.style('table-row', props)})
            for c in range(columns):
                if (r,c) in covered: element(tr, 'table:covered-table-cell'); continue
                h,w,cell = anchors.get((r,c), (1,1,{'content':[{'type':'paragraph'}]}))
                attrs = cell.get('attrs', {})
                props = {'fo:border':f"{attrs.get('borderWidth') if attrs.get('borderWidth') is not None else .75:g}pt solid {attrs.get('borderColor') or '#999999'}", 'style:vertical-align':attrs.get('verticalAlign') or 'top'}
                for side in ('Top','Bottom','Left','Right'): props['fo:padding-'+side.lower()]=f"{attrs.get('padding'+side) if attrs.get('padding'+side) is not None else 5.25:g}pt"
                if attrs.get('background'): props['fo:background-color']=attrs['background']
                td = element(tr, 'table:table-cell', {'table:style-name':self.style('table-cell', props), 'table:number-columns-spanned':w if w>1 else None, 'table:number-rows-spanned':h if h>1 else None})
                for child in cell.get('content', []): self.block(td, child, depth+1)

    def finish(self, path, sections):
        from .page_geometry import page_geometry
        from .running_matter import legacy_running_matter
        settings = self.settings
        default = element(self.common, 'style:default-style', {'style:family':'paragraph'})
        element(default, 'style:paragraph-properties', {'fo:line-height':f"{settings['lineHeight']*100:g}%"})
        element(default, 'style:text-properties', text_properties(settings, [], self.font))
        geometry = page_geometry(settings)
        layout = element(self.page_styles, 'style:page-layout', {'style:name':'Page'})
        props = {'fo:page-width':f"{geometry['width']:g}mm", 'fo:page-height':f"{geometry['height']:g}mm", 'style:print-orientation':settings['orientation'], 'style:num-format':NUMBER_FORMATS.get(settings.get('pageNumberFormat'), '1')}
        props.update({'fo:margin-'+edge:f'{value:g}mm' for edge,value in geometry['margins'].items()})
        element(layout, 'style:page-layout-properties', props)
        master = element(self.masters, 'style:master-page', {'style:name':'Standard','style:page-layout-name':'Page'})
        running = settings.get('runningMatter') or legacy_running_matter(settings)
        if running.get('differentFirst') or running.get('differentEven'):
            self.warn('ODT uses the default header and footer on every page; first/even page variants are not retained.')
        for part in ('header','footer'):
            story = running.get(part, {}).get('default')
            if story:
                target = element(master, 'style:'+part)
                for child in story['content']: self.block(target, child)
        # Styles used in master-page stories must live in styles.xml.
        for child in list(self.automatic): self.automatic.remove(child); self.common.append(child)
        for key in ('columns','mirrorMargins','watermark','pageBorder','lineNumbering','hyphenation'):
            if settings.get(key): self.warn('ODT does not retain advanced page decoration, columns, mirrored margins or automatic hyphenation; use DOCX or desktop PDF for that layout.')
        if settings.get('noteOptions'): self.warn('ODT uses continuous Arabic note numbering and document-end endnotes; custom note numbering and section placement are not retained.')
        if settings.get('includeTitle'):
            self.block(self.body, {'type':'heading','attrs':{'level':1},'content':[{'type':'text','text':self.project.get('name','Untitled')}]})
            if settings.get('author'): self.block(self.body, {'type':'paragraph','content':[{'type':'text','text':settings['author']}]})
        for section in sections:
            if section.get('title'): self.block(self.body, {'type':'heading','attrs':{'level':1},'content':[{'type':'text','text':section['title']}]})
            for node in section['blocks']: self.block(self.body, node)
        if not len(self.body): element(self.body, 'text:p')
        if settings.get('firstPageNumber',1)!=1:
            self.warn('ODT starts page numbering at 1; custom starting numbers are not retained.')
        meta = ET.Element(q('office:document-meta'), {q('office:version'):'1.3'})
        metadata = element(meta, 'office:meta')
        element(metadata, 'dc:title', text=self.project.get('name','Untitled'))
        for key,tag in [('author','meta:initial-creator'),('subject','dc:subject'),('description','dc:description')]:
            if settings.get(key): element(metadata, tag, text=settings[key])
        files = {**self.files, **{name:ET.tostring(root, encoding='utf-8', xml_declaration=True) for name,root in [('content.xml',self.content),('styles.xml',self.styles),('meta.xml',meta)]}}
        manifest = ET.Element(q('manifest:manifest'), {q('manifest:version'):'1.3'})
        element(manifest, 'manifest:file-entry', {'manifest:full-path':'/', 'manifest:media-type':MIME, 'manifest:version':'1.3'})
        for name in files: element(manifest, 'manifest:file-entry', {'manifest:full-path':name,'manifest:media-type':'image/png' if name.endswith('.png') else 'text/xml'})
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('mimetype', MIME, compress_type=zipfile.ZIP_STORED)
            for name,data in files.items(): archive.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)
            archive.writestr('META-INF/manifest.xml', ET.tostring(manifest,encoding='utf-8',xml_declaration=True), compress_type=zipfile.ZIP_DEFLATED)


def write_odt(project, path, settings, sections, warnings):
    Writer(project, settings, warnings).finish(path, sections)
