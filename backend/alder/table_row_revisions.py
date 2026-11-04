"""Native complete table-row insertion/deletion, separate from cell revisions."""
from uuid import uuid4
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def write_word_row_change(row, change, identifier):
    from docx.oxml import OxmlElement
    marker=OxmlElement('w:ins' if change['kind']=='insertion' else 'w:del')
    marker.set(f'{{{W}}}id',str(identifier));marker.set(f'{{{W}}}author',change['stamp']['author'])
    if change['stamp'].get('date'):marker.set(f'{{{W}}}date',change['stamp']['date'])
    row.get_or_add_trPr().append(marker)


def write_word_table_insertion(table, change):
    """Match Word's complete insertion, including nested rows and paragraphs.

    Merely marking outer rows makes Word hang while resaving some nested grids.
    These inner markers are owned by the whole-table insertion, not independent
    edits; import normalises exactly the matching author/date before validation.
    """
    root=table.getroottree().getroot()
    next_id=max((int(n.get(f'{{{W}}}id')) for n in root.iter() if (n.get(f'{{{W}}}id') or '').isdigit()),default=0)+1
    for row in table.iter(f'{{{W}}}tr'):
        properties=row.get_or_add_trPr()
        for marker in list(properties.findall(f'{{{W}}}ins')):properties.remove(marker)
        write_word_row_change(row,change,next_id);next_id+=1
    from .block_revisions import write_word_block_changes
    write_word_block_changes(root,[(paragraph,change) for paragraph in table.iter(f'{{{W}}}p')])


def normalise_word_table_insertions(root):
    for table in root.iter(f'{{{W}}}tbl'):
        rows=list(table.findall(f'{{{W}}}tr'))
        markers=[row.find(f'{{{W}}}trPr/{{{W}}}ins') for row in rows]
        if not rows or any(marker is None for marker in markers):continue
        signature=lambda node:(node.get(f'{{{W}}}author',''),node.get(f'{{{W}}}date',''))
        owner=signature(markers[0])
        if any(signature(marker)!=owner for marker in markers):continue
        def owned(marker):
            if signature(marker)!=owner:
                raise ValueError('Review independent edits inside this inserted table in Word before importing.')
            return True
        for row in table.iter(f'{{{W}}}tr'):
            if row in rows:continue
            properties=row.find(f'{{{W}}}trPr')
            if properties is not None:
                for marker in list(properties.findall(f'{{{W}}}ins')):
                    if not len(marker) and owned(marker):properties.remove(marker)
        for paragraph in table.iter(f'{{{W}}}p'):
            properties=paragraph.find(f'{{{W}}}pPr/{{{W}}}rPr')
            if properties is not None:
                for marker in list(properties.findall(f'{{{W}}}ins')):
                    if not len(marker) and owned(marker):properties.remove(marker)
            for wrapper in reversed(list(paragraph.iter(f'{{{W}}}ins'))):
                parent=wrapper.getparent()
                if parent is not None and parent.tag in (f'{{{W}}}p',f'{{{W}}}hyperlink',f'{{{W}}}sdtContent',f'{{{W}}}ins') and owned(wrapper):
                    for child in list(wrapper):wrapper.addprevious(child)
                    parent.remove(wrapper)


def read_word_row_changes(root):
    normalise_word_table_insertions(root)
    changes={};tables=set();keys={}
    for row in root.iter(f'{{{W}}}tr'):
        properties=row.find(f'{{{W}}}trPr')
        markers=[n for n in properties if n.tag in (f'{{{W}}}ins',f'{{{W}}}del')] if properties is not None else []
        if not markers:continue
        if len(markers)!=1 or len(markers[0]):
            raise ValueError('Review overlapping row changes in Word before importing.')
        marker=markers[0];identity='block_'+uuid4().hex
        changes[row]={'kind':'insertion' if marker.tag==f'{{{W}}}ins' else 'deletion','stamp':{'id':'change_'+uuid4().hex,'author':marker.get(f'{{{W}}}author',''),'date':marker.get(f'{{{W}}}date','')},'originalId':identity}
        keys[row]=(marker.tag,marker.get(f'{{{W}}}id'),marker.get(f'{{{W}}}author'),marker.get(f'{{{W}}}date'))
        properties.remove(marker)
        tables.add(next(parent for parent in row.iterancestors() if parent.tag==f'{{{W}}}tbl'))
    from .tracked_block_moves import validate_word_moved_table
    for table in tables:
        validate_word_moved_table(table)
        rows=list(table.findall(f'{{{W}}}tr'))
        joined={index for index in range(1,len(rows)) if rows[index] in changes and rows[index-1] in changes and keys[rows[index]]==keys[rows[index-1]]}
        def connect(start,end):
            band=rows[start:end+1]
            if not any(row in changes for row in band):return
            first=next(keys[row] for row in band if row in changes)
            if any(row not in changes or (keys[row][0],*keys[row][2:])!=(first[0],*first[2:]) for row in band):
                raise ValueError('Review connected merged or anchored rows together in Word before importing.')
            joined.update(range(start+1,end+1))
        if rows and all(row in changes for row in rows):connect(0,len(rows)-1)
        active={}
        for index,row in enumerate(rows):
            column=0
            for cell in row.findall(f'{{{W}}}tc'):
                span=cell.find(f'{{{W}}}tcPr/{{{W}}}gridSpan');width=int(span.get(f'{{{W}}}val','1')) if span is not None else 1
                merge=cell.find(f'{{{W}}}tcPr/{{{W}}}vMerge')
                value=merge.get(f'{{{W}}}val','continue') if merge is not None else None
                if value=='restart':
                    for col in range(column,column+width):active[col]=(index,column,width)
                elif value=='continue':
                    anchor=active.get(column)
                    if anchor is None or anchor[1:]!=(column,width) or any(active.get(col)!=anchor for col in range(column,column+width)):
                        raise ValueError('A tracked Word table contains an incomplete vertical merge.')
                    connect(anchor[0],index)
                elif value is None:
                    for col in range(column,column+width):active.pop(col,None)
                else:raise ValueError('A tracked Word table contains an unsupported vertical merge.')
                column+=width
        # Word may assign each resaved row a new revision id. A comment or
        # bookmark spanning those rows still needs one atomic review decision.
        starts={};ends={}
        for index,row in enumerate(rows):
            for marker in row.iter():
                tag=marker.tag.rsplit('}',1)[-1]
                if tag not in ('commentRangeStart','commentRangeEnd','bookmarkStart','bookmarkEnd'):continue
                if next((p for p in marker.iterancestors() if p.tag==f'{{{W}}}tr'),None) is not row:continue
                family='comment' if tag.startswith('comment') else 'bookmark'
                key=(family,marker.get(f'{{{W}}}id'))
                target=starts if tag.endswith('Start') else ends
                if key in target:raise ValueError('A tracked Word row has duplicate range anchors.')
                target[key]=index
        for key,start in starts.items():
            end=ends.get(key,start)
            if end<=start or rows[start] not in changes or rows[end] not in changes:continue
            connect(start,end)
        group=[]
        def finish():
            if len(group)>1:
                for part,row in enumerate(group):
                    changes[row].update(stamp=changes[group[0]]['stamp'],count=len(group),part=part)
        for index,row in enumerate(rows):
            if row not in changes or (group and index not in joined):finish();group=[]
            if row in changes:group.append(row)
        finish()
    return changes
