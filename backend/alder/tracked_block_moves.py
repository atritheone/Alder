"""Whole paragraph moves retain their boundary, appearance and identity."""
from copy import deepcopy
import re
from uuid import uuid4
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
MOVABLE_OBJECTS=('inline_image','equation','shape','form_field','text_box','document_note','document_field','cross_reference','index_entry','citation','sequence','bookmark','bookmark_end','comment_anchor')
LISTS=('ordered_list','bullet_list')
STRUCTURAL_BLOCKS=(*LISTS,'table','table_row','list_item','table_cell','table_header')
LIST_STRUCTURE=(*STRUCTURAL_BLOCKS,'list_item','paragraph','table_row','table_cell','table_header')


def identity_nodes(node):
    for child in node.get('content',[]):
        if child['type'] in (*MOVABLE_OBJECTS,*LIST_STRUCTURE):yield child
        if child['type'] in LIST_STRUCTURE:yield from identity_nodes(child)


def plain_list(node):
    attrs=node.get('attrs',{})
    return node['type'] in (*LIST_STRUCTURE,'text','hard_break',*MOVABLE_OBJECTS) and not any(attrs.get(k) for k in ('revisionMove','revisionBlock','revisionProperties','captionLabel')) and not any(m['type'].startswith('revision_') for m in node.get('marks',[])) and all(plain_list(c) for c in node.get('content',[]))

def object_identity(node):
    return {'blockId':node.get('attrs',{}).get('blockId'), **({'body':deepcopy(node['attrs']['body'])} if node['type']=='document_note' else {})}

def clean_note_identity(node):
    result=deepcopy(node)
    def walk(current):
        if 'attrs' in current:current['attrs']={k:v for k,v in current['attrs'].items() if k!='blockId' and v is not None}
        if current['type']=='document_note':walk(current['attrs']['body'])
        for child in current.get('content',[]):walk(child)
    walk(result)
    return result


def moved_object_aliases(document):
    sources=[];targets={};aliases={}
    def walk(node):
        move=node.get('attrs',{}).get('revisionMove')
        if move and move.get('stamp',{}).get('move'):
            key=(move['stamp']['id'],move.get('part',0))
            if move['kind']=='insertion':targets[key]=node
            else:sources.append((key,node))
        for child in node.get('content',[]):walk(child)
    walk(document)
    for key,node in sources:
        target=targets.get(key,{})
        before=node.get('attrs',{}).get('blockId');after=target.get('attrs',{}).get('blockId')
        if before and after:aliases[before]=after
        for source,live in zip(identity_nodes(node),identity_nodes(target)):
            if source['type']==live['type']:
                before=source.get('attrs',{}).get('blockId');after=live.get('attrs',{}).get('blockId')
                if before and after:aliases[before]=after
    return aliases

def validate_block_move(move,paired=True):
    from .document_revisions import validate_revision
    if not isinstance(move,dict) or move.get('kind') not in ('insertion','deletion') or not isinstance(move.get('stamp'),dict) or bool(move['stamp'].get('move'))!=paired:
        raise ValueError('Invalid tracked paragraph move.')
    validate_revision(move['stamp'])
    count,part=move.get('count',1),move.get('part',0)
    if type(count) is not int or type(part) is not int or not 1<=count<=100000 or not 0<=part<count:raise ValueError('Invalid tracked paragraph move sequence.')
    if move.get('originalId') is not None and (not isinstance(move['originalId'],str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}',move['originalId'])):
        raise ValueError('Invalid tracked paragraph identity.')


def require_complete_bookmarks(nodes):
    starts={};ends={};order=0
    def walk(node):
        nonlocal order
        order+=1;attrs=node.get('attrs',{})
        if node['type']=='bookmark':starts[attrs.get('blockId')]=(attrs.get('range',False),order)
        if node['type']=='bookmark_end':ends.setdefault(attrs['targetId'],[]).append(order)
        for child in node.get('content',[]):walk(child)
    for node in nodes:walk(node)
    if any(ranged and len(ends.get(key,[]))!=1 for key,(ranged,_) in starts.items()) or any(key not in starts or len(end)!=1 or end[0]<=starts[key][1] for key,end in ends.items()):
        raise ValueError('Move the complete bookmarked passage, including both ends.')

def require_complete_comments(nodes):
    from .document_comments import walk
    threads={}
    for node in nodes:
        for anchor in walk(node):
            if anchor['type']=='comment_anchor':threads.setdefault(anchor['attrs']['threadId'],[]).append(anchor['attrs'])
    for anchors in threads.values():
        if [a['edge'] for a in anchors]!=['start','end'] or anchors[0]['thread']!=anchors[1]['thread']:
            raise ValueError('Review the complete commented passage, including both ends.')

def validate_block_moves(document):
    groups={};aliases=moved_object_aliases(document)
    def overlaps(node):
        return any(m['type'].startswith('revision_') for m in node.get('marks',[])) or any(overlaps(child) for child in node.get('content',[]))
    def walk(node,parent=None,index=0):
        attrs=node.get('attrs',{});move=attrs.get('revisionMove') or attrs.get('revisionBlock')
        if node['type'] in LISTS:
            changed=[bool(item.get('attrs',{}).get('revisionBlock') or item.get('attrs',{}).get('revisionMove')) for item in node.get('content',[])]
            if changed and all(changed):raise ValueError('Tracked list items must retain an unchanged item in the list.')
        if node['type']=='table' and attrs.get('revisionBlock'):
            from .docx_support import table_grid
            rows=node.get('content',[]);columns,placed=table_grid(rows)
            if not rows or any(sum(width for start,col,height,width,cell in placed if start<=i<start+height)!=columns for i in range(len(rows))):
                raise ValueError('A tracked table must retain a complete grid.')
        if node['type']=='table' and any(row.get('attrs',{}).get('revisionMove') or row.get('attrs',{}).get('revisionBlock') for row in node.get('content',[])):
            revision=lambda row:row.get('attrs',{}).get('revisionMove') or row.get('attrs',{}).get('revisionBlock')
            rows=node['content'];changed={i for i,row in enumerate(rows) if revision(row)}
            def incomplete_span(index, height):
                band=rows[index:index+height]
                changes=[revision(row) for row in band]
                if not any(changes):return False
                keys={(change['kind'],change['stamp']['id']) for change in changes if change}
                return len(band)!=height or not all(changes) or len(keys)!=1
            if len(changed)==len(rows) or any(incomplete_span(i,int(cell.get('attrs',{}).get('rowspan',1))) for i,row in enumerate(rows) for cell in row.get('content',[])):
                raise ValueError('Tracked row changes must retain a complete grid and an unchanged row.')
            from .docx_support import table_grid
            columns,placed=table_grid(rows)
            if any(sum(width for start,col,height,width,cell in placed if start<=i<start+height)!=columns for i in range(len(rows))):
                raise ValueError('Tracked row changes must retain a complete grid.')
        if move is not None:
            validate_block_move(move,bool(attrs.get('revisionMove')))
            if attrs.get('revisionMove') and attrs.get('revisionBlock'):raise ValueError('Paragraph revisions cannot overlap.')
            allowed=('text','hard_break',*MOVABLE_OBJECTS) if move['stamp'].get('move') else ('text','hard_break','comment_anchor')
            listing=node['type'] in STRUCTURAL_BLOCKS
            if (node['type'] not in ('paragraph','heading') and not listing) or node['attrs'].get('revisionProperties') or (any(not plain_list(c) for c in node.get('content',[])) if listing else any(c['type'] not in allowed or overlaps(c) for c in node.get('content',[]))):
                raise ValueError('Tracked moves cannot contain unsupported contents or overlapping revisions.')
            groups.setdefault(move['stamp']['id'],[]).append((node,parent,index))
        for i,child in enumerate(node.get('content',[])):walk(child,node,i)
    walk(document)
    from .table_column_revisions import CELLS, validate_column_changes
    validate_column_changes(document)
    for entries in groups.values():
        first=entries[0][0]['attrs'].get('revisionMove') or entries[0][0]['attrs']['revisionBlock'];count=first.get('count',1)
        if any(entry[0]['type']=='table_row' for entry in entries) and (any(entry[0]['type']!='table_row' or entry[1] is not entries[0][1] for entry in entries) or entries[0][1]['type']!='table'):
            raise ValueError('A tracked row move must stay within one complete table.')
        if any(entry[0]['type']=='list_item' for entry in entries) and (any(entry[0]['type']!='list_item' or entry[1] is not entries[0][1] for entry in entries) or entries[0][1]['type'] not in LISTS):
            raise ValueError('A tracked item move must stay within one list.')
        if any(bool(e[0]['attrs'].get('revisionMove'))!=bool(first['stamp'].get('move')) for e in entries):raise ValueError('Paragraph moves and changes need separate identities.')
        if not first['stamp'].get('move'):
            rows=all(entry[0]['type']=='table_row' for entry in entries)
            items=all(entry[0]['type']=='list_item' for entry in entries)
            columns=all(entry[0]['type'] in CELLS for entry in entries)
            if (not rows and not items and not columns and count!=1) or len(entries)!=count or any(
                (change:=entry[0]['attrs']['revisionBlock']).get('count',1)!=count or change.get('part',0)!=i or
                change['kind']!=first['kind'] or any(change['stamp'].get(k)!=first['stamp'].get(k) for k in ('author','date')) or
                (not columns and i>0 and (entry[1] is not entries[i-1][1] or entry[2]!=entries[i-1][2]+1))
                for i,entry in enumerate(entries)):
                raise ValueError('A tracked row group must retain its complete consecutive sequence.')
            if columns:
                for entry in entries:
                    require_complete_bookmarks([entry[0]]); require_complete_comments([entry[0]])
            if rows or items or all(entry[0]['type'] in (*LISTS,'table') for entry in entries):
                require_complete_bookmarks([entry[0] for entry in entries])
                require_complete_comments([entry[0] for entry in entries])
            continue
        if any(entry[0]['type'] in CELLS for entry in entries):raise ValueError('Individual table cells cannot carry a tracked move.')
        sides=[[e for e in entries if e[0]['attrs']['revisionMove']['kind']==kind] for kind in ('deletion','insertion')]
        for side in sides:
            require_complete_bookmarks([entry[0] for entry in side])
            require_complete_comments([entry[0] for entry in side])
        if any(len(side)!=count or any(e[0]['attrs']['revisionMove'].get('part',0)!=i or e[0]['attrs']['revisionMove'].get('count',1)!=count or (i>0 and (side[i-1][1] is not e[1] or side[i-1][2]+1!=e[2])) for i,e in enumerate(side)) for side in sides):
            raise ValueError('A tracked paragraph move needs both its source and destination.')
        def clean(n):
            result=clean_note_identity(n);result['attrs'].pop('revisionMove',None)
            def generated(node):
                attrs=node.get('attrs',{});kind=node['type']
                if kind in LISTS and attrs.get('continuePrevious'):attrs['order']=1
                target=attrs.get('captionTargetId')
                if target in aliases:attrs['captionTargetId']=aliases[target]
                if kind in ('document_field','cross_reference'):
                    attrs.pop('unresolved',None);node['content']=[]
                if kind=='citation':attrs.pop('renderedStyle',None);node['content']=[]
                if kind=='sequence':node['content']=[]
                if kind=='bookmark_end':attrs['targetId']=aliases.get(attrs['targetId'],attrs['targetId'])
                for child in node.get('content',[]):generated(child)
            generated(result)
            return result
        for left,right in zip(*sides):
            a,b=[n[0]['attrs']['revisionMove'] for n in (left,right)]
            if any(a['stamp'].get(k)!=b['stamp'].get(k) or a['stamp'].get(k)!=entries[0][0]['attrs']['revisionMove']['stamp'].get(k) for k in ('author','date')) or a.get('originalId')!=b.get('originalId'):
                raise ValueError('Both sides of a paragraph move must retain the same identity and author.')
            if clean(left[0])!=clean(right[0]):raise ValueError('A paragraph move must retain the same contents and formatting at both ends.')

def block_move_context(document):
    objects={};aliases=moved_object_aliases(document)
    def targets(node):
        move=node.get('attrs',{}).get('revisionMove')
        if move and move['kind']=='insertion':objects[(move['stamp']['id'],move.get('part',0))]=[object_identity(c) for c in identity_nodes(node)]
        for child in node.get('content',[]):targets(child)
    targets(document)
    return objects,aliases


def block_move_view(document,view,context=None):
    if view=='markup':return document
    objects,aliases=context if context is not None else block_move_context(document)
    def walk(node):
        move=node.get('attrs',{}).get('revisionMove') or node.get('attrs',{}).get('revisionBlock')
        if move and move['kind']==('deletion' if view=='final' else 'insertion'):return None
        result=deepcopy({k:v for k,v in node.items() if k!='content'})
        if move:
            result['attrs'].pop('revisionMove',None);result['attrs'].pop('revisionBlock',None)
            target=result['attrs'].get('captionTargetId')
            if target in aliases:result['attrs']['captionTargetId']=aliases[target]
            if move.get('originalId'):result['attrs']['blockId']=move['originalId']
            else:result['attrs'].pop('blockId',None)
        if 'content' in node:result['content']=[out for child in node['content'] if (out:=walk(child)) is not None]
        if move and move['stamp'].get('move'):
            ids=iter(objects[(move['stamp']['id'],move.get('part',0))])
            for child in identity_nodes(result):
                if child['type'] in (*MOVABLE_OBJECTS,*LIST_STRUCTURE):
                    identity=next(ids);attrs=child.setdefault('attrs',{});attrs.pop('blockId',None)
                    if identity['blockId']:attrs['blockId']=identity['blockId']
                    if child['type']=='document_note':attrs['body']=deepcopy(identity['body'])
                    if child['type']=='bookmark_end':attrs['targetId']=aliases.get(attrs['targetId'],attrs['targetId'])
        if result['type'] in ('doc','table_cell','table_header') and not result.get('content'):result['content']=[{'type':'paragraph'}]
        return result
    from .list_formatting import resolve_list_orders
    return resolve_list_orders(walk(document))

def require_word_list_move(node, sections):
    """Qualify only numbering whose native review cannot change another list."""
    def continued(n):
        return bool(n.get('attrs',{}).get('continuePrevious')) or any(continued(c) for c in n.get('content',[]))
    # Reordering items inside one list does not change that list's membership
    # in a numbering chain. Native review excludes its deleted source items.
    if node['type'] not in ('ordered_list','bullet_list','list_item') and any(continued(n) for section in sections for n in section['blocks']):
        raise ValueError('Accept or reject tracked list moves before Word export when lists continue earlier numbering.')
    def simple(n):
        if n['type']=='list_item' and (not n.get('content') or n['content'][0]['type']!='paragraph' or any(c['type'] not in (*LISTS,'paragraph') for c in n['content'][1:])):return False
        return all(simple(c) for c in n.get('content',[]))
    if not simple(node):raise ValueError('Accept or reject tracked list moves with unsupported item contents before Word export.')


def validate_word_moved_table(table):
    """Do not let equal lossy conversions masquerade as a lossless table move."""
    allowed={
        'tblPr':{'tblStyle','tblW','jc','tblLayout','tblLook','tblCellMar'},
        'trPr':{'cantSplit','trHeight','tblHeader','jc'},
        'tcPr':{'tcW','gridSpan','vMerge','tcBorders','shd','vAlign','tcMar'},
    }
    def fail():raise ValueError('This tracked Word table contains unsupported layout or cell properties. Review its move before importing; the original file has not been changed.')
    alignments={}
    for nested in table.iter(f'{{{W}}}tbl'):
        value=nested.find(f'{{{W}}}tblPr/{{{W}}}jc')
        alignments[nested]=value.get(f'{{{W}}}val','left') if value is not None else 'left'
    for node in table.iter():
        tag=node.tag.rsplit('}',1)[-1]
        if tag in allowed and any(c.tag.rsplit('}',1)[-1] not in allowed[tag] for c in node):fail()
        value=node.get(f'{{{W}}}val')
        if tag=='jc' and node.getparent().tag==f'{{{W}}}trPr':
            owner=next((parent for parent in node.iterancestors() if parent.tag==f'{{{W}}}tbl'),None)
            if value!=alignments.get(owner,'left'):fail()
        if tag=='tblStyle' and value not in ('TableGrid','TableNormal'):fail()
        if tag=='trHeight' and node.get(f'{{{W}}}hRule')=='exact':fail()
        if tag=='tcBorders':
            if any(c.tag.rsplit('}',1)[-1] not in ('top','bottom','left','right') or c.get(f'{{{W}}}val') not in ('single','nil','none') for c in node):fail()
        if tag=='shd' and (value not in (None,'clear','nil') or not re.fullmatch('[a-fA-F0-9]{6}',node.get(f'{{{W}}}fill',''))):fail()
        if tag=='vAlign' and value not in ('top','center','bottom'):fail()


def mark_word_table_terminator(paragraph, document):
    """Tag an export-generated empty paragraph, never an authored paragraph."""
    from docx.oxml import OxmlElement
    from docx.enum.style import WD_STYLE_TYPE
    name='AlderTableTerminator'
    if name not in document.styles:
        style=document.styles.add_style(name,WD_STYLE_TYPE.PARAGRAPH)
        style.base_style=document.styles['Normal'];style.hidden=True;style.quick_style=False
    paragraph.get_or_add_pPr().get_or_add_pStyle().val=document.styles[name].style_id
    root=paragraph.getroottree().getroot()
    number=str(max((int(n.get(f'{{{W}}}id')) for n in root.iter() if (n.get(f'{{{W}}}id') or '').isdigit()),default=0)+1)
    start=OxmlElement('w:bookmarkStart');end=OxmlElement('w:bookmarkEnd')
    start.set(f'{{{W}}}name','_AlderTableEnd_'+uuid4().hex[:20])
    start.set(f'{{{W}}}id',number);end.set(f'{{{W}}}id',number)
    paragraph.extend([start,end])


def add_word_table_terminator(document):
    """Word requires a final body paragraph after a table. Mark only our empty
    scaffold, so it can be removed after either native review decision."""
    body=document._element.body
    if len(body)<2:return
    if body[-2].tag!=f'{{{W}}}tbl':
        from .list_item_objects import read_table
        if body[-2].tag!=f'{{{W}}}sdt' or read_table(body[-2]) is None:return
    paragraph=document.add_paragraph()._p
    mark_word_table_terminator(paragraph,document)


def word_table_terminator(paragraph, boundary=None):
    starts=paragraph.findall(f'{{{W}}}bookmarkStart');ends=paragraph.findall(f'{{{W}}}bookmarkEnd')
    style=paragraph.find(f'{{{W}}}pPr/{{{W}}}pStyle')
    marked=style is not None and style.get(f'{{{W}}}val')=='AlderTableTerminator'
    if starts or ends:
        if len(starts)!=1 or len(ends)!=1 or not re.fullmatch('_AlderTableEnd_[a-f0-9]{20}',starts[0].get(f'{{{W}}}name','')) or starts[0].get(f'{{{W}}}id')!=ends[0].get(f'{{{W}}}id'):return False
    elif not marked:return False
    # Word/user edits to this paragraph make it authored content again.
    return all(n is boundary or n in starts or n in ends or n.tag==f'{{{W}}}pPr' and not n.attrib and all((c is style and marked) or c.tag==f'{{{W}}}rPr' and not c.attrib and not len(c) for c in n) for n in paragraph)


def restore_word_list_moves(document,independent_roots=frozenset()):
    """Lift complete native paragraph moves onto reconstructed list/table roots.

    A partial list or mixed range must not become an apparently complete move.
    Leaf range positions are checked before rebuilding the paired root positions.
    """
    groups={}
    def fail():raise ValueError('This Word list move is incomplete or contains unsupported structure. The original file has not been changed.')
    def lift_container(node,paragraphs,moves):
        if not all(moves):fail()
        first=moves[0]
        if any(m['stamp']!=first['stamp'] or m['kind']!=first['kind'] or m.get('count',1)!=first.get('count',1) or m.get('part',0)!=first.get('part',0)+i for i,m in enumerate(moves)):fail()
        original=('table_' if node['type']=='table' else 'list_')+first['originalId']
        node.setdefault('attrs',{}).update(revisionMove={**first,'originalId':original},blockId=original if first['kind']=='insertion' else 'block_'+uuid4().hex)
        for paragraph in paragraphs:paragraph['attrs'].pop('revisionMove')
    def lift_independent(node):
        if node['type'] in STRUCTURAL_BLOCKS:
            paragraphs=[c for c in identity_nodes(node) if c['type']=='paragraph']
            moves=[c.get('attrs',{}).get('revisionMove') for c in paragraphs]
            if id(node) in independent_roots and any(moves):
                lift_container(node,paragraphs,moves)
                return
            # A complete outer move owns its nested controls too. Leave that
            # range for the ordinary outer-container reconstruction below.
            if moves and all(moves) and all(m['stamp']==moves[0]['stamp'] and m['kind']==moves[0]['kind'] for m in moves):return
        for child in node.get('content',[]):lift_independent(child)
    def lift_rows(node):
        for child in node.get('content',[]):lift_rows(child)
        if node['type']=='table':
            for row in node.get('content',[]):
                change=row.get('attrs',{}).get('revisionBlock')
                if not change:continue
                paragraphs=[c for c in identity_nodes(row) if c['type']=='paragraph']
                moves=[c.get('attrs',{}).get('revisionMove') for c in paragraphs]
                if not any(moves):continue
                if not all(moves):fail()
                first=moves[0]
                if change['kind']!=first['kind'] or any(change['stamp'].get(k,'')!=first['stamp'].get(k,'') for k in ('author','date')) or any(m['stamp']!=first['stamp'] or m['kind']!=first['kind'] or m.get('count',1)!=first.get('count',1) or m.get('part',0)!=first.get('part',0)+i for i,m in enumerate(moves)):fail()
                original='row_'+first['originalId']
                row['attrs'].update(revisionMove={**first,'originalId':original},blockId=original if first['kind']=='insertion' else 'block_'+uuid4().hex)
                row['attrs'].pop('revisionBlock')
                for paragraph in paragraphs:paragraph['attrs'].pop('revisionMove')
    def lift_items(node):
        for child in node.get('content',[]):lift_items(child)
        if node['type'] in LISTS:
            paragraphs=[c for c in identity_nodes(node) if c['type']=='paragraph']
            moves=[c.get('attrs',{}).get('revisionMove') for c in paragraphs]
            whole=bool(moves) and all(moves) and all(m['stamp']==moves[0]['stamp'] and m['kind']==moves[0]['kind'] for m in moves)
            if node['type'] in LISTS and not whole:
                for item in node.get('content',[]):
                    paragraphs=[c for c in identity_nodes(item) if c['type']=='paragraph']
                    moves=[c.get('attrs',{}).get('revisionMove') for c in paragraphs]
                    if not any(moves):continue
                    # A nested item's independent move belongs to its own list.
                    direct=item.get('content',[{}])[0].get('attrs',{}).get('revisionMove')
                    if not direct:continue
                    if not all(moves):fail()
                    first=moves[0]
                    if any(m['stamp']!=first['stamp'] or m['kind']!=first['kind'] or m.get('count',1)!=first.get('count',1) or m.get('part',0)!=first.get('part',0)+i for i,m in enumerate(moves)):fail()
                    original='item_'+first['originalId']
                    item.setdefault('attrs',{}).update(revisionMove={**first,'originalId':original},blockId=original if first['kind']=='insertion' else 'block_'+uuid4().hex)
                    for paragraph in paragraphs:paragraph['attrs'].pop('revisionMove')
    def walk(node):
        if node['type'] in STRUCTURAL_BLOCKS:
            paragraphs=[c for c in identity_nodes(node) if c['type']=='paragraph']
            moves=[c.get('attrs',{}).get('revisionMove') for c in paragraphs]
            # A cell may contain both ends of a list/paragraph move. Its table
            # is an unchanged ancestor, not an incomplete moved container.
            complete=bool(moves) and all(moves) and all(m['stamp']==moves[0]['stamp'] and m['kind']==moves[0]['kind'] for m in moves)
            if any(moves) and (node['type'] not in ('table','table_row') or complete):
                lift_container(node,paragraphs,moves)
                groups.setdefault(moves[0]['stamp']['id'],[]).append(node)
                return
        move=node.get('attrs',{}).get('revisionMove')
        if move:groups.setdefault(move['stamp']['id'],[]).append(node)
        for child in node.get('content',[]):walk(child)
    lift_independent(document);lift_rows(document);lift_items(document);walk(document)
    for nodes in groups.values():
        if not any(n['type'] in STRUCTURAL_BLOCKS for n in nodes):continue
        sides=[[n for n in nodes if n['attrs']['revisionMove']['kind']==kind] for kind in ('deletion','insertion')]
        if len(sides[0])!=len(sides[1]):fail()
        for left,right in zip(*sides):
            a,b=left['attrs']['revisionMove'],right['attrs']['revisionMove']
            if left['type']!=right['type'] or a['originalId']!=b['originalId'] or a.get('part',0)!=b.get('part',0):fail()
        for side in sides:
            for part,n in enumerate(side):n['attrs']['revisionMove'].update(part=part,count=len(side))


def write_word_block_moves(root,blocks):
    from docx.oxml import OxmlElement
    groups={}
    native_blocks={move.get('_block',paragraph):move for paragraph,move in blocks}
    for block,move in native_blocks.items():
        previous=native_blocks.get(block.getprevious())
        if block.tag==f'{{{W}}}tbl' and previous and previous['kind']==move['kind'] and previous['stamp']['id']!=move['stamp']['id']:
            raise ValueError('Accept or reject the independent move immediately before a moved table before Word export. Word can merge that passage into the table during review; Alder and HTML/EPUB retain both moves.')
    # Merged-cell scaffolds are generated with their anchor, but may belong to
    # a later row. Move ranges and paragraph pairs must follow native order.
    order={paragraph:index for index,paragraph in enumerate(root.iter(f'{{{W}}}p'))}
    for paragraph,move in sorted(blocks,key=lambda entry:order[entry[0]]):groups.setdefault(move['stamp']['id'],[]).append((paragraph,move))
    next_id=max((int(n.get(f'{{{W}}}id')) for n in root.iter() if (n.get(f'{{{W}}}id') or '').isdigit()),default=0)+1
    for number,entries in enumerate(groups.values()):
        sides=[[e for e in entries if e[1]['kind']==kind] for kind in ('deletion','insertion')]
        if not sides[0] or len(sides[0])!=len(sides[1]):raise ValueError('Incomplete tracked paragraph move.')
        for side in sides:
            move=side[0][1];kind='moveFrom' if move['kind']=='deletion' else 'moveTo';stamp=move['stamp']
            start=OxmlElement('w:'+kind+'RangeStart');end=OxmlElement('w:'+kind+'RangeEnd')
            start.set(f'{{{W}}}id',str(next_id));next_id+=1
            start.set(f'{{{W}}}author',stamp['author'])
            if stamp.get('date'):start.set(f'{{{W}}}date',stamp['date'])
            end.set(f'{{{W}}}id',start.get(f'{{{W}}}id'));start.set(f'{{{W}}}name','alderBlockMove'+str(number))
            for paragraph,move in side:
                wrapper=OxmlElement('w:'+kind);boundary=OxmlElement('w:'+kind)
                for node in (wrapper,boundary):
                    node.set(f'{{{W}}}id',str(next_id));next_id+=1
                    node.set(f'{{{W}}}author',stamp['author'])
                    if stamp.get('date'):node.set(f'{{{W}}}date',stamp['date'])
                properties=paragraph.get_or_add_pPr();run=properties.find(f'{{{W}}}rPr')
                if run is None:run=OxmlElement('w:rPr');properties.append(run)
                run.append(boundary)
                for child in list(paragraph):
                    if child is not properties:wrapper.append(child)
                paragraph.append(wrapper)
            side[0][1].get('_block',side[0][0]).addprevious(start)
            side[-1][1].get('_block',side[-1][0]).addnext(end)

def moved_text_box(drawing):
    """Recognise the text story; the importer must still retain one actual box."""
    body=next(drawing.iter(f'{{{W}}}txbxContent'),None)
    if body is None:return False
    if len(body)!=1 or body[0].tag!=f'{{{W}}}p':return False
    if any(c.tag.rsplit('}',1)[-1] not in ('pPr','r','hyperlink','proofErr') for c in body[0]):return False
    unsupported=('sdt','tbl','drawing','pict','object','fldSimple','instrText','fldChar','footnoteReference','endnoteReference','oMath','oMathPara')
    return not any(c.tag.rsplit('}',1)[-1] in unsupported for c in body.iterdescendants())

def join_updated_field_moves(paragraph,kind,boundary,fail):
    """Word places newly calculated results between same-author move wrappers.
    Only those result runs belong to the move; ordinary loose text never does.
    """
    from .document_comments import word_comment_marker
    if not any(not word_comment_marker(run) for run in paragraph.findall(f'{{{W}}}r')) and not paragraph.findall(f'{{{W}}}del'):return
    wrappers=paragraph.findall(f'{{{W}}}{kind}');parts=[];empty_deletions=[];phase=None;instruction=''
    def empty_formatting_run(run):
        properties=('b','bCs','i','iCs','u','strike','dstrike','vertAlign','rFonts','sz','szCs','color','highlight','lang','rtl','noProof','spacing','kern','w','position','shd')
        return run.tag==f'{{{W}}}r' and all(p.tag==f'{{{W}}}rPr' and all(c.tag in (f'{{{W}}}{name}' for name in properties) and not len(c) for c in p) for p in run)
    if not wrappers:fail()
    for child in list(paragraph):
        if child.tag==f'{{{W}}}{kind}':
            if any(child.get(f'{{{W}}}{key}','')!=boundary.get(f'{{{W}}}{key}','') for key in ('author','date')):fail()
            for run in child:
                marker=run.find(f'{{{W}}}fldChar') if run.tag==f'{{{W}}}r' else None
                if marker is not None:
                    action=marker.get(f'{{{W}}}fldCharType')
                    if action=='begin' and phase is None:phase='code';instruction=''
                    elif action=='separate' and phase=='code':phase='result'
                    elif action=='end' and phase=='result':phase=None
                    elif action=='end' and phase=='code':
                        # XE is a hidden marker, so Word writes no result half.
                        from .document_index import read_xe
                        if read_xe(instruction.strip(),[]) is None:fail()
                        phase=None
                    else:fail()
                if phase=='code':instruction+=''.join(run.itertext(f'{{{W}}}instrText'))
                parts.append(run)
        elif child.tag==f'{{{W}}}r':
            empty_code_run=phase=='code' and empty_formatting_run(child)
            if not empty_code_run and (phase!='result' or any(n.tag not in (f'{{{W}}}rPr',f'{{{W}}}t') for n in child)):fail()
            parts.append(child)
        elif child.tag==f'{{{W}}}del':
            # Word retains the source's empty formatting run as a deletion.
            # It is harmless only inside field code, with the same authorship
            # and no text, field markers, objects or nested revision content.
            if kind!='moveFrom' or phase!='code' or any(child.get(f'{{{W}}}{key}','')!=boundary.get(f'{{{W}}}{key}','') for key in ('author','date')):fail()
            if not all(empty_formatting_run(run) for run in child):fail()
            parts.extend(child);empty_deletions.append(child)
        elif word_comment_marker(child):
            if phase is not None:fail()
            parts.append(child)
        elif phase is not None:fail()
    if phase is not None:fail()
    from docx.oxml import OxmlElement
    combined=OxmlElement('w:'+kind)
    for key,value in boundary.attrib.items():combined.set(key,value)
    wrappers[0].addprevious(combined)
    for part in parts:combined.append(part)
    for wrapper in wrappers:paragraph.remove(wrapper)
    for deletion in empty_deletions:paragraph.remove(deletion)


def read_word_block_moves(root):
    """Validate complete paragraph ranges, then unwrap their text.

    Removing only the already-accounted-for native containers leaves the inline
    move reader responsible for every other range in the part.
    """
    from .document_comments import word_comment_marker
    result={};groups={};consumed=[];boundaries=[];active=None
    def fail():raise ValueError('This Word paragraph move is incomplete or contains unsupported structure. The original file has not been changed.')
    def nested_control(node):
        if node is None or node.tag!=f'{{{W}}}sdt':return False
        tag=node.find(f'{{{W}}}sdtPr/{{{W}}}tag')
        return tag is not None and tag.get(f'{{{W}}}val','').startswith('AlderNestedOutline:')
    def outer_block(paragraph):
        node=paragraph
        while node.getparent() is not None:
            parent=node.getparent()
            if parent.tag in (f'{{{W}}}tc',f'{{{W}}}tr',f'{{{W}}}tbl'):
                node=parent
                continue
            if parent.tag==f'{{{W}}}sdtContent':
                control=parent.getparent()
                if nested_control(control):
                    node=control
                    continue
            break
        return node
    def story_paragraphs(node):
        # A box's inner story is validated with its drawing. It is not another
        # body/list/cell paragraph in the enclosing native move range.
        return [p for p in node.iter(f'{{{W}}}p') if not any(parent.tag==f'{{{W}}}txbxContent' for parent in p.iterancestors())]
    paragraphs=story_paragraphs(root);checked_tables=set()
    for index,paragraph in enumerate(paragraphs):
        properties=paragraph.find(f'{{{W}}}pPr');run=properties.find(f'{{{W}}}rPr') if properties is not None else None
        markers=[c for c in run if c.tag in (f'{{{W}}}moveFrom',f'{{{W}}}moveTo')] if run is not None else []
        if not markers:
            if active is not None:fail()
            continue
        if properties.find(f'{{{W}}}sectPr') is not None:fail()
        if len(markers)!=1 or any(c.tag.rsplit('}',1)[-1] in ('ins','del','rPrChange') for c in run):fail()
        kind=markers[0].tag.rsplit('}',1)[-1];start=paragraph.getprevious();end=paragraph.getnext();block=outer_block(paragraph)
        if block is not paragraph:
            if block not in checked_tables:validate_word_moved_table(block);checked_tables.add(block)
            leaves=story_paragraphs(block)
            if paragraph is leaves[0] and block.getprevious() is not None and block.getprevious().tag==f'{{{W}}}{kind}RangeStart':start=block.getprevious()
            if paragraph is leaves[-1] and block.getnext() is not None and block.getnext().tag==f'{{{W}}}{kind}RangeEnd':end=block.getnext()
            if paragraph is leaves[-1] and len(block) and block[-1].tag==f'{{{W}}}{kind}RangeEnd':end=block[-1]
            for row in (ancestor for ancestor in paragraph.iterancestors() if ancestor.tag==f'{{{W}}}tr' or nested_control(ancestor)):
                row_leaves=story_paragraphs(row)
                if paragraph is row_leaves[0] and row.getprevious() is not None and row.getprevious().tag==f'{{{W}}}{kind}RangeStart':start=row.getprevious()
                if paragraph is row_leaves[-1] and row.getnext() is not None and row.getnext().tag==f'{{{W}}}{kind}RangeEnd':end=row.getnext()
        following_blocks=[paragraph.getnext()]
        if block is not paragraph and paragraph is leaves[-1]:following_blocks.append(block.getnext())
        for following in following_blocks:
            if following is None or following.tag!=f'{{{W}}}p':continue
            current_start=active['start'] if active else paragraph.find(f'{{{W}}}{kind}RangeStart')
            if current_start is None:current_start=start
            relocated=next((c for c in following.findall(f'{{{W}}}{kind}RangeEnd') if current_start is not None and c.get(f'{{{W}}}id')==current_start.get(f'{{{W}}}id')),None)
            # Word can move a range end into the next body/cell paragraph,
            # past the next move's start or bookmarks, but never authored text.
            def before_end(c):
                tag=c.tag.rsplit('}',1)[-1]
                return tag in ('pPr','bookmarkStart','bookmarkEnd','proofErr') or tag in ('moveFromRangeStart','moveToRangeStart') and c.get(f'{{{W}}}name') and c.get(f'{{{W}}}id')!=relocated.get(f'{{{W}}}id')
            if relocated is not None and all(before_end(c) for c in list(following)[:list(following).index(relocated)]):end=relocated
        internal=paragraph.find(f'{{{W}}}{kind}RangeStart')
        if internal is not None:
            # Word relocates a paragraph-start range into that paragraph on save.
            if any(c is not properties and c not in boundaries and c.tag.rsplit('}',1)[-1] not in ('bookmarkStart','bookmarkEnd','proofErr') for c in list(paragraph)[:list(paragraph).index(internal)]):fail()
            start=internal
        if active is None:
            if start is None or start.tag!=f'{{{W}}}{kind}RangeStart' or not start.get(f'{{{W}}}name'):fail()
            active={'start':start,'kind':kind,'paragraphs':[],'authors':set()}
        elif kind!=active['kind'] or (block is not outer_block(active['paragraphs'][-1]) and block.getprevious() is not outer_block(active['paragraphs'][-1])) or internal is not None:fail()
        else:start=None
        # Word places a content control outside the paragraph's run wrappers,
        # reopening the same move around its value. Normalise only a complete
        # value with the paragraph boundary's direction and authorship.
        for control in list(paragraph.findall(f'{{{W}}}sdt')):
            body=control.find(f'{{{W}}}sdtContent')
            if body is None:fail()
            parts=body.findall(f'{{{W}}}{kind}')
            if not parts or any(c not in parts and c.tag.rsplit('}',1)[-1] not in ('bookmarkStart','bookmarkEnd','proofErr') for c in body):fail()
            for part in parts:
                if any(part.get(f'{{{W}}}{key}','')!=markers[0].get(f'{{{W}}}{key}','') for key in ('author','date')):fail()
                for child in list(part):part.addprevious(child)
                body.remove(part)
            from docx.oxml import OxmlElement
            wrapper=OxmlElement('w:'+kind)
            for key,value in markers[0].attrib.items():wrapper.set(key,value)
            control.addprevious(wrapper);wrapper.append(control)
        join_updated_field_moves(paragraph,kind,markers[0],fail)
        wrappers=[c for c in paragraph if c.tag==f'{{{W}}}{kind}']
        # Word omits run wrappers for genuinely empty moved paragraphs. Their
        # paragraph-mark revision still belongs to this complete range. Any
        # loose text/run/object remains forbidden, even if it looks empty.
        if any(c is not properties and c is not start and c not in wrappers and c not in boundaries and not word_comment_marker(c) and c.tag.rsplit('}',1)[-1] not in ('bookmarkStart','bookmarkEnd','proofErr') for c in paragraph):fail()
        for wrapper in wrappers:
            # Native Word adds a VML fallback to editable shapes. Select the
            # qualified DrawingML choice before checking the actual move story.
            mc='http://schemas.openxmlformats.org/markup-compatibility/2006'
            for alternate in list(wrapper.iter(f'{{{mc}}}AlternateContent')):
                choices=alternate.findall(f'{{{mc}}}Choice')
                if len(choices)!=1 or len(choices[0])!=1 or choices[0][0].tag!=f'{{{W}}}drawing':fail()
                from .document_shapes import read_word as read_shape, WPS
                if any(choices[0].nsmap.get(prefix)!=WPS for prefix in choices[0].get('Requires','').split()) or (read_shape(choices[0][0]) is None and not moved_text_box(choices[0][0])):fail()
                alternate.addprevious(choices[0][0]);alternate.getparent().remove(alternate)
            # Word can reopen the same move around wording after Office Math,
            # leaving a nested wrapper on resave. It is one complete paragraph
            # move only when direction and authorship remain identical.
            for nested in reversed(list(wrapper.iter(f'{{{W}}}{kind}'))[1:]):
                if nested.getparent().tag!=wrapper.tag or any(nested.get(f'{{{W}}}{key}','')!=wrapper.get(f'{{{W}}}{key}','') for key in ('author','date')):fail()
                for child in list(nested):nested.addprevious(child)
                nested.getparent().remove(nested)
            # Only complete supported fields may be normalised; an unknown or
            # malformed field must not become matching plain text at both ends.
            from .document_references import normalise_docx_fields,reference_instruction
            from .document_fields import read_field
            from .document_index import read_xe
            from .document_captions import sequence_instruction
            field_warnings=[];normalise_docx_fields(wrapper,field_warnings)
            if field_warnings:fail()
            for field in wrapper.iter(f'{{{W}}}fldSimple'):
                instruction=field.get(f'{{{W}}}instr','').strip()
                if read_field(instruction) is None and reference_instruction(instruction) is None and read_xe(instruction,[]) is None and sequence_instruction(instruction) is None and not re.fullmatch(r'STYLEREF\s+"[^"\\]+"(?:\s+\\\*\s+(?:CHARFORMAT|MERGEFORMAT))?\s*',instruction,re.I):fail()
                if any(n.tag.rsplit('}',1)[-1] not in ('r','rPr','t','delText','b','bCs','i','iCs','u','strike','dstrike','vertAlign','rFonts','sz','szCs','color','highlight','lang','rtl','noProof','spacing','kern','w','position','shd') for n in field.iterdescendants()):fail()
            if any(c.tag.rsplit('}',1)[-1] not in ('r','hyperlink','bookmarkStart','bookmarkEnd','commentRangeStart','commentRangeEnd','proofErr','oMath','sdt','fldSimple') for c in wrapper):fail()
            if any(c.tag.rsplit('}',1)[-1] in ('ins','del','moveFrom','moveTo','rPrChange','pict','instrText','fldChar') for c in wrapper.iterdescendants()):fail()
            from .form_fields import validate_moved_word_control
            for control in wrapper.iter(f'{{{W}}}sdt'):validate_moved_word_control(control)
            for drawing in wrapper.iter(f'{{{W}}}drawing'):
                # Only actual embedded DrawingML objects are qualified here.
                # A converted/omitted shape at both ends could otherwise appear
                # to be a matching move after losing its authored contents.
                from .document_shapes import read_word as read_shape
                if read_shape(drawing) is not None or moved_text_box(drawing):continue
                a='http://schemas.openxmlformats.org/drawingml/2006/main'
                pic='http://schemas.openxmlformats.org/drawingml/2006/picture'
                graphics=list(drawing.iter(f'{{{a}}}graphicData'));blips=list(drawing.iter(f'{{{a}}}blip'))
                if len(graphics)!=1 or graphics[0].get('uri')!=pic or len(graphics[0])!=1 or graphics[0][0].tag!=f'{{{pic}}}pic' or len(blips)!=1 or not blips[0].get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed'):fail()
        authors={(n.get(f'{{{W}}}author',''),n.get(f'{{{W}}}date','')) for n in [markers[0],*wrappers]}
        if len(authors)!=1:fail()
        active['authors'].update(authors);active['paragraphs'].append(paragraph)
        consumed.append((paragraph,wrappers,run,markers[0]))
        if end is not None and end.tag==f'{{{W}}}{kind}RangeEnd':
            start=active['start']
            if start.get(f'{{{W}}}id')!=end.get(f'{{{W}}}id') or len(active['authors'])!=1:fail()
            group=groups.setdefault(start.get(f'{{{W}}}name'),{})
            if kind in group:fail()
            group[kind]=active;boundaries.extend([start,end]);active=None
        else:
            following=outer_block(paragraphs[index+1]) if index+1<len(paragraphs) else None
            if following is None or (following is not block and following.getprevious() is not block):fail()
    if active is not None:fail()
    # Validate every native range before removing its containers. Only then can
    # exact untouched export scaffolds be omitted from logical move positions.
    for group in groups.values():
        if set(group)!={'moveFrom','moveTo'}:fail()
        left,right=group['moveFrom'],group['moveTo']
        if len(left['paragraphs'])!=len(right['paragraphs']) or left['authors']!=right['authors']:fail()
    for paragraph,wrappers,run,marker in consumed:
        for wrapper in wrappers:
            for child in list(wrapper):wrapper.addprevious(child)
            paragraph.remove(wrapper)
        run.remove(marker)
    for boundary in boundaries:boundary.getparent().remove(boundary)
    for group in groups.values():
        left,right=group['moveFrom'],group['moveTo']
        for side in (left,right):side['paragraphs']=[p for p in side['paragraphs'] if not word_table_terminator(p)]
        if not left['paragraphs'] or len(left['paragraphs'])!=len(right['paragraphs']):fail()
        author,date=next(iter(left['authors']));stamp={'id':'change_'+uuid4().hex,'author':author,'date':date,'move':True};count=len(left['paragraphs'])
        for part,(a,b) in enumerate(zip(left['paragraphs'],right['paragraphs'])):
            identity='block_'+uuid4().hex
            for paragraph,kind in ((a,'deletion'),(b,'insertion')):result[paragraph]={'kind':kind,'stamp':stamp.copy(),'originalId':identity,**({'part':part,'count':count} if count>1 else {})}
    return result
