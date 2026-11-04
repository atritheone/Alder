"""Independent table alignment and row appearance in native Word review."""
from copy import deepcopy
from .cell_revisions import W,signature,native_cell_revision,normalize_row_alignment
from .paragraph_revisions import paragraph_format


def append_change(props,tag,prior,stamp,writer):
    from docx.oxml import OxmlElement
    old=props.find(f'{{{W}}}{tag}Change')
    if old is not None:props.remove(old)
    for child in list(prior):
        if child.tag==f'{{{W}}}{tag}Change':prior.remove(child)
    change=OxmlElement('w:'+tag+'Change');key=tuple(stamp.get(k,'') for k in ('id','author','date'))
    change.set(f'{{{W}}}id',writer.ids.setdefault(key,str(len(writer.ids))));change.set(f'{{{W}}}author',stamp['author'])
    if stamp.get('date'):change.set(f'{{{W}}}date',stamp['date'])
    change.append(prior);props.append(change)


def write_table_revisions(table,node,writer):
    from docx.oxml import OxmlElement
    from .table_formatting import row_vertical_inset
    from .docx_support import table_grid
    log=node.get('attrs',{}).get('revisionProperties')
    if log and (native:=native_cell_revision(log)):
        stamp,original=native;props=table._tbl.tblPr;prior=deepcopy(props)
        for child in list(prior):
            if child.tag==f'{{{W}}}jc':prior.remove(child)
        align=OxmlElement('w:jc');align.set(f'{{{W}}}val',original['attrs'].get('align') or 'left');prior.append(align)
        append_change(props,'tblPr',prior,stamp,writer)
    rows=node.get('content',[]);_,placed=table_grid(rows)
    for index,row in enumerate(rows):
        cells=[cell.get('attrs',{}) for start,column,height,width,cell in placed if start<=index<start+height]
        oldcells=[paragraph_format(c['revisionProperties'],True)['attrs'] if c.get('revisionProperties') else c for c in cells]
        attrs=row.get('attrs',{});native=native_cell_revision(attrs['revisionProperties']) if attrs.get('revisionProperties') else None
        if native:stamp,original=native;original=original['attrs']
        else:
            if attrs.get('minHeight') is None or row_vertical_inset(oldcells)==row_vertical_inset(cells):continue
            pending=[native_cell_revision(c['revisionProperties']) for c in cells if c.get('revisionProperties')]
            if not any(pending):continue
            stamp=next(p[0] for p in pending if p);original=attrs
        props=table.rows[index]._tr.get_or_add_trPr();prior=deepcopy(props)
        if any(a.get('minHeight') is not None and a['minHeight']<row_vertical_inset(c) for a,c in ((attrs,cells),(original,oldcells))):
            raise ValueError('Review row heights smaller than their cell padding and borders before Word export.')
        if attrs.get('revisionProperties') and not attrs.get('allowSplit') and props.find(f'{{{W}}}cantSplit') is None:
            raise ValueError('Review formatting on rows taller than a page before Word export.')
        for child in list(prior):
            if child.tag in (f'{{{W}}}trHeight',f'{{{W}}}cantSplit'):prior.remove(child)
        if not original.get('allowSplit'):prior.append(OxmlElement('w:cantSplit'))
        if original.get('minHeight') is not None:
            height=OxmlElement('w:trHeight');height.set(f'{{{W}}}val',str(round(max(0,original['minHeight']-row_vertical_inset(oldcells))*20)));height.set(f'{{{W}}}hRule','atLeast');prior.append(height)
        append_change(props,'trPr',prior,stamp,writer)


def read_word_table_revisions(root,reader):
    found={}
    def fail():raise ValueError('This Word table or row formatting revision contains unsupported properties. The original file has not been changed.')
    def values(props,tag):
        if tag=='tblPr':
            align=props.find(f'{{{W}}}jc');value=align.get(f'{{{W}}}val','left') if align is not None else 'left'
            if value not in ('left','center','right'):fail()
            return {'align':value}
        height=props.find(f'{{{W}}}trHeight');split=props.find(f'{{{W}}}cantSplit')
        result={'allowSplit':split is None or split.get(f'{{{W}}}val','1') in ('0','false','off')}
        if height is not None:
            if height.get(f'{{{W}}}hRule','atLeast')!='atLeast' or not height.get(f'{{{W}}}val','').isdigit() or set(height.attrib)-{f'{{{W}}}val',f'{{{W}}}hRule'}:fail()
            result['height']=int(height.get(f'{{{W}}}val'))/20
        return result
    table_properties={}
    for table in root.iter(f'{{{W}}}tbl'):
        current=table.find(f'{{{W}}}tblPr');previous=current.find(f'{{{W}}}tblPrChange/{{{W}}}tblPr') if current is not None else None
        table_properties[table]=(deepcopy(current),deepcopy(previous if previous is not None else current))
    for tag,owner,keys in [('tblPr','tbl',('jc',)),('trPr','tr',('trHeight','cantSplit'))]:
        for props in root.iter(f'{{{W}}}{tag}'):
            change=props.find(f'{{{W}}}{tag}Change')
            if change is None:continue
            if props.getparent().tag!=f'{{{W}}}{owner}' or len(change)!=1 or change[0].tag!=f'{{{W}}}{tag}':fail()
            old=change[0]
            if tag=='trPr':normalize_row_alignment(props,old,*table_properties.get(props.getparent().getparent(),(None,None)),fail)
            if any(len({c.tag for c in p})!=len(p) for p in (props,old)):fail()
            if signature(props,(tag+'Change',*keys))!=signature(old,keys):fail()
            a,b=values(old,tag),values(props,tag)
            if a!=b:found[props.getparent()]={'before':a,'after':b,'stamp':reader.stamp(change)}
            props.remove(change)
    return found


def attach_table_revision(node,change,old_inset=0):
    attrs=node.setdefault('attrs',{});after={k:deepcopy(v) for k,v in attrs.items() if k not in ('blockId','revisionProperties')}
    before=deepcopy(after)
    if node['type']=='table':before.update(change['before'])
    else:
        before.pop('minHeight',None);before['allowSplit']=change['before']['allowSplit']
        if 'height' in change['before']:before['minHeight']=change['before']['height']+old_inset
    if before==after:return
    a,b={'type':node['type'],'attrs':before},{'type':node['type'],'attrs':after}
    attrs['revisionProperties']={'base':a,'records':[{'stamp':change['stamp'],'status':'pending','before':a,'after':b}]}
