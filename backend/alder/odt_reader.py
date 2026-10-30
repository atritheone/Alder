"""Bounded, offline OpenDocument text import; no macros or external resources."""
import copy
import re
import uuid
from pathlib import PurePosixPath
from urllib.parse import unquote, urlparse

from .odt_styles import q, Styles, length, colour, number
from .odt_writer import MIME, NUMBER_FORMATS


class Reader:
    def __init__(self, archive, roots, warnings, assets):
        self.archive, self.warnings, self.assets = archive, warnings, assets
        self.styles = Styles(roots)
        self.nodes = 0
        self.characters = 0
        self.bookmarks = {}
        self.used_bookmarks = set()
        self.lists = {}
        self.used_masters = []

    def warn(self, message):
        if message not in self.warnings: self.warnings.append(message)

    def budget(self, count=1):
        self.nodes += count
        if self.nodes>250000: raise ValueError('OpenDocument expands to too many editable objects.')

    def text(self, value, marks):
        self.characters += len(value)
        if self.characters>10000000: raise ValueError('OpenDocument expands to too much text.')
        return [{'type':'text','text':value, **({'marks':copy.deepcopy(marks)} if marks else {})}] if value else []

    def bookmark(self, original):
        if original not in self.bookmarks:
            name = re.sub('[^A-Za-z0-9_]', '_', original)[:39] or 'Bookmark'
            if not name[0].isalpha(): name='B'+name
            base = name; suffix = 1
            while name.lower() in self.used_bookmarks:
                suffix += 1; name=base[:34]+'_'+str(suffix)
            self.used_bookmarks.add(name.lower())
            self.bookmarks[original] = (uuid.uuid4().hex, name)
        return self.bookmarks[original]

    def inline(self, node, properties, depth=0):
        if depth>50: raise ValueError('OpenDocument text is too deeply nested.')
        self.budget()
        marks = self.styles.characters(properties)
        output = self.text(node.text or '', marks)
        for child in node:
            tag = child.tag
            if tag in (q('text:span'),q('text:a')):
                local = {**properties, **self.styles.resolve('text', child.get(q('text:style-name'), ''))}
                items = self.inline(child, local, depth+1)
                if tag==q('text:a'):
                    from .publishing import _safe_link
                    href = child.get(q('xlink:href'), '')
                    if href.startswith('#'): href='#'+self.bookmark(unquote(href[1:]))[0]
                    href = _safe_link(href)
                    if href:
                        for item in items:
                            if item['type'] in ('text','inline_image'): item.setdefault('marks', []).append({'type':'link','attrs':{'href':href}})
                    else: self.warn('An unsafe or external-file link was retained as wording without an active link.')
                output.extend(items)
            elif tag==q('text:s'): output.extend(self.text(' '*number(child.get(q('text:c'), '1'),maximum=1000000), marks))
            elif tag==q('text:tab'): output.extend(self.text('\t', marks))
            elif tag==q('text:line-break'): output.append({'type':'hard_break'})
            elif tag==q('draw:frame'): output.extend(self.frame(child, depth+1))
            elif tag==q('text:note'):
                body = child.find(q('text:note-body'))
                if body is None: raise ValueError('OpenDocument note is missing its body.')
                content = self.blocks(body, depth+1, story=True)
                output.append({'type':'document_note','attrs':{'blockId':uuid.uuid4().hex,'kind':'endnote' if child.get(q('text:note-class'))=='endnote' else 'footnote','body':{'type':'doc','content':content or [{'type':'paragraph'}]}}})
            elif tag in (q('text:bookmark'),q('text:bookmark-start')):
                identifier, name = self.bookmark(child.get(q('text:name'), 'Bookmark'))
                output.append({'type':'bookmark','attrs':{'blockId':identifier,'name':name,'range':tag==q('text:bookmark-start')}})
            elif tag==q('text:bookmark-end'):
                identifier, _ = self.bookmark(child.get(q('text:name'), 'Bookmark'))
                output.append({'type':'bookmark_end','attrs':{'targetId':identifier}})
            elif tag in (q('text:page-number'),q('text:page-count'),q('text:title'),q('text:initial-creator'),q('text:subject')):
                field = {q('text:page-number'):'page',q('text:page-count'):'pageCount',q('text:title'):'title',q('text:initial-creator'):'author',q('text:subject'):'subject'}[tag]
                output.append({'type':'document_field','attrs':{'fieldKind':field},'content':self.text(''.join(child.itertext()) or '1', marks)})
            elif tag==q('text:soft-page-break'): pass
            elif tag in (q('office:annotation'),q('office:annotation-end')):
                raise ValueError('This OpenDocument contains review comments. Save it as DOCX to retain editable comments when opening in Alder.')
            elif tag in (q('text:change'),q('text:change-start'),q('text:change-end')):
                raise ValueError('This OpenDocument contains tracked changes. Save it as DOCX to retain review history, or resolve changes in the source application first.')
            else:
                self.warn('Unsupported OpenDocument fields or inline objects were converted to their displayed wording; they will not update automatically.')
                output.extend(self.inline(child, properties, depth+1))
            output.extend(self.text(child.tail or '', marks))
        return output

    def frame(self, node, depth):
        from .publishing import _asset_from_bytes
        picture = node.find(q('draw:image'))
        if picture is not None:
            href = unquote(picture.get(q('xlink:href'), ''))
            path = PurePosixPath(href)
            if not href or urlparse(href).scheme or path.is_absolute() or '..' in path.parts or '\\' in href:
                raise ValueError('An OpenDocument picture is external or has an unsafe path. Embed it in the source document before opening.')
            try: data=self.archive.read(str(path))
            except KeyError as error: raise ValueError('An OpenDocument picture is missing from its package.') from error
            asset = _asset_from_bytes(data, path.name, self.assets, self.warnings)
            if not asset: raise ValueError('An OpenDocument picture could not be decoded as a supported raster image.')
            attrs = {'assetId':asset,'alt':node.findtext(q('svg:desc')) or node.findtext(q('svg:title')) or ''}
            width=length(node.get(q('svg:width')))
            if width and width>0: attrs['width']=max(1,min(10000,width*96/72))
            height=length(node.get(q('svg:height')))
            if width and height:
                import io
                from PIL import Image
                with Image.open(io.BytesIO(data)) as image:
                    if abs(width/height-image.width/image.height)>.02:
                        self.warn('A stretched OpenDocument picture is restored to its natural aspect ratio at the imported width.')
            if node.get(q('text:anchor-type')) not in (None,'as-char'):
                self.warn('OpenDocument anchored pictures are converted to inline placement.')
            return [{'type':'inline_image','attrs':attrs}]
        text_box=node.find(q('draw:text-box'))
        if text_box is not None:
            self.warn('OpenDocument text boxes retain their wording at the anchor without box geometry.')
            blocks=self.blocks(text_box,depth+1)
            from .publishing import plain_text
            return self.text(plain_text({'type':'doc','content':blocks}), [])
        raise ValueError('This OpenDocument contains a drawing or embedded object that Alder cannot preserve. Export it as DOCX or replace the object with a picture first.')

    def blocks(self, container, depth=0, list_style=None, list_level=1, story=False):
        if depth>50: raise ValueError('OpenDocument structure is too deeply nested.')
        result=[]
        list_names={}
        for node in container:
            self.budget()
            tag=node.tag
            if tag in (q('text:p'),q('text:h')):
                props=self.styles.resolve('paragraph',node.get(q('text:style-name'),''))
                attrs=self.styles.paragraph(props)
                if props.get('_master') and props['_master'] not in self.used_masters: self.used_masters.append(props['_master'])
                kind='heading' if tag==q('text:h') and not story else 'paragraph'
                if kind=='heading': attrs['level']=max(1,min(6,number(node.get(q('text:outline-level'),'1'),maximum=100)))
                result.append({'type':kind,'attrs':attrs,'content':self.inline(node,props,depth+1)})
                if props.get(q('fo:break-after'))=='page' and not story: result.append({'type':'page_break'})
            elif tag==q('text:list'):
                name=node.get(q('text:style-name')) or list_style
                style=self.styles.lists.get(name)
                levels=list(style) if style is not None else []
                level=next((entry for entry in levels if entry.get(q('text:level'))==str(list_level)), levels[0] if levels else None)
                ordered=level is not None and level.tag==q('text:list-level-style-number')
                attrs={}
                if ordered:
                    attrs.update(order=number(level.get(q('text:start-value'),'1'),maximum=999999),listStyle={v:k for k,v in NUMBER_FORMATS.items()}.get(level.get(q('style:num-format')),'decimal'))
                else: attrs['listStyle']={'\u25e6':'circle','\u25aa':'square','\u25a0':'square'}.get(level.get(q('text:bullet-char')) if level is not None else None,'disc')
                items=[]
                prior=self.lists.get(node.get(q('text:continue-list')))
                if ordered and prior: attrs['order']=prior
                elif ordered and node.get(q('text:continue-numbering'))=='true': attrs['order']=self.lists.get(('style',name),attrs['order'])
                for item in node:
                    if item.tag==q('text:list-header'):
                        result.extend(self.blocks(item,depth+1,story=story));continue
                    if item.tag!=q('text:list-item'): raise ValueError('Unsupported OpenDocument list structure.')
                    explicit=item.get(q('text:start-value'))
                    if explicit:
                        if items:
                            result.append({'type':'ordered_list' if ordered else 'bullet_list','attrs':dict(attrs),'content':items});items=[]
                        attrs['order']=number(explicit,maximum=999999)
                    children=self.blocks(item,depth+1,name,list_level+1,story)
                    # Word writes a changed nested list style as a separate
                    # outer list containing only a nested list. That outer
                    # item is an indentation scaffold, not an empty bullet.
                    if children and all(child['type'] in ('ordered_list','bullet_list') for child in children):
                        previous=items[-1] if items else result[-1]['content'][-1] if result and result[-1]['type'] in ('ordered_list','bullet_list') else None
                        if previous is not None:
                            previous['content'].extend(children)
                            continue
                    if not children or children[0]['type']!='paragraph': children.insert(0,{'type':'paragraph'})
                    items.append({'type':'list_item','content':children})
                if items:
                    kind='ordered_list' if ordered else 'bullet_list'
                    previous=result[-1] if result else None
                    continuing=node.get(q('text:continue-numbering'))=='true' or bool(node.get(q('text:continue-list')))
                    if continuing and previous and previous['type']==kind and list_names.get(id(previous))==name and (not ordered or previous['attrs']['order']+len(previous['content'])==attrs['order']):
                        previous['content'].extend(items)
                    else:
                        result.append({'type':kind,'attrs':attrs,'content':items})
                        list_names[id(result[-1])]=name
                if ordered:
                    next_value=attrs['order']+len(items)
                    identifier=node.get('{http://www.w3.org/XML/1998/namespace}id')
                    if identifier: self.lists[identifier]=next_value
                    self.lists[('style',name)]=next_value
                if level is not None and (level.get(q('text:display-levels'),'1')!='1' or level.get(q('style:num-prefix')) or level.get(q('style:num-suffix'),'.')!='.'):
                    self.warn('Custom OpenDocument list labels are converted to ordinary list numbering.')
            elif tag==q('table:table'): result.append(self.table(node,depth+1,story))
            elif tag in (q('text:section'),q('text:index-body')):
                if tag==q('text:section'): self.warn('OpenDocument sections are retained in reading order using the document-wide page layout.')
                result.extend(self.blocks(node,depth+1,story=story))
            elif tag in (q('text:table-of-content'),q('text:alphabetical-index'),q('text:bibliography'),q('text:illustration-index')):
                body=node.find(q('text:index-body'))
                if body is not None: result.extend(self.blocks(body,depth+1,story=story))
                self.warn('OpenDocument generated contents and indexes retain their displayed wording without automatic updates.')
            elif tag==q('text:tracked-changes'):
                if len(node): raise ValueError('This OpenDocument contains tracked changes. Save it as DOCX to retain review history, or resolve changes in the source application first.')
            elif tag in (q('text:sequence-decls'),q('text:variable-decls'),q('text:user-field-decls'),q('text:dde-connection-decls'),q('text:soft-page-break')): pass
            elif tag==q('draw:frame'): result.append({'type':'paragraph','content':self.frame(node,depth+1)})
            else:
                # Reject unknown block containers instead of silently dropping
                # embedded objects, review content or important authored text.
                raise ValueError('This OpenDocument contains an unsupported structure ('+tag.rsplit('}',1)[-1]+'). Save it as DOCX before opening in Alder.')
        return result

    def table(self, node, depth, story):
        columns=[]; raw_rows=[]
        def collect(parent, header=False):
            for child in parent:
                if child.tag==q('table:table-column'):
                    props=self.styles.resolve('table-column',child.get(q('table:style-name'),''))
                    width=length(props.get(q('style:column-width')))
                    count=number(child.get(q('table:number-columns-repeated'),'1'),maximum=1000)
                    if len(columns)+count>1000: raise ValueError('OpenDocument table has too many columns.')
                    columns.extend([width*96/72 if width else 0]*count)
                elif child.tag==q('table:table-row'):
                    count=number(child.get(q('table:number-rows-repeated'),'1'),maximum=10000)
                    if len(raw_rows)+count>10000: raise ValueError('OpenDocument table has too many rows.')
                    raw_rows.extend([(child,header)]*count)
                elif child.tag in (q('table:table-header-rows'),q('table:table-rows'),q('table:table-row-group'),q('table:table-columns'),q('table:table-column-group')):
                    collect(child,header or child.tag==q('table:table-header-rows'))
                else: raise ValueError('Unsupported OpenDocument table structure.')
        collect(node)
        rows=[]; occupied=set(); max_columns=len(columns)
        for r,(raw,header) in enumerate(raw_rows):
            self.budget(); cells=[]; c=0
            for item in raw:
                count=number(item.get(q('table:number-columns-repeated'),'1'),maximum=1000)
                for _ in range(count):
                    self.budget()
                    if item.tag==q('table:covered-table-cell'):
                        if (r,c) not in occupied: raise ValueError('OpenDocument table has an unanchored covered cell.')
                        c+=1;continue
                    if item.tag!=q('table:table-cell') or (r,c) in occupied: raise ValueError('OpenDocument table cells overlap.')
                    w=number(item.get(q('table:number-columns-spanned'),'1'),maximum=1000)
                    h=number(item.get(q('table:number-rows-spanned'),'1'),maximum=1000)
                    if not w or not h or c+w>1000 or r+h>len(raw_rows): raise ValueError('OpenDocument table has an invalid cell span.')
                    self.budget(w*h)
                    for rr in range(r,r+h):
                        for cc in range(c,c+w):
                            if (rr,cc) in occupied: raise ValueError('OpenDocument table cells overlap.')
                            occupied.add((rr,cc))
                    attrs={'colspan':w,'rowspan':h}
                    if len(columns)>=c+w and all(columns[c:c+w]): attrs['colwidth']=columns[c:c+w]
                    props=self.styles.resolve('table-cell',item.get(q('table:style-name'),''))
                    for side in ('Top','Bottom','Left','Right'):
                        value=length(props.get(q('fo:padding-'+side.lower()),props.get(q('fo:padding'))))
                        if value is not None: attrs['padding'+side]=max(0,min(144,value))
                    background=colour(props.get(q('fo:background-color')))
                    if background: attrs['background']=background
                    align=props.get(q('style:vertical-align'))
                    if align in ('top','middle','bottom'): attrs['verticalAlign']=align
                    border=props.get(q('fo:border'),'')
                    if border=='none': attrs['borderWidth']=0
                    elif border:
                        parts=border.split(); size=length(parts[0])
                        if size is not None: attrs['borderWidth']=max(0,min(12,size))
                        if colour(parts[-1]): attrs['borderColor']=parts[-1]
                        if len(parts)>1 and parts[1]!='solid': self.warn('OpenDocument cell borders are converted to solid uniform borders.')
                    elif any(q('fo:border-'+edge) in props for edge in ('top','bottom','left','right')):
                        self.warn('OpenDocument unequal cell borders are converted to Alder default uniform borders.')
                    children=self.blocks(item,depth+1,story=story)
                    if item.get(q('table:formula')): self.warn('OpenDocument table formulas retain their displayed values without recalculation.')
                    cells.append({'type':'table_header' if header else 'table_cell','attrs':attrs,'content':children or [{'type':'paragraph'}]})
                    c+=1
            max_columns=max(max_columns,c)
            props=self.styles.resolve('table-row',raw.get(q('table:style-name'),''))
            attrs={'allowSplit':props.get(q('fo:keep-together'),'auto')!='always'}
            height=length(props.get(q('style:min-row-height'),props.get(q('style:row-height'))))
            if height is not None: attrs['minHeight']=max(0,min(1440,height))
            rows.append({'type':'table_row','attrs':attrs,'content':cells})
        if not rows: raise ValueError('OpenDocument table has no rows.')
        for r,row in enumerate(rows):
            if any((r,c) not in occupied for c in range(max_columns)): raise ValueError('OpenDocument table has an incomplete grid.')
        props=self.styles.resolve('table',node.get(q('table:style-name'),''))
        align=props.get(q('table:align'),'left')
        return {'type':'table','attrs':{'align':align if align in ('left','center','right') else 'left'},'content':rows}

    def settings(self):
        settings={'includeTitle':False,'footer':False}
        default=self.styles.paragraph(self.styles.resolve('paragraph'))
        settings.update({key:value for key,value in default.items() if key in ('fontFamily','fontSize','lineHeight')})
        master=self.styles.masters.get(next(iter(self.used_masters),''))
        if master is None: master=next(iter(self.styles.masters.values()),None)
        if len(self.used_masters)>1: self.warn('OpenDocument page-style changes are converted to the initial page layout and default running matter.')
        if master is None: return settings
        layout=self.styles.pages.get(master.get(q('style:page-layout-name')))
        props=layout.find(q('style:page-layout-properties')) if layout is not None else None
        if props is not None:
            width=length(props.get(q('fo:page-width'))); height=length(props.get(q('fo:page-height')))
            if width and height: settings.update(pageSize='Custom',orientation='portrait',pageWidthMm=width*25.4/72,pageHeightMm=height*25.4/72)
            for edge in ('top','right','bottom','left'):
                value=length(props.get(q('fo:margin-'+edge),props.get(q('fo:margin'))))
                if value is not None: settings['margin'+edge.title()+'Mm']=max(0,value*25.4/72)
            settings['pageNumberFormat']={v:k for k,v in NUMBER_FORMATS.items()}.get(props.get(q('style:num-format')),'decimal')
            if len(props) or any(q(key) in props.attrib for key in ('fo:border','style:page-usage','style:writing-mode')):
                self.warn('OpenDocument advanced page layout is converted to ordinary page geometry.')
        running={'differentFirst':False,'differentEven':False}
        for part in ('header','footer'):
            node=master.find(q('style:'+part))
            if node is not None:
                running[part]={'default':{'type':'doc','content':self.blocks(node,story=True) or [{'type':'paragraph'}]}}
            if master.find(q('style:'+part+'-left')) is not None or master.find(q('style:'+part+'-first')) is not None:
                self.warn('OpenDocument first/even page running matter is converted to the default header and footer.')
        if any(part in running for part in ('header','footer')): settings['runningMatter']=running
        return settings


def read_odt(path, warnings, assets):
    from .publishing import _zip, _xml
    with _zip(path) as archive:
        if archive.read('mimetype').decode('ascii').strip()!=MIME: raise ValueError('The file is not an OpenDocument text document.')
        manifest=_xml(archive.read('META-INF/manifest.xml'))
        if manifest.find('.//'+q('manifest:encryption-data')) is not None: raise ValueError('This OpenDocument is encrypted. Save an unencrypted copy before opening.')
        content=_xml(archive.read('content.xml'))
        roots=[content]
        if 'styles.xml' in archive.namelist(): roots.insert(0,_xml(archive.read('styles.xml')))
        reader=Reader(archive,roots,warnings,assets)
        for root in roots:
            if root.find('.//'+q('office:scripts')) is not None: reader.warn('OpenDocument scripts and macros are not imported or executed.')
        body=content.find(q('office:body')+'/'+q('office:text'))
        if body is None: raise ValueError('OpenDocument has no text body.')
        blocks=reader.blocks(body)
        settings=reader.settings()
        reader.warn('OpenDocument import retains supported text formatting, ordinary lists, tables, raster pictures, notes and default page layout. Named styles become direct formatting; advanced layout and fields may differ from the source application.')
        title=path.stem
        if 'meta.xml' in archive.namelist():
            meta=_xml(archive.read('meta.xml')).find(q('office:meta'))
            if meta is not None:
                title=meta.findtext(q('dc:title')) or title
                for key,tag in [('author','meta:initial-creator'),('subject','dc:subject'),('description','dc:description')]:
                    value=meta.findtext(q(tag))
                    if value: settings[key]=value[:10000]
        return {'type':'doc','content':blocks or [{'type':'paragraph'}]},title[:500],settings
