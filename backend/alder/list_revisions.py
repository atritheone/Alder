"""Review ordinary list markers and restarts using native paragraph numbering."""
from copy import deepcopy
from .document_revisions import W
from .cell_revisions import native_cell_revision,signature


def native_list_revision(node,writer):
    log=node.get('attrs',{}).get('revisionProperties')
    if not log:return None
    native=native_cell_revision(log)
    if not native:return None
    stamp,original=native
    from .tracked_block_moves import identity_nodes
    if original['attrs'].get('listTemplate') or node['attrs'].get('listTemplate'):
        raise ValueError('Review outline-list formatting before Word export; its complete previous numbering needs to be retained.')
    if any(n.get('attrs',{}).get(k) for n in identity_nodes(node) for k in ('revisionMove','revisionBlock')):
        raise ValueError('Review list moves and item boundaries before exporting a list formatting change to Word.')
    return stamp,writer.create(original['type']=='ordered_list',original['attrs'].get('order',1),original['attrs'].get('listStyle'))


def prepare_list_revisions(sections,numbering,final_numbers,outline_lists=None,outline_bindings=None):
    from .list_conversion_revisions import prepare_list_conversions
    conversion=prepare_list_conversions(sections,numbering,final_numbers,outline_lists,outline_bindings)
    if conversion is not None:return conversion
    from .outline_boundary_numbering import prepare_outline_boundaries
    outline_boundaries=prepare_outline_boundaries(sections,numbering,outline_lists,outline_bindings)
    if outline_boundaries is not None:return outline_boundaries
    from .list_boundary_numbering import prepare_boundary_numbering
    boundaries=prepare_boundary_numbering(sections,numbering,final_numbers)
    if boundaries is not None:return boundaries
    from .paragraph_revisions import paragraph_format
    from .tracked_block_moves import identity_nodes
    nodes=[n for section in sections for n in identity_nodes({'content':section['blocks']})]
    if not any(n['type'] in ('ordered_list','bullet_list') and n.get('attrs',{}).get('revisionProperties') for n in nodes):return {}
    for listing in nodes:
        if listing['type'] in ('ordered_list','bullet_list') and listing.get('attrs',{}).get('revisionProperties'):
            if any(n.get('attrs',{}).get('_itemJoin') or (n.get('attrs',{}).get('revisionBreak') or {}).get('scope')=='item' for n in identity_nodes(listing)):
                raise ValueError('Review item boundaries before exporting overlapping list formatting to Word.')
    if any(n['type'] in ('ordered_list','bullet_list','list_item') and any(n.get('attrs',{}).get(k) for k in ('revisionMove','revisionBlock')) for n in nodes):
        raise ValueError('Review list moves and item boundaries before exporting dependent list formatting to Word.')
    result={}
    def scope(parent):
        original,final={},{}
        for node in parent.get('content',[]):
            attrs=node.get('attrs',{});log=attrs.get('revisionProperties')
            if node['type'] in ('ordered_list','bullet_list'):
                prior=paragraph_format(log,True) if log else node
                before=prior.get('attrs',{})
                if before.get('listTemplate') or attrs.get('listTemplate'):
                    scope(node);continue
                native=native_list_revision(node,numbering) if log else None
                oldkey=(before.get('listStyle') or 'decimal') if prior['type']=='ordered_list' else None
                key=(attrs.get('listStyle') or 'decimal') if node['type']=='ordered_list' else None
                oldprev=original.get(oldkey) if oldkey and before.get('continuePrevious') else None
                prev=final.get(key) if key and attrs.get('continuePrevious') else None
                oldstart=(oldprev[1] if oldprev else 1 if before.get('continuePrevious') else before.get('order',1)) if oldkey else 1
                start=(prev[1] if prev else attrs.get('order',1)) if key else 1
                number=final_numbers.get(id(node))
                if number is None:
                    number=numbering.create(node['type']=='ordered_list',start,attrs.get('listStyle'))
                    final_numbers[id(node)]=number
                oldnumber=oldprev[0] if oldprev else native[1] if native else number
                stamp=native[0] if native else (oldprev or (None,None,None))[2] or (prev or (None,None,None))[2]
                dependencies=[p[2] for p in (oldprev,prev) if p and p[2]]
                if native and any(p!=native[0] for p in dependencies):
                    raise ValueError('Review independent changes in a continued numbering sequence before Word export to preserve each decision.')
                if native and oldkey and before.get('continuePrevious') and oldprev is None:
                    oldnumber=numbering.create(True,1,oldkey,continuation=True)
                if native or oldstart!=start:
                    if not stamp:raise ValueError('A continued-list revision is missing its source change.')
                    result[id(node)]=(stamp,oldnumber)
                count=len(node.get('content',[]))
                if oldkey:original[oldkey]=(oldnumber,oldstart+count,stamp)
                if key:final[key]=(number,start+count,stamp)
            scope(node)
    for section in sections:scope({'content':section['blocks']})
    result.update(prepare_outline_revisions(sections,numbering,nodes,outline_lists or {},outline_bindings or {}))
    return result


def prepare_outline_revisions(sections,numbering,nodes,final_records,final_bindings):
    from .paragraph_revisions import paragraph_format
    from .outline_lists import word_outline_bindings
    pending={};result={}
    for root in nodes:
        attrs=root.get('attrs',{});log=attrs.get('revisionProperties')
        if root['type'] not in ('ordered_list','bullet_list') or not log:continue
        native=native_cell_revision(log)
        if not native:continue
        stamp,before=native
        if not (before['attrs'].get('listTemplate') or attrs.get('listTemplate')):continue
        if not before['attrs'].get('listTemplate') or not attrs.get('listTemplate'):
            raise ValueError('Review conversion between ordinary and outline lists before Word export.')
        pending[id(root)]=stamp
    if not pending:return result
    aliases={}
    def original(node):
        copy=deepcopy({k:v for k,v in node.items() if k!='content'})
        if node['type'] in ('ordered_list','bullet_list') and node.get('attrs',{}).get('revisionProperties'):
            previous=paragraph_format(node['attrs']['revisionProperties'],True)
            copy['type']=previous['type'];copy['attrs']={**previous['attrs'],'blockId':node['attrs'].get('blockId')}
        if 'content' in node:copy['content']=[original(c) for c in node['content']]
        aliases[id(copy)]=node
        return copy
    prior=[{'blocks':[original(n) for n in section['blocks']]} for section in sections]
    bindings,records=word_outline_bindings(numbering.document,prior)
    root_stamps={};number_aliases={}
    for record in records.values():
        current=aliases[id(record['node'])];root=aliases[id(record['root'])];level=record['level'];oldspec=bindings[id(record['items'][0]['node'])][2]
        finalrecord=final_records.get(id(current))
        if finalrecord is None:raise ValueError('An outline formatting revision is missing its final numbering.')
        old_number=bindings[id(record['items'][0]['node'])][0]
        final_number=final_bindings[id(finalrecord['items'][0]['node'])][0]
        if level==0:
            predecessors=[aliases.get(id(record['previous'])),finalrecord['previous']]
            dependencies=[root_stamps[id(p)] for p in predecessors if p is not None and root_stamps.get(id(p))]
            own=pending.get(id(root))
            if own and any(p!=own for p in dependencies):
                raise ValueError('Review independent changes in a continued outline sequence before Word export to preserve each decision.')
            stamp=own or next(iter(dependencies),None)
            root_stamps[id(root)]=stamp
            if stamp is None:number_aliases[old_number]=final_number
        stamp=root_stamps.get(id(root))
        if stamp is None:continue
        newspec=final_bindings[id(finalrecord['items'][0]['node'])][2]
        for item in current.get('content',[]):
            if any(child['type'] not in ('paragraph','ordered_list','bullet_list','table') for child in item.get('content',[])[1:]):
                raise ValueError('Review outline formatting with block objects before Word export.')
        result[id(current)]=(stamp,number_aliases.get(old_number,old_number),oldspec,newspec)
    return result


def write_list_revision(paragraph,native,level,numbering,writer):
    if not native:return
    from docx.oxml import OxmlElement
    from docx.text.paragraph import Paragraph
    stamp,number=native[:2]
    props=paragraph._p.get_or_add_pPr()
    if props.find(f'{{{W}}}pPrChange') is not None:
        raise ValueError('Review simultaneous paragraph and list formatting before Word export.')
    prior=deepcopy(props)
    for child in list(prior):
        if child.tag==f'{{{W}}}numPr':prior.remove(child)
    scratch=Paragraph(OxmlElement('w:p'),paragraph._parent);numbering.apply(scratch,number,level)
    prior.append(deepcopy(scratch._p.pPr.numPr))
    if len(native)>2:
        oldspec,newspec=native[2:]
        indent=prior.find(f'{{{W}}}ind')
        if indent is None:raise ValueError('The final outline paragraph is missing its indentation.')
        left=int(indent.get(f'{{{W}}}left','0'))+round((oldspec['indent']-newspec['indent'])*20)
        first=int(indent.get(f'{{{W}}}firstLine','0'))-int(indent.get(f'{{{W}}}hanging','0'))+round((newspec['hanging']-oldspec['hanging'])*20)
        indent.set(f'{{{W}}}left',str(left));indent.attrib.pop(f'{{{W}}}firstLine',None);indent.attrib.pop(f'{{{W}}}hanging',None)
        indent.set(f'{{{W}}}'+('hanging' if first<0 else 'firstLine'),str(abs(first)))
    from .table_revisions import append_change
    append_change(props,'pPr',prior,stamp,writer)


def write_continuation_revision(paragraph,native,level,numbering,writer):
    if not native or len(native)<4 or native[2]['indent']==native[3]['indent']:return
    from docx.oxml import OxmlElement
    from docx.text.paragraph import Paragraph
    from .list_item_boundaries import write_item_paragraph,read_item_paragraph
    boundary=read_item_paragraph(paragraph)
    if boundary is None or boundary[0]!=level:raise ValueError('A reviewed continuation is missing its list boundary.')
    props=paragraph._p.get_or_add_pPr()
    if props.find(f'{{{W}}}pPrChange') is not None:raise ValueError('Review simultaneous paragraph and list formatting before Word export.')
    scratch=Paragraph(OxmlElement('w:p'),paragraph._parent);scratch._p.append(deepcopy(props));scratch.style=paragraph.style.base_style
    authored=(paragraph.paragraph_format.left_indent.pt if paragraph.paragraph_format.left_indent is not None else boundary[1])-boundary[1]
    write_item_paragraph(scratch,level,native[2]['indent'],numbering.document.styles,authored)
    from .table_revisions import append_change
    append_change(props,'pPr',scratch._p.pPr,native[0],writer)


class ListRevisionReader:
    def __init__(self,document,reader):
        from .docx_support import NumberingReader
        self.numbering=NumberingReader(document);self.reader=reader;self.groups={};self.continuations={};self.continuation_groups=[];self.item_joins={};self.continuation_hints=set();self.outline_predecessors={}
        self.move_numbering={}

    def moved_numbering(self,change,move):
        if move and change:self.move_numbering.setdefault((move['stamp']['id'],move['originalId']),{})[move['kind']]=change

    def appearance(self,props,fail):
        """Word expands inherited list indentation into the original pPr."""
        from docx.oxml import OxmlElement
        result=deepcopy(props);number=result.find(f'{{{W}}}numPr')
        if number is None:fail()
        identity=number.find(f'{{{W}}}numId');depth=number.find(f'{{{W}}}ilvl')
        if identity is None:fail()
        level=depth.get(f'{{{W}}}val') if depth is not None else '0'
        instance=next((n for n in self.numbering.root.findall(f'{{{W}}}num') if n.get(f'{{{W}}}numId')==identity.get(f'{{{W}}}val')),None)
        if instance is None:fail()
        abstract_id=instance.find(f'{{{W}}}abstractNumId')
        abstract=next((n for n in self.numbering.root.findall(f'{{{W}}}abstractNum') if abstract_id is not None and n.get(f'{{{W}}}abstractNumId')==abstract_id.get(f'{{{W}}}val')),None)
        spec=next((n for n in abstract.findall(f'{{{W}}}lvl') if n.get(f'{{{W}}}ilvl')==level),None) if abstract is not None else None
        if spec is None:fail()
        from .outline_lists import read_word_template
        template=read_word_template(self.numbering,int(identity.get(f'{{{W}}}val')))
        if any(c.tag.rsplit('}',1)[-1] not in ('start','numFmt','suff','lvlText','lvlJc','pPr','lvlRestart') for c in spec):fail()
        for tag,expected in [('suff','space'),('lvlJc','left'),('lvlRestart',str(template[int(level)]['restart']) if template else level)]:
            value=spec.find(f'{{{W}}}{tag}')
            if value is not None and value.get(f'{{{W}}}val')!=expected:fail()
        paragraph=spec.find(f'{{{W}}}pPr')
        if paragraph is not None and any(c.tag!=f'{{{W}}}ind' for c in paragraph):fail()
        from .list_formatting import NUMBER_FORMATS,BULLETS
        fmt=spec.find(f'{{{W}}}numFmt');label=spec.find(f'{{{W}}}lvlText')
        if fmt is None or label is None:fail()
        if not template and not (fmt.get(f'{{{W}}}val') in NUMBER_FORMATS.values() and label.get(f'{{{W}}}val')==f'%{int(level)+1}.' or fmt.get(f'{{{W}}}val')=='bullet' and label.get(f'{{{W}}}val') in BULLETS.values()):fail()
        inherited=spec.find(f'{{{W}}}pPr/{{{W}}}ind')
        indent=result.find(f'{{{W}}}ind')
        if inherited is not None:
            if indent is None:indent=OxmlElement('w:ind');result.append(indent)
            for key,value in inherited.attrib.items():
                if key not in indent.attrib and not (key in (f'{{{W}}}firstLine',f'{{{W}}}hanging') and any(k in indent.attrib for k in (f'{{{W}}}firstLine',f'{{{W}}}hanging'))):indent.set(key,value)
        from .list_formatting import word_relative_list,relative_list_level
        if (template or word_relative_list(self.numbering,int(identity.get(f'{{{W}}}val')))) and indent is not None:
            from .nested_list_conversion import ordinary_depth
            current=template[int(level)] if template else relative_list_level(int(level)+ordinary_depth(self.numbering,int(identity.get(f'{{{W}}}val'))))
            from .nested_outline import number_inset
            inset=number_inset(self.numbering,int(identity.get(f'{{{W}}}val')))
            left=int(indent.get(f'{{{W}}}left','0'))-round((current['indent']+inset)*20)
            first=int(indent.get(f'{{{W}}}firstLine','0'))-int(indent.get(f'{{{W}}}hanging','0'))+round(current['hanging']*20)
            indent.set(f'{{{W}}}left',str(left));indent.attrib.pop(f'{{{W}}}hanging',None);indent.set(f'{{{W}}}firstLine',str(first))
        run=result.find(f'{{{W}}}rPr')
        if run is not None and not len(run) and not run.attrib:result.remove(run)
        return signature(result,('pPrChange','numPr'))

    def paragraph(self,paragraph):
        from docx.text.paragraph import Paragraph
        from .item_breaks import read_continuation_split,read_item_join
        if read_continuation_split(paragraph,self.numbering,self.reader,self):
            return self.numbering.info(paragraph),None
        joined=read_item_join(paragraph,self.numbering,self.reader)
        if joined:
            self.item_joins[paragraph._p]=joined
            return None
        props=paragraph._p.pPr
        change=props.find(f'{{{W}}}pPrChange') if props is not None else None
        old=change.find(f'{{{W}}}pPr') if change is not None else None
        if old is not None and old.find(f'{{{W}}}numPr') is None:
            from .list_item_boundaries import read_item_paragraph
            boundary=read_item_paragraph(paragraph)
            if boundary:
                prior=deepcopy(paragraph._p);prior.remove(prior.pPr);prior.insert(0,deepcopy(old));prior=Paragraph(prior,paragraph._parent)
                previous=read_item_paragraph(prior)
                def fail():raise ValueError('This Word list continuation revision cannot be retained completely. The original file has not been changed.')
                if previous is None or previous[0]!=boundary[0] or prior.style.base_style.style_id!=paragraph.style.base_style.style_id:fail()
                def appearance(p,inset):
                    from docx.oxml import OxmlElement
                    copy=deepcopy(p);indent=copy.find(f'{{{W}}}ind')
                    if indent is None:indent=OxmlElement('w:ind');copy.append(indent)
                    indent.set(f'{{{W}}}left',str(int(indent.get(f'{{{W}}}left',str(round(inset*20))))-round(inset*20)))
                    first=int(indent.get(f'{{{W}}}firstLine','0'))-int(indent.get(f'{{{W}}}hanging','0'))
                    indent.attrib.pop(f'{{{W}}}hanging',None);indent.set(f'{{{W}}}firstLine',str(first))
                    return signature(copy,('pPrChange','pStyle'))
                if appearance(props,boundary[1])!=appearance(old,previous[1]):fail()
                self.continuations[paragraph._p]=(previous,boundary,self.reader.stamp(change));props.remove(change)
                return None
        if old is None or old.find(f'{{{W}}}numPr') is None:
            info=self.numbering.info(paragraph)
            return (info,None) if info else None
        def fail():raise ValueError('This Word list formatting revision cannot be retained completely. The original file has not been changed.')
        if self.appearance(props,fail)!=self.appearance(old,fail):fail()
        prior=deepcopy(paragraph._p);prior.remove(prior.pPr);prior.insert(0,deepcopy(old))
        info=self.numbering.info(Paragraph(prior,paragraph._parent))
        if info is None:fail()
        stamp=self.reader.stamp(change);props.remove(change)
        return info,stamp

    def item(self,listing,change,level,scope,number):
        if id(listing) not in self.groups and listing.get('attrs',{}).get('listTemplate'):
            self.outline_predecessors.setdefault(scope,[]).append(listing['attrs']['listTemplate'])
        self.groups.setdefault(id(listing),(listing,[],scope,number))[1].append((change,level))

    def continuation(self,listing,paragraph):
        if paragraph in self.continuations:self.continuation_groups.append((id(listing),paragraph))

    def joined_item(self,node,paragraph,number,level):
        joined=self.item_joins.pop(paragraph,None)
        if joined is None:return
        info,stamp=joined
        if info[:2]!=(number,level):raise ValueError('A reviewed item join is detached from its original list.')
        from uuid import uuid4
        identity=node.setdefault('attrs',{}).setdefault('blockId','block_'+uuid4().hex)
        node.setdefault('content',[]).insert(0,{'type':'revision_break','attrs':{'kind':'deletion','scope':'item','stamp':stamp,'nextId':identity,'rightType':'list_item','rightAttrs':{}}})

    def finish(self):
        if self.item_joins:raise ValueError('A reviewed item join has no enclosing list.')
        replacements={}
        for pair in self.move_numbering.values():
            if set(pair)!={'insertion','deletion'}:continue
            before,after=pair['deletion'],pair['insertion']
            if after[1] and before[0][:3]==after[0][:3] and before[0][4]==after[0][4]:replacements[id(after)]=(before[0],after[1])
        for listing,entries,scope,number in self.groups.values():
            entries[:]=[(replacements.get(id(change),change),level) for change,level in entries]
        previous={};dependencies={};outline_groups={}
        for listing,entries,scope,final_number in self.groups.values():
            def fail():raise ValueError('This Word list revision changes only part of a list or its structure. The original file has not been changed.')
            if not entries[0][0]:fail()
            (first,stamp),level=entries[0]
            number,oldlevel,kind,start,marker=first
            from .outline_lists import read_word_template
            template=read_word_template(self.numbering,number)
            from .list_formatting import word_list_continuation
            from .nested_outline import number_continuation
            key=(scope,marker);continued=previous.get(key)==number or word_list_continuation(self.numbering,number) or bool(template and level==0 and number_continuation(self.numbering,number)) or id(listing) in self.continuation_hints;previous[key]=number
            changed=[entry for entry in entries if entry[0] and entry[0][1]]
            if not changed:continue
            if len(changed)!=len(entries):fail()
            if level!=oldlevel:fail()
            for index,((info,current),depth) in enumerate(entries):
                if info!=(number,oldlevel,kind,start+index,marker) or depth!=level or any(current.get(k)!=stamp.get(k) for k in ('author','date')):fail()
            after=deepcopy(listing['attrs']);before={**after,'listStyle':marker}
            if not template:before.pop('listTemplate',None)
            if kind=='ordered_list' or template and level==0:
                before['order']=start;before.pop('continuePrevious',None)
                if continued:before['continuePrevious']=True
            else:
                before.pop('order',None);before.pop('continuePrevious',None)
            if template:
                if level==0:before['listTemplate']=deepcopy(template)
                dependency=outline_groups.get((number,final_number))
                if dependency and all(dependency.get(k)==stamp.get(k) for k in ('author','date')):stamp=dependency
                outline_groups[(number,final_number)]=stamp
            if continued and after.get('continuePrevious') and before.get('listStyle')==after.get('listStyle'):
                dependency=dependencies.get((scope,number)) or dependencies.get((scope,final_number))
                if dependency and all(dependency.get(k)==stamp.get(k) for k in ('author','date')):stamp=dependency
            a,b={'type':kind,'attrs':before},{'type':listing['type'],'attrs':after}
            if a==b:continue
            listing['attrs']['revisionProperties']={'base':a,'records':[{'stamp':stamp,'status':'pending','before':a,'after':b}]}
            dependencies[(scope,number)]=dependencies[(scope,final_number)]=stamp
        if len(self.continuation_groups)!=len(self.continuations):raise ValueError('A reviewed list continuation has no enclosing list.')
        from .list_conversion_revisions import reunite_conversions
        reunite_conversions(self.groups,self.numbering)
        for identity,paragraph in self.continuation_groups:
            old,new,stamp=self.continuations[paragraph];listing,entries,scope,number=self.groups[identity]
            first,level=entries[0];info,owner=first
            from .outline_lists import read_word_template
            a,b=read_word_template(self.numbering,info[0]),read_word_template(self.numbering,number)
            from .nested_outline import number_inset
            if a:a=[{**spec,'indent':spec['indent']+number_inset(self.numbering,info[0])} for spec in a]
            if b:b=[{**spec,'indent':spec['indent']+number_inset(self.numbering,number)} for spec in b]
            from .list_formatting import word_relative_list,relative_list_level
            from .nested_list_conversion import ordinary_depth
            if a is None and word_relative_list(self.numbering,info[0]):a=[relative_list_level(i+ordinary_depth(self.numbering,info[0])) for i in range(9)]
            if b is None and word_relative_list(self.numbering,number):b=[relative_list_level(i+ordinary_depth(self.numbering,number)) for i in range(9)]
            if not owner or not a or not b or old[0]!=level or new[0]!=level or any(owner.get(k)!=stamp.get(k) for k in ('author','date')) or round(old[1]*20)!=round(a[level]['indent']*20) or round(new[1]*20)!=round(b[level]['indent']*20):
                raise ValueError('A Word list continuation has an independent or incomplete formatting change. The original file has not been changed.')
