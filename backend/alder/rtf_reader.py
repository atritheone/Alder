"""Local editable RTF text subset; unsupported structures convert explicitly."""
import codecs
import copy
import locale
import re
import uuid

from .rtf_syntax import Binary, Control, controls, destination, parse

IGNORED = {'fonttbl','colortbl','stylesheet','info','generator','filetbl','revtbl','rsidtbl','listtable','listoverridetable','latentstyles','xmlnstbl','themedata','colorschememapping','datastore','nonshppict'}
CHARSETS = {0:1252, 1:1252, 77:10000, 128:932, 129:949, 134:936, 136:950, 161:1253, 162:1254, 163:1258, 177:1255, 178:1256, 186:1257, 204:1251, 222:874, 238:1250, 254:437, 255:850}


class Reader:
    def __init__(self, root, warnings, assets):
        self.root, self.warnings, self.assets = root, warnings, assets
        self.fonts={};self.colours=[];self.styles={};self.blocks=[];self.runs=[]
        self.settings={'includeTitle':False,'footer':False};self.title=''
        self.count=0;self.fallback=0;self.bookmarks={};self.in_note=False;self.note_prefix=False
        values=controls(root)
        self.codepage=self.codec(values.get('ansicpg') or (10000 if 'mac' in values else 1252))
        self.default_font=values.get('deff',0)
        self.default_note_kind='endnote' if values.get('fet')==1 else 'footnote'
        for group in root:
            if not isinstance(group,list):continue
            kind=destination(group)
            if kind=='fonttbl':
                entries=[g for g in group if isinstance(g,list)] or [group]
                for entry in entries:
                    props=controls(entry)
                    if 'f' not in props:continue
                    name=self.label([t for t in entry if not isinstance(t,list)]).split(';')[0].strip()
                    encoding=self.codec(props['cpg']) if props.get('cpg') else self.codepage if props.get('fcharset') in (None,0,1) else self.codec(CHARSETS.get(props['fcharset'],1252))
                    self.fonts[props['f']]={'name':name[:100] or 'Cambria','codec':encoding}
            elif kind=='colortbl':
                colour={}
                for token in group:
                    if isinstance(token,Control) and token.name in ('red','green','blue'):colour[token.name]=max(0,min(255,token.value or 0))
                    elif isinstance(token,bytes):
                        for _ in range(token.count(b';')):
                            self.colours.append('#'+''.join(f'{colour.get(k,0):02x}' for k in ('red','green','blue')) if colour else None);colour={}
            elif kind=='stylesheet':
                for entry in group:
                    if isinstance(entry,list):
                        props=controls(entry)
                        if 's' in props:self.styles[props['s']]=entry
            elif kind=='info':
                for entry in group:
                    if not isinstance(entry,list):continue
                    tag=destination(entry)
                    if tag in ('title','author','subject','doccomm'):
                        value=self.label(entry)
                        if tag=='title':self.title=value[:500]
                        else:self.settings[{'author':'author','subject':'subject','doccomm':'description'}[tag]]=value[:10000]
        self.defaults={'font':self.default_font,'fontSize':12,'uc':1,'paragraph':{},'marks':{},'tabAlign':'left','tabLeader':'none'}

    def warn(self, value):
        if value not in self.warnings:self.warnings.append(value)

    @staticmethod
    def codec(value):
        name='mac_roman' if value==10000 else 'cp'+str(value)
        try:codecs.lookup(name)
        except LookupError as error:raise ValueError('RTF uses an unsupported character encoding: '+str(value)) from error
        return name

    def label(self, group):
        """Decode small metadata/field strings without interpreting instructions."""
        parts=[];uc=1;skip=0
        for token in group:
            if isinstance(token,bytes):
                value=token[skip:];skip=max(0,skip-len(token));parts.append(value.decode(self.codepage,errors='replace'))
            elif isinstance(token,Control):
                if token.name=='uc':uc=max(0,min(16,token.value or 0))
                elif token.name=='u':parts.append(chr((token.value or 0)&65535));skip=uc
                elif token.name in ('~','tab'):parts.append(' ')
            elif isinstance(token,list):
                if token and token[0]==Control('*') and destination(token)!='ud':continue
                parts.append(self.label(token))
        return ''.join(parts).encode('utf-16-le',errors='surrogatepass').decode('utf-16-le',errors='replace')

    def marks(self, state):
        marks=[{'type':name} for name in ('strong','em','underline','strike','subscript','superscript') if state['marks'].get(name)]
        font=self.fonts.get(state['font'],{}).get('name')
        attrs={'fontSize':state['fontSize']}
        if font:attrs['fontFamily']=font
        if state.get('color'):attrs['color']=state['color']
        marks.append({'type':'text_style','attrs':attrs})
        if state.get('highlight'):marks.append({'type':'highlight','attrs':{'color':state['highlight']}})
        if state.get('href'):marks.append({'type':'link','attrs':{'href':state['href']}})
        return marks

    def text(self, value, state):
        if not value or state.get('hidden'):return
        if self.note_prefix:
            self.note_prefix=False
            if value[:1] in (' ','\t'):value=value[1:]
            if not value:return
        self.count+=len(value)
        if self.count>10000000:raise ValueError('RTF contains too much editable text.')
        marks=self.marks(state)
        if self.runs and self.runs[-1]['type']=='text' and self.runs[-1].get('marks')==marks:self.runs[-1]['text']+=value
        else:self.runs.append({'type':'text','text':value,'marks':marks})

    def flush(self, state, force=False):
        if not self.runs and not force:return
        if len(self.blocks)>250000:raise ValueError('RTF contains too many paragraphs.')
        attrs=copy.deepcopy(state['paragraph']);kind='paragraph'
        if 'level' in attrs:kind='heading';attrs['level']=max(1,min(6,attrs['level']))
        self.blocks.append({'type':kind,'attrs':attrs,'content':self.runs});self.runs=[]

    def story(self, group, note=False):
        saved=(self.blocks,self.runs,self.fallback,self.in_note,self.note_prefix)
        self.blocks=[];self.runs=[];self.fallback=0
        self.in_note=note;self.note_prefix=False
        state=copy.deepcopy(self.defaults)
        self.group(group,state,outer=True)
        self.flush(state)
        result={'type':'doc','content':self.blocks or [{'type':'paragraph'}]}
        self.blocks,self.runs,self.fallback,self.in_note,self.note_prefix=saved
        return result

    def picture(self, group):
        from .publishing import _asset_from_bytes
        props=controls(group)
        if not any(name in props for name in ('pngblip','jpegblip')):raise ValueError('This RTF picture is not PNG or JPEG. Save the source as DOCX to convert it before opening.')
        binary=b''.join(token.data for token in group if isinstance(token,Binary))
        if not binary:
            encoded=b''.join(token for token in group if isinstance(token,bytes))
            if len(encoded)>42*1024*1024:raise ValueError('RTF picture is too large.')
            try:binary=bytes.fromhex(encoded.decode('ascii'))
            except (ValueError,UnicodeError) as error:raise ValueError('RTF contains a malformed picture.') from error
        asset=_asset_from_bytes(binary,'RTF picture',self.assets,self.warnings)
        if not asset:raise ValueError('RTF picture could not be decoded.')
        attrs={'assetId':asset,'alt':''}
        if props.get('picwgoal'):attrs['width']=max(1,min(10000,props['picwgoal']/15*(props.get('picscalex',100)/100)))
        for child in group:
            if isinstance(child,list) and destination(child)=='picprop':
                for entry in child:
                    if not isinstance(entry,list):continue
                    parts={destination(g):self.label(g) for g in entry if isinstance(g,list)}
                    if parts.get('sn')=='wzDescription':attrs['alt']=parts.get('sv','')[:10000]
        self.runs.append({'type':'inline_image','attrs':attrs})

    def group(self, group, state, outer=False, depth=0):
        if depth>100:raise ValueError('RTF content is too deeply nested.')
        kind=destination(group)
        if not outer:
            if kind in IGNORED:return
            if kind in ('annotation','atnid','atnauthor'):
                raise ValueError('This RTF contains review comments. Save it as DOCX to retain editable comments in Alder.')
            if kind in ('oldcprops','oldpprops','oldsprops','oldtprops'):
                raise ValueError('This RTF contains tracked edits to formatting. Save it as DOCX to retain review history.')
            if kind in ('object','objdata','shp','do'):
                raise ValueError('This RTF contains an embedded object or drawing that Alder cannot preserve. Save it as DOCX first.')
            if kind in ('header','footer','headerl','headerr','headerf','footerl','footerr','footerf'):
                if kind not in ('header','footer'):
                    self.warn('RTF first/even running stories are converted to default running matter.')
                part='header' if kind.startswith('header') else 'footer'
                running=self.settings.setdefault('runningMatter',{'differentFirst':False,'differentEven':False})
                story=self.story(group)
                if kind in ('header','footer','headerr','footerr') or part not in running:running[part]={'default':story}
                return
            if kind=='footnote':
                body=self.story(group,note=True)
                self.runs.append({'type':'document_note','attrs':{'kind':'endnote' if 'ftnalt' in controls(group) else self.default_note_kind,'blockId':uuid.uuid4().hex,'body':body}})
                return
            if kind=='pict':self.picture(group);return
            if kind=='field':
                parts={destination(g):g for g in group if isinstance(g,list)}
                instruction=self.label(parts.get('fldinst',[])).strip()
                if instruction.upper() in ('PAGE','NUMPAGES'):
                    self.runs.append({'type':'document_field','attrs':{'fieldKind':'page' if instruction.upper()=='PAGE' else 'pageCount'},'content':[{'type':'text','text':self.label(parts.get('fldrslt',[])) or '1'}]})
                    return
                local=copy.deepcopy(state)
                match=re.match(r'^HYPERLINK\s+(\\l\s+)?"([^"\r\n]+)"(?:\s+\\[hmn])*\s*$',instruction,re.I)
                if match:
                    from .publishing import _safe_link
                    href=('#' if match[1] else '')+match[2]
                    if href.startswith('#'):href='#'+self.bookmarks.setdefault(href[1:],uuid.uuid4().hex)
                    local['href']=_safe_link(href)
                else:self.warn('RTF fields retain their cached wording without automatic updates; external field instructions are never executed.')
                self.group(parts.get('fldrslt',[]),local,outer=True,depth=depth+1)
                return
            if kind in ('bkmkstart','bkmkend'):
                name=self.label(group).strip();identifier=self.bookmarks.setdefault(name,uuid.uuid4().hex)
                clean=re.sub('[^A-Za-z0-9_]','_',name)[:39] or 'Bookmark'
                if not clean[0].isalpha():clean='B'+clean
                self.runs.append({'type':'bookmark','attrs':{'blockId':identifier,'name':clean}} if kind=='bkmkstart' else {'type':'bookmark_end','attrs':{'targetId':identifier}})
                return
            if kind in ('pntext','listtext'):
                self.warn('RTF list labels are retained as ordinary paragraph text; automatic list numbering is not retained.')
                self.text(self.label(group),state);return
            if kind=='upr':
                children=[item for item in group if isinstance(item,list)]
                unicode=next((item for item in children if destination(item)=='ud'),None)
                if unicode is not None:self.group(unicode,state,outer=True,depth=depth+1)
                elif children:self.group(children[0],state,depth=depth+1)
                return
            if group and isinstance(group[0],Control) and group[0].name=='*' and kind not in ('shppict','fldrslt','ud'):
                return
        buffer=bytearray()
        def emit():
            if not buffer:return
            chunk=bytes(buffer);buffer.clear()
            skipped=min(len(chunk),self.fallback);self.fallback-=skipped;chunk=chunk[skipped:]
            codec=self.fonts.get(state['font'],{}).get('codec',self.codepage)
            self.text(chunk.decode(codec,errors='replace'),state)
        for token in group:
            if isinstance(token,bytes):buffer.extend(token);continue
            emit()
            if isinstance(token,list):
                self.fallback=0
                self.group(token,copy.deepcopy(state),depth=depth+1)
            elif isinstance(token,Binary):raise ValueError('Unexpected binary data outside an RTF picture.')
            elif isinstance(token,Control):self.control(token,state)
        emit()

    def control(self, token, state, style_trail=()):
        name,value=token.name,token.value
        on=value!=0
        if name in ('revised','deleted') and on:
            raise ValueError('This RTF contains tracked edits. Save it as DOCX to retain review history, or resolve changes in the source application first.')
        if name=='chftn':
            if self.in_note:self.note_prefix=True
            return
        if name=='u':self.text(chr((value or 0)&65535),state);self.fallback=state['uc'];return
        if name=='uc':
            if value is None or not 0<=value<=16:raise ValueError('RTF uses an invalid Unicode fallback length.')
            state['uc']=value;return
        symbols={'~':'\u00a0','_':'\u2011','-':'\u00ad','emdash':'\u2014','endash':'\u2013','lquote':'\u2018','rquote':'\u2019','ldblquote':'\u201c','rdblquote':'\u201d','bullet':'\u2022','tab':'\t'}
        if name in symbols:
            if self.fallback:self.fallback-=1
            else:self.text(symbols[name],state)
        elif name=='line':self.runs.append({'type':'hard_break'})
        elif name=='par':
            if state.get('inTable'):self.runs.append({'type':'hard_break'})
            else:self.flush(state,True)
        elif name in ('page','sect','column'):
            self.flush(state);self.blocks.append({'type':'page_break'})
            if name!='page':self.warn('RTF section and column breaks become page breaks using the document-wide layout.')
        elif name=='pard':state['paragraph']={};state['inTable']=False;state['tabAlign']='left';state['tabLeader']='none'
        elif name=='plain':
            for key in ('font','fontSize','marks'):state[key]=copy.deepcopy(self.defaults[key])
            for key in ('color','highlight','hidden'):state.pop(key,None)
        elif name in ('b','i','ul','strike','sub','super'):
            key={'b':'strong','i':'em','ul':'underline','strike':'strike','sub':'subscript','super':'superscript'}[name]
            state['marks'][key]=on
            if name in ('sub','super'):state['marks']['superscript' if name=='sub' else 'subscript']=False
        elif name=='ulnone':state['marks']['underline']=False
        elif name=='nosupersub':state['marks'].update(subscript=False,superscript=False)
        elif name=='f' and value is not None:state['font']=value
        elif name=='fs' and value is not None:state['fontSize']=max(6,min(72,value/2))
        elif name in ('cf','highlight'):
            state['color' if name=='cf' else 'highlight']=self.colours[value] if value is not None and 0<=value<len(self.colours) else None
        elif name=='v':
            state['hidden']=on
            if on:self.warn('RTF hidden text is excluded from the visible imported document; retain the source file to keep hidden content.')
        elif name in ('ql','qc','qr','qj'):state['paragraph']['align']={'ql':'left','qc':'center','qr':'right','qj':'justify'}[name]
        elif name in ('li','ri','fi','sb','sa') and value is not None:
            key={'li':'leftIndent','ri':'rightIndent','fi':'firstLineIndent','sb':'spaceBefore','sa':'spaceAfter'}[name]
            state['paragraph'][key]=max(-144 if name in ('li','ri','fi') else 0,min(144,value/20))
        elif name=='sl' and value is not None:state['leading']=value;state['paragraph'].update(lineSpacingMode='exact' if value<0 else 'atLeast',lineSpacing=max(1,min(144,abs(value)/20)))
        elif name=='slmult' and on:
            state['paragraph'].update(lineSpacingMode='multiple',lineHeight=max(.8,min(4,abs(state.get('leading',240))/240)));state['paragraph'].pop('lineSpacing',None)
        elif name in ('keep','keepn','pagebb','widctlpar','nowidctlpar'):
            state['paragraph'][{'keep':'keepTogether','keepn':'keepWithNext','pagebb':'pageBreakBefore','widctlpar':'widowOrphan','nowidctlpar':'widowOrphan'}[name]]=not on if name=='nowidctlpar' else on
        elif name in ('rtlpar','ltrpar'):state['paragraph']['textDirection']='rtl' if name=='rtlpar' else 'ltr'
        elif name in ('lang','langfe') and value in locale.windows_locale:state['paragraph']['textLanguage']=locale.windows_locale[value].replace('_','-')
        elif name=='outlinelevel' and value is not None and 0<=value<6:state['paragraph']['level']=value+1
        elif name in ('tqr','tqc','tqdec'):state['tabAlign']={'tqr':'right','tqc':'center','tqdec':'decimal'}[name]
        elif name in ('tldot','tlhyph','tlul'):state['tabLeader']={'tldot':'dot','tlhyph':'dash','tlul':'line'}[name]
        elif name=='tx' and value is not None and 0<value<=28800:
            stops=state['paragraph'].setdefault('tabStops',[])
            stops[:]=sorted({stop['position']:stop for stop in [*stops,{'position':value/20,'align':state['tabAlign'],'leader':state['tabLeader']}]}.values(),key=lambda item:item['position'])[:64]
            state['tabAlign']='left';state['tabLeader']='none'
        elif name=='s' and value is not None:
            if value in style_trail or len(style_trail)>50:raise ValueError('RTF styles contain an inheritance cycle or excessive depth.')
            entry=self.styles.get(value,[]);parent=controls(entry).get('sbasedon')
            if parent is not None and parent!=value:self.control(Control('s',parent),state,style_trail+(value,))
            for item in entry:
                if isinstance(item,Control) and item.name not in ('s','sbasedon','snext'):self.control(item,state,style_trail+(value,))
        elif name in ('paperw','paperh','margl','margr','margt','margb') and value is not None:
            key={'paperw':'pageWidthMm','paperh':'pageHeightMm','margl':'marginLeftMm','margr':'marginRightMm','margt':'marginTopMm','margb':'marginBottomMm'}[name]
            self.settings[key]=value*25.4/1440
            self.settings.update(pageSize='Custom',orientation='portrait')
        elif name=='intbl':state['inTable']=on;self.warn('RTF tables are converted to tab-separated paragraphs; cell layout and merging are not retained.')
        elif name=='cell':
            while self.runs and self.runs[-1]['type']=='hard_break':self.runs.pop()
            self.text('\t',state)
        elif name=='row':
            if self.runs and self.runs[-1]['type']=='text':self.runs[-1]['text']=self.runs[-1]['text'].removesuffix('\t')
            if self.runs and self.runs[-1].get('text')=='':self.runs.pop()
            self.flush(state,True);state['inTable']=False
        elif name in ('ls','ilvl','pn'):self.warn('RTF list labels are retained as ordinary paragraph text; automatic list numbering is not retained.')

    def finish(self):
        state=copy.deepcopy(self.defaults)
        self.group(self.root,state,outer=True)
        self.flush(state)
        def repair(node):
            if node['type']=='text':node['text']=node['text'].encode('utf-16-le',errors='surrogatepass').decode('utf-16-le',errors='replace')
            for child in node.get('content',[]):repair(child)
            if node['type']=='document_note':repair(node['attrs']['body'])
        document={'type':'doc','content':self.blocks or [{'type':'paragraph'}]}
        repair(document)
        for part in self.settings.get('runningMatter',{}).values():
            if isinstance(part,dict):
                for story in part.values():repair(story)
        self.warn('RTF import retains supported character and paragraph formatting, raster pictures, notes and default page geometry. Complex lists/tables become ordinary text; advanced styles, fields and layout may differ.')
        return document,self.title,self.settings


def read_rtf(path,warnings,assets):
    return Reader(parse(path.read_bytes()),warnings,assets).finish()
