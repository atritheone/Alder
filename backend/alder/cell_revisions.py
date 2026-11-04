"""Native review of cell appearance without changing its grid membership."""
from copy import deepcopy
import re
from .paragraph_revisions import validate_paragraph_log,paragraph_format
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'

def signature(element,omit=()):
    return None if element is None else (element.tag,tuple(sorted(element.attrib.items())),tuple(sorted(signature(c) for c in element if c.tag.rsplit('}',1)[-1] not in omit)))


def normalize_row_alignment(current,previous,table_current,table_previous,fail):
    """Word mirrors table alignment onto each row; it is not another edit."""
    child=lambda p:p.find(f'{{{W}}}jc') if p is not None else None
    a,b=child(current),child(previous)
    if signature(a)==signature(b):return
    value=lambda n:n.get(f'{{{W}}}val','left') if n is not None else 'left'
    if value(a)!=value(child(table_current)) or value(b)!=value(child(table_previous)):fail()
    if b is not None:previous.remove(b)
    if a is not None:previous.append(deepcopy(a))


def native_cell_revision(log):
    validate_paragraph_log(log)
    pending=[r for r in log['records'] if r['status']=='pending']
    if not pending:return None
    if len({tuple(r['stamp'].get(k,'') for k in ('id','author','date')) for r in pending})>1:
        raise ValueError('Review overlapping cell formatting changes before Word export to retain each author.')
    return pending[0]['stamp'],paragraph_format(log,True)


def validate_word_cell_changes(rows):
    if not any(c.get('attrs',{}).get('revisionProperties') for r in rows for c in r.get('content',[])):return
    from .docx_support import table_grid
    columns,placed=table_grid(rows)
    boundaries={edge for start,col,height,width,c in placed for edge in (col,col+width)}
    if any(col not in boundaries for col in range(1,columns)):
        raise ValueError('Word consolidates unused internal table columns. Review cell formatting before exporting this grid, or retain the review in Alder/HTML/EPUB.')
    for index,row in enumerate(rows):
        after=[c.get('attrs',{}) for start,col,height,width,c in placed if start<=index<start+height]
        before=[paragraph_format(a['revisionProperties'],True)['attrs'] if a.get('revisionProperties') else a for a in after]
        for attrs in after:
            if attrs.get('revisionProperties'):
                native_cell_revision(attrs['revisionProperties'])
        for side in (before,after):
            if any(len({a.get(k) if a.get(k) is not None else 5.25 for a in side})>1 for k in ('paddingTop','paddingBottom')):
                raise ValueError('Review unequal vertical cell padding before Word export; Word uses the largest padding in each row.')


def write_cell_revision(cell,log,writer,header=False,previous_width=None):
    from docx.oxml import OxmlElement
    from docx.table import _Cell
    from .table_formatting import write_docx_cell
    native=native_cell_revision(log)
    if not native:return
    stamp,previous=native
    prior=deepcopy(cell._tc);props=prior.get_or_add_tcPr()
    for child in list(props):
        if child.tag.rsplit('}',1)[-1] in ('vAlign','tcMar','tcBorders','shd','tcPrChange'):props.remove(child)
    write_docx_cell(_Cell(prior,cell._parent),previous['attrs'],header)
    if previous_width is not None:
        width=props.find(f'{{{W}}}tcW')
        if width is None:width=OxmlElement('w:tcW');props.insert(0,width)
        width.set(f'{{{W}}}type','dxa');width.set(f'{{{W}}}w',str(previous_width))
    change=OxmlElement('w:tcPrChange');key=tuple(stamp.get(k,'') for k in ('id','author','date'))
    change.set(f'{{{W}}}id',writer.ids.setdefault(key,str(len(writer.ids))))
    change.set(f'{{{W}}}author',stamp['author'])
    if stamp.get('date'):change.set(f'{{{W}}}date',stamp['date'])
    change.append(deepcopy(props));cell._tc.get_or_add_tcPr().append(change)


def write_cell_table_snapshot(table,rows,writer,original_widths=None):
    """Word needs the unchanged surrounding grid to interpret old cell margins.

    Without it, opening a cell-only revision can invent an incomplete old grid.
    The no-op container snapshots are checked and removed on import.
    """
    from docx.oxml import OxmlElement
    logs=[c['attrs']['revisionProperties'] for r in rows for c in r['content'] if c.get('attrs',{}).get('revisionProperties')]
    pending=[native_cell_revision(log) for log in logs];pending=[p for p in pending if p]
    if not pending:return
    stamp=pending[0][0]
    for props,tag in [(table._tbl.tblPr,'tblPr'),(table._tbl.tblGrid,'tblGrid'),*[(r._tr.get_or_add_trPr(),'trPr') for r in table.rows]]:
        old=deepcopy(props);change=OxmlElement('w:'+tag+'Change')
        if tag=='tblGrid' and original_widths:
            for column,width in zip(old,original_widths):column.set(f'{{{W}}}w',str(width))
        key=('cell-container',str(len(writer.ids)));change.set(f'{{{W}}}id',writer.ids.setdefault(key,str(len(writer.ids))))
        if tag!='tblGrid':
            change.set(f'{{{W}}}author',stamp['author'])
            if stamp.get('date'):change.set(f'{{{W}}}date',stamp['date'])
        change.append(old);props.append(change)


def normalize_cell_table_snapshots(root):
    """Recover logical columns from native grids, including margin offsets."""
    column_changes={}
    def fail():raise ValueError('This Word cell revision changes the table grid or surrounding properties. The original file has not been changed.')
    def previous(props,tag):
        change=props.find(f'{{{W}}}{tag}Change') if props is not None else None
        if change is None:return props,None
        if len(change)!=1 or change[0].tag!=f'{{{W}}}{tag}':fail()
        return change[0],change
    def integer(element,key,default=0):
        if element is None:return default
        value=element.get(f'{{{W}}}{key}',str(default))
        if not value.isdigit():fail()
        return int(value)
    def widths(grid):
        if grid is None or any(c.tag not in (f'{{{W}}}gridCol',f'{{{W}}}tblGridChange') for c in grid):fail()
        return [integer(c,'w') for c in grid if c.tag==f'{{{W}}}gridCol']
    for table in root.iter(f'{{{W}}}tbl'):
        rows=table.findall(f'{{{W}}}tr')
        cells=[c for row in rows for c in row.findall(f'{{{W}}}tc')]
        if not any(c.find(f'{{{W}}}tcPr/{{{W}}}tcPrChange') is not None for c in cells):continue
        props=table.find(f'{{{W}}}tblPr');oldprops,propchange=previous(props,'tblPr')
        if signature(props,('tblPrChange','jc'))!=signature(oldprops,('jc',)):fail()
        grid=table.find(f'{{{W}}}tblGrid');oldgrid,gridchange=previous(grid,'tblGrid')
        newwidths,oldwidths=widths(grid),widths(oldgrid)
        remove=[gridchange] if gridchange is not None else []
        if propchange is not None and signature(props,('tblPrChange',))==signature(oldprops):remove.append(propchange)
        replacements=[];cell_grids=[];boundaries={0:0};resized=False
        for row in rows:
            rowprops=row.find(f'{{{W}}}trPr');oldrow,rowchange=previous(rowprops,'trPr')
            normalize_row_alignment(rowprops,oldrow,props,oldprops,fail)
            if signature(rowprops,('trPrChange','gridBefore','gridAfter','trHeight','cantSplit'))!=signature(oldrow,('gridBefore','gridAfter','trHeight','cantSplit')):fail()
            if rowchange is not None and signature(rowprops,('trPrChange','gridBefore','gridAfter'))==signature(oldrow,('gridBefore','gridAfter')):remove.append(rowchange)
            index=integer(rowprops.find(f'{{{W}}}gridBefore') if rowprops is not None else None,'val')
            oldindex=integer(oldrow.find(f'{{{W}}}gridBefore') if oldrow is not None else None,'val')
            if index>len(newwidths) or oldindex>len(oldwidths):fail()
            offset=sum(oldwidths[:oldindex])-sum(newwidths[:index])
            origin=sum(oldwidths[:oldindex]);row_start=index
            rowcells=row.findall(f'{{{W}}}tc')
            for position,cell in enumerate(rowcells):
                cp=cell.find(f'{{{W}}}tcPr');oldcp,change=previous(cp,'tcPr')
                span=integer(cp.find(f'{{{W}}}gridSpan') if cp is not None else None,'val',1)
                oldspan=integer(oldcp.find(f'{{{W}}}gridSpan') if oldcp is not None else None,'val',1)
                if span<1 or oldspan<1 or index+span>len(newwidths) or oldindex+oldspan>len(oldwidths):fail()
                width,oldwidth=sum(newwidths[index:index+span]),sum(oldwidths[oldindex:oldindex+oldspan])
                resized |= width!=oldwidth
                if width!=oldwidth:
                    if gridchange is None or change is None:fail()
                    for source,expected in ((cp,width),(oldcp,oldwidth)):
                        value=source.find(f'{{{W}}}tcW')
                        if value is None or value.get(f'{{{W}}}type')!='dxa' or integer(value,'w')!=expected:fail()
                if position==0 and offset:
                    margin=lambda p:integer(p.find(f'{{{W}}}tcMar/{{{W}}}left') if p is not None else None,'w')
                    if offset!=margin(cp)-margin(oldcp):fail()
                if span!=oldspan:
                    if change is None:fail()
                    replacements.append((oldcp,cp.find(f'{{{W}}}gridSpan')))
                if row_start==0:
                    for edge,value in ((index,sum(oldwidths[:oldindex])-origin),(index+span,sum(oldwidths[:oldindex+oldspan])-origin)):
                        if edge in boundaries and boundaries[edge]!=value:fail()
                        boundaries[edge]=value
                cell_grids.append((cell,index,span,change,row_start))
                index+=span;oldindex+=oldspan
            if rowchange is not None and rowchange not in remove:
                for key in ('gridBefore','gridAfter'):
                    old=oldrow.find(f'{{{W}}}{key}');current=rowprops.find(f'{{{W}}}{key}')
                    if old is not None:oldrow.remove(old)
                    if current is not None:oldrow.append(deepcopy(current))
        if resized:
            if any(start for _,_,_,_,start in cell_grids) or set(boundaries)!=set(range(len(newwidths)+1)):fail()
            logical_old=[boundaries[c+1]-boundaries[c] for c in range(len(newwidths))]
            if any(w<=0 or w>150000 for w in logical_old+newwidths):fail()
            affected=[(cell,col,span,change) for cell,col,span,change,_ in cell_grids if logical_old[col:col+span]!=newwidths[col:col+span]]
            authors={tuple(change.get(f'{{{W}}}'+k,'') for k in ('author','date')) for _,_,_,change in affected if change is not None}
            if len(authors)!=1:fail()
            owner=next((change for _,_,_,change in affected if change is not None),None)
            if owner is None:fail()
            for cell,col,span,change,_ in cell_grids:
                cp=cell.find(f'{{{W}}}tcPr');oldcp=change[0] if change is not None else cp
                for source,expected in ((cp,sum(newwidths[col:col+span])),(oldcp,sum(logical_old[col:col+span]))):
                    value=source.find(f'{{{W}}}tcW')
                    if value is None or value.get(f'{{{W}}}type')!='dxa' or integer(value,'w')!=expected:fail()
                column_changes[cell]={'before':[round(w/15,6) for w in logical_old[col:col+span]],'after':[round(w/15,6) for w in newwidths[col:col+span]],'owner':owner}
        for oldcp,current in replacements:
            old=oldcp.find(f'{{{W}}}gridSpan')
            if old is not None:oldcp.remove(old)
            if current is not None:oldcp.append(deepcopy(current))
        for change in remove:change.getparent().remove(change)
    return column_changes


def read_word_cell_changes(root,reader):
    from docx.table import _Cell
    from .table_formatting import read_docx_cell
    changes={}
    def fail():raise ValueError('This Word cell formatting revision changes unsupported properties or grid structure. The original file has not been changed.')
    columns=normalize_cell_table_snapshots(root)
    for cell in root.iter(f'{{{W}}}tc'):
        props=cell.find(f'{{{W}}}tcPr')
        change=props.find(f'{{{W}}}tcPrChange') if props is not None else None
        column=columns.get(cell)
        if change is None and column is None:continue
        if change is None:
            if column['before']==column['after']:continue
            a=read_docx_cell(_Cell(cell,None));b=deepcopy(a)
            a['colwidth']=column['before'];b['colwidth']=column['after']
            changes[cell]={'before':a,'after':b,'stamp':reader.stamp(column['owner'])}
            continue
        if len(change)!=1 or change[0].tag!=f'{{{W}}}tcPr':fail()
        before=change[0]
        for source in (before,props):
            if len({c.tag for c in source})!=len(source):fail()
            if any(c.tag.rsplit('}',1)[-1] not in ('tcW','gridSpan','vMerge','tcMar','tcBorders','shd','vAlign','tcPrChange') for c in source):fail()
            if source is before and source.find(f'{{{W}}}tcPrChange') is not None:fail()
            for tag in ('tcW','gridSpan'):
                if tag=='tcW' and column is not None:continue
                if signature(before.find(f'{{{W}}}{tag}'))!=signature(props.find(f'{{{W}}}{tag}')):fail()
            merges=[p.find(f'{{{W}}}vMerge') for p in (before,props)]
            values=[None if m is None else m.get(f'{{{W}}}val','continue') for m in merges]
            if values[0]!=values[1] or any(v not in (None,'restart','continue') for v in values):fail()
            if any(m is not None and (len(m) or set(m.attrib)-{f'{{{W}}}val'}) for m in merges):fail()
            for child in source:
                tag=child.tag.rsplit('}',1)[-1]
                if tag=='tcMar':
                    if len({c.tag for c in child})!=len(child):fail()
                    for c in child:
                        if set(c.attrib)-{f'{{{W}}}w',f'{{{W}}}type'}:fail()
                        if c.tag.rsplit('}',1)[-1] not in ('top','bottom','left','right') or c.get(f'{{{W}}}type','dxa')!='dxa' or not (c.get(f'{{{W}}}w','').isdigit() and 0<=int(c.get(f'{{{W}}}w'))<=2880):fail()
                if tag=='tcBorders':
                    if {c.tag.rsplit('}',1)[-1] for c in child}!={'top','bottom','left','right'} or len(child)!=4:fail()
                    if len({tuple(sorted(c.attrib.items())) for c in child})!=1:fail()
                    for c in child:
                        if c.get(f'{{{W}}}val') not in ('single','nil','none') or set(c.attrib)-{f'{{{W}}}val',f'{{{W}}}sz',f'{{{W}}}color',f'{{{W}}}space'} or c.get(f'{{{W}}}space','0')!='0':fail()
                        if c.get(f'{{{W}}}sz') and (not c.get(f'{{{W}}}sz').isdigit() or int(c.get(f'{{{W}}}sz'))>96):fail()
                        if c.get(f'{{{W}}}val')=='single' and not re.fullmatch('[0-9a-fA-F]{6}',c.get(f'{{{W}}}color','')):fail()
                if tag=='shd':
                    if child.get(f'{{{W}}}val') not in (None,'clear','nil') or child.get(f'{{{W}}}color') not in (None,'auto') or set(child.attrib)-{f'{{{W}}}val',f'{{{W}}}color',f'{{{W}}}fill'}:fail()
                    fill=child.get(f'{{{W}}}fill')
                    if fill not in (None,'auto') and not re.fullmatch('[0-9a-fA-F]{6}',fill):fail()
                if tag=='vAlign' and child.get(f'{{{W}}}val') not in ('top','center','bottom'):fail()
        previous=deepcopy(cell);previous.replace(previous.find(f'{{{W}}}tcPr'),deepcopy(before))
        a,b=read_docx_cell(_Cell(previous,None)),read_docx_cell(_Cell(cell,None))
        if column is not None:a['colwidth']=column['before'];b['colwidth']=column['after']
        if a==b:
            if column is not None:props.remove(change);continue
            fail()
        changes[cell]={'before':a,'after':b,'stamp':reader.stamp(column['owner'] if column is not None and column['before']!=column['after'] else change)}
        props.remove(change)
    return changes


def attach_cell_revision(node,change):
    attrs=node['attrs'];kind=node['type']
    after={k:deepcopy(v) for k,v in attrs.items() if k not in ('blockId','revisionProperties')}
    before={k:deepcopy(v) for k,v in after.items() if k not in change['after']}
    before.update(change['before'])
    a,b={'type':kind,'attrs':before},{'type':kind,'attrs':after}
    attrs['revisionProperties']={'base':a,'records':[{'stamp':change['stamp'],'status':'pending','before':a,'after':b}]}
