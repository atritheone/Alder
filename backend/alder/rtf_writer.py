"""Unicode RTF with editable text, paragraph formatting and inline raster art."""
import copy
import locale

from .rtf_syntax import escape


class Writer:
    def __init__(self,project,settings,warnings):
        from .publishing import _Resources
        self.project,self.settings,self.warnings=project,settings,warnings
        self.fonts=[];self.colours=[];self.note_kinds=set()
        self.resources=_Resources(project,settings,warnings)
        self.font(settings['fontFamily'])

    def warn(self,message):
        if message not in self.warnings:self.warnings.append(message)

    def font(self,name):
        if name not in self.fonts:self.fonts.append(name)
        return self.fonts.index(name)

    def colour(self,value):
        import re
        if not isinstance(value,str) or not re.fullmatch(r'#[\da-fA-F]{6}',value):return 0
        value=value.lower()
        if value not in self.colours:self.colours.append(value)
        return self.colours.index(value)+1

    def character(self,attrs,marks=()):
        output=''
        if attrs.get('fontFamily'):output+='\\f'+str(self.font(attrs['fontFamily']))
        if attrs.get('fontSize'):output+='\\fs'+str(round(attrs['fontSize']*2))
        if attrs.get('color'):output+='\\cf'+str(self.colour(attrs['color']))
        for mark in marks:
            kind=mark['type']
            if kind in ('strong','em','underline','strike','subscript','superscript'):
                output+='\\'+{'strong':'b','em':'i','underline':'ul','strike':'strike','subscript':'sub','superscript':'super'}[kind]
            elif kind=='text_style':output+=self.character(mark.get('attrs',{}))
            elif kind=='highlight':output+='\\highlight'+str(self.colour(mark.get('attrs',{}).get('color','#f0dc8a')))
            elif kind.startswith('revision_'):raise ValueError('RTF does not preserve tracked edits. Choose final/original view or save as Alder/DOCX.')
        return output

    def inline(self,node):
        from .publishing import _safe_link,plain_text
        kind,attrs=node['type'],node.get('attrs',{})
        if kind=='text':value=escape(node.get('text',''))
        elif kind=='_rtf_note_number':return '{\\super\\chftn} '
        elif kind=='hard_break':return '\\line '
        elif kind in ('image','inline_image'):
            image=self.resources.image(attrs)
            if not image:return ''
            width=attrs.get('width') or image['width']
            height=width*image['height']/image['width']
            value='{\\pict\\pngblip'+f"\\picw{image['width']}\\pich{image['height']}\\picwgoal{round(width*15)}\\pichgoal{round(height*15)}"
            if attrs.get('alt'):value+='{\\*\\picprop{\\sp{\\sn wzDescription}{\\sv '+escape(attrs['alt'])+'}}}'
            value+='\n'+image['data'].hex()+'}'
            if attrs.get('wrap') not in (None,'none'):self.warn('RTF converts wrapped images to inline placement.')
        elif kind=='document_note':
            from .document_notes import prepared_body
            self.note_kinds.add(attrs['kind'])
            body=prepared_body(attrs['body'])
            body['content'][0]['content']=[{'type':'_rtf_note_number'},*body['content'][0].get('content',[])]
            rendered=''.join(self.block(child) for child in body['content']).removesuffix('\\par\n')
            value='{\\super\\chftn{\\footnote'+('\\ftnalt' if attrs['kind']=='endnote' else '')+' '+rendered+'}}'
        elif kind=='bookmark':return '{\\*\\bkmkstart '+escape(attrs['name'])+'}'
        elif kind=='bookmark_end':
            return '{\\*\\bkmkend '+escape(attrs['targetName'])+'}' if attrs.get('targetName') and not attrs.get('unresolved') else ''
        elif kind in ('comment_anchor','index_entry'):
            self.warn('RTF omits review comments and index markers; retain Alder or DOCX for those features.');return ''
        elif kind=='form_field':
            self.warn('RTF keeps form field values as ordinary text; field types and editing restrictions are not retained. Use Alder or DOCX for editable forms.')
            return ''.join(self.inline({**child,'marks':node.get('marks',[])+child.get('marks',[])}) for child in node.get('content',[]))
        elif kind=='text_box':
            self.warn('RTF converts text boxes to formatted wording at their anchor, without box geometry.')
            return ''.join(self.inline(child) for child in node.get('content',[]))
        elif kind=='document_field' and attrs.get('fieldKind') in ('page','pageCount'):
            instruction='PAGE' if attrs['fieldKind']=='page' else 'NUMPAGES'
            return '{\\field{\\*\\fldinst '+instruction+'}{\\fldrslt '+escape(plain_text(node) or '1')+'}}'
        else:
            self.warn('RTF converts calculated references, citations and unsupported fields to their current wording.')
            return ''.join(self.inline(child) for child in node.get('content',[]))
        marks=node.get('marks',[])
        controls=self.character({},marks)
        if controls:value='{'+controls+' '+value+'}'
        link=next((mark.get('attrs',{}).get('href') for mark in marks if mark['type']=='link'),None)
        if link and _safe_link(link):
            if '"' not in link:value='{\\field{\\*\\fldinst HYPERLINK "'+escape(link)+'"}{\\fldrslt '+value+'}}'
            else:self.warn('RTF retains a link containing a quotation mark as ordinary text.')
        return value

    def paragraph(self,node):
        attrs={**self.settings,**node.get('attrs',{})}
        if node['type']=='heading':
            from .publishing import DOCUMENT_FORMAT
            attrs={**attrs,**DOCUMENT_FORMAT['heading'],'fontSize':DOCUMENT_FORMAT['headingSizes'][node.get('attrs',{}).get('level',1)-1],**node.get('attrs',{})}
        output='\\pard\\plain'+self.character(attrs,[{'type':'strong'}] if node['type']=='heading' else [])
        output+='\\'+{'left':'ql','right':'qr','center':'qc','justify':'qj'}.get(attrs.get('align'),'ql')
        for key,control in [('spaceBefore','sb'),('spaceAfter','sa'),('leftIndent','li'),('rightIndent','ri'),('firstLineIndent','fi')]:
            if attrs.get(key) is not None:output+='\\'+control+str(round(attrs[key]*20))
        mode=attrs.get('lineSpacingMode')
        if mode in ('exact','atLeast') and attrs.get('lineSpacing'):output+='\\sl'+str(round(attrs['lineSpacing']*20)*(-1 if mode=='exact' else 1))+'\\slmult0'
        else:output+='\\sl'+str(round(attrs.get('lineHeight',1.6)*240))+'\\slmult1'
        for key,control in [('keepTogether','keep'),('keepWithNext','keepn'),('pageBreakBefore','pagebb'),('widowOrphan','widctlpar')]:
            if attrs.get(key) is not None:output+='\\'+control+('1' if attrs[key] else '0')
        if attrs.get('textDirection'):output+='\\rtlpar' if attrs['textDirection']=='rtl' else '\\ltrpar'
        if attrs.get('textLanguage'):
            lcid=next((key for key,value in locale.windows_locale.items() if value.replace('_','-').lower()==attrs['textLanguage'].lower()),None)
            if lcid:output+='\\lang'+str(lcid)
        if node['type']=='heading':output+='\\outlinelevel'+str(attrs.get('level',1)-1)
        for stop in attrs.get('tabStops') or []:
            output+= {'left':'','right':'\\tqr','center':'\\tqc','decimal':'\\tqdec'}[stop['align']]
            output+= {'none':'','dot':'\\tldot','dash':'\\tlhyph','line':'\\tlul'}[stop['leader']]
            output+='\\tx'+str(round(stop['position']*20))
        if any(attrs.get(key) for key in ('paragraphBackground','paragraphBorderWidth','paragraphPadding')):
            self.warn('RTF omits paragraph shading and borders; retain Alder or DOCX for that decoration.')
        return output+' '+''.join(self.inline(child) for child in node.get('content',[]))+'\\par\n'

    def block(self,node,level=0):
        kind,attrs=node['type'],node.get('attrs',{})
        if kind=='form_block':
            self.warn('RTF keeps form content as ordinary blocks, without editable fields or restrictions.')
            return ''.join(self.block(child,level) for child in node['content'])
        if kind in ('paragraph','heading','code_block'):return self.paragraph(node)
        if kind in ('bullet_list','ordered_list'):
            from .list_formatting import list_marker
            self.warn('RTF list labels are exported as ordinary paragraph text; automatic list numbering is not retained.')
            output=[]
            for i,item in enumerate(node.get('content',[])):
                children=copy.deepcopy(item.get('content',[]))
                label=item.get('attrs',{}).get('_outlineLabel') or (list_marker(attrs.get('order',1)+i,attrs.get('listStyle') or ('decimal' if kind=='ordered_list' else 'disc'))+('.' if kind=='ordered_list' else ''))
                if children and children[0]['type']=='paragraph':children[0].setdefault('content',[]).insert(0,{'type':'text','text':label+'\t'})
                else:children.insert(0,{'type':'paragraph','content':[{'type':'text','text':label+'\t'}]})
                for child in children:
                    if child['type']=='paragraph':child.setdefault('attrs',{}).update(leftIndent=18*(level+1),firstLineIndent=-18)
                    output.append(self.block(child,level+1))
            return ''.join(output)
        if kind=='table':
            self.warn('RTF tables are exported as tab-separated paragraphs; cell layout and merging are not retained.')
            output=[]
            for row in node.get('content',[]):
                content=[]
                for i,cell in enumerate(row.get('content',[])):
                    if i:content.append({'type':'text','text':'\t'})
                    for j,child in enumerate(cell.get('content',[])):
                        if j:content.append({'type':'hard_break'})
                        if child['type'] in ('paragraph','heading','code_block'):content.extend(child.get('content',[]))
                        elif child['type']=='image':content.append(child)
                        else:
                            raise ValueError('RTF converts ordinary table cells only. Save as Alder, DOCX or ODT to preserve nested table/list objects.')
                output.append(self.paragraph({'type':'paragraph','content':content}))
            return ''.join(output)
        if kind=='image':return self.paragraph({'type':'paragraph','attrs':{'align':attrs.get('align') or 'left'},'content':[node]})
        if kind in ('page_break','section_break','column_break'):
            if kind!='page_break':self.warn('RTF converts section and column breaks to ordinary page breaks using the initial page layout.')
            return '\\page\n'
        if kind=='horizontal_rule':self.warn('RTF omits horizontal rules.');return ''
        if kind not in ('doc','list_item'):self.warn('RTF converts generated content and container decoration to ordinary editable blocks.')
        return ''.join(self.block(child,level) for child in node.get('content',[]))

    def finish(self,path,sections):
        from .page_geometry import page_geometry
        from .running_matter import legacy_running_matter
        running=self.settings.get('runningMatter') or legacy_running_matter(self.settings)
        headers=[]
        for part in ('header','footer'):
            story=running.get(part,{}).get('default')
            if story:headers.append('{\\'+part+' '+''.join(self.block(child) for child in story['content']).removesuffix('\\par\n')+'}')
        if running.get('differentFirst') or running.get('differentEven'):self.warn('RTF uses the default header and footer on every page.')
        body=[]
        if self.settings.get('includeTitle'):body.append(self.block({'type':'heading','attrs':{'level':1},'content':[{'type':'text','text':self.project.get('name','Untitled')}]}))
        for section in sections:
            if section.get('title'):body.append(self.block({'type':'heading','attrs':{'level':1},'content':[{'type':'text','text':section['title']}]}))
            body.extend(self.block(node) for node in section['blocks'])
        for key in ('columns','mirrorMargins','watermark','pageBorder','lineNumbering','hyphenation','noteOptions'):
            if self.settings.get(key):self.warn('RTF uses ordinary page geometry and continuous note numbering; advanced page furniture, columns and custom note settings are not retained.')
        geometry=page_geometry(self.settings)
        output='{\\rtf1\\ansi\\ansicpg1252\\uc1\\deff0\n{\\fonttbl'+''.join('{\\f'+str(i)+'\\fnil\\fcharset0 '+escape(name)+';}' for i,name in enumerate(self.fonts))+'}\n'
        output+='{\\colortbl;'+''.join(''.join('\\'+key+str(int(value[i:i+2],16)) for key,i in [('red',1),('green',3),('blue',5)])+';' for value in self.colours)+'}\n'
        output+='{\\info{\\title '+escape(self.project.get('name','Untitled'))+'}'
        for key in ('author','subject'):
            if self.settings.get(key):output+='{\\'+key+' '+escape(self.settings[key])+'}'
        output+='}\n'+''.join('\\'+control+str(round(value*1440/25.4)) for control,value in [('paperw',geometry['width']),('paperh',geometry['height']),*[('marg'+edge[0],value) for edge,value in geometry['margins'].items()]])+'\n'
        note_type=2 if len(self.note_kinds)>1 else 1 if 'endnote' in self.note_kinds else 0
        output+='\\fet'+str(note_type)+'\\ftnbj\\aenddoc\\ftnnar\\aftnnar\\ftnstart1\\aftnstart1\n'
        output+=''.join(headers)+''.join(body)+'}'
        path.write_text(output,encoding='ascii')


def write_rtf(project,path,settings,sections,warnings):
    Writer(project,settings,warnings).finish(path,sections)
