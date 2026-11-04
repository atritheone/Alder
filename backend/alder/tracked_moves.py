"""Paired inline review moves and native Word move containers.

Block-level, nested and overlapping move ranges are rejected before import;
neither half may quietly become ordinary authored text.
"""
from uuid import uuid4
from copy import deepcopy
import re

W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
KINDS={'revision_deletion':'moveFrom','revision_insertion':'moveTo'}

def move_text(node):
    return ''.join((n.text or '') if n.tag in (f'{{{W}}}t',f'{{{W}}}delText') else '\t' if n.tag==f'{{{W}}}tab' else '\n' if n.tag in (f'{{{W}}}br',f'{{{W}}}cr') else '' for n in node.iter())

def slice_move(node,start,end):
    """Split only supported inline runs, retaining their character properties."""
    offset=0
    def walk(n):
        nonlocal offset
        tag=n.tag.rsplit('}',1)[-1]
        if tag=='rPr':return deepcopy(n)
        if tag in ('t','delText','tab','br','cr'):
            text=(n.text or '') if tag in ('t','delText') else '\t' if tag=='tab' else '\n'
            left=max(0,start-offset);right=min(len(text),end-offset);offset+=len(text)
            if right<=left:return None
            result=deepcopy(n)
            if tag in ('t','delText'):
                result.text=text[left:right];result.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
            return result
        result=deepcopy(n)
        for c in list(result):result.remove(c)
        for c in n:
            child=walk(c)
            if child is not None:result.append(child)
        return result if any(c.tag!=f'{{{W}}}rPr' for c in result) else None
    return walk(node)

def word_move_format(node):
    """Compare run formatting without depending on XML prefix/attribute order."""
    def shape(n):return (n.tag,tuple(sorted(n.attrib.items())),tuple(shape(c) for c in n))
    result=[]
    for run in node.iter(f'{{{W}}}r'):
        text=move_text(run)
        if not text:continue
        properties=run.find(f'{{{W}}}rPr');signature=shape(properties) if properties is not None and len(properties) else None
        if result and result[-1][1]==signature:result[-1]=(result[-1][0]+len(text),signature)
        else:result.append((len(text),signature))
    return result


def validate_moves(document):
    from .tracked_block_moves import validate_block_moves
    validate_block_moves(document)
    groups={};block_ids=set()
    def walk(node,parent=None,index=0):
        for key in ('revisionMove','revisionBlock'):
            if node.get('attrs',{}).get(key):block_ids.add(node['attrs'][key]['stamp']['id'])
        moves=[m for m in node.get('marks',[]) if m.get('type') in KINDS and m.get('attrs',{}).get('move')]
        for mark in moves:
            if len(moves)!=1 or node['type'] not in ('text','hard_break') or any(m is not mark and m['type'].startswith('revision_') for m in node.get('marks',[])):
                raise ValueError('Tracked moves require text without overlapping revisions or objects.')
            a=mark['attrs'];key=a['id'];stamp=(a.get('author',''),a.get('date',''))
            group=groups.setdefault(key,{'stamp':stamp,'sides':{},'text':{},'appearance':{}})
            if group['stamp']!=stamp:raise ValueError('Both sides of a tracked move must retain the same author and date.')
            previous=group['sides'].get(mark['type'])
            if previous and (previous[0] is not parent or previous[1]!=index-1):raise ValueError('A tracked move needs a complete source and destination.')
            group['sides'][mark['type']]=(parent,index)
            group['text'][mark['type']]=group['text'].get(mark['type'],'')+(node.get('text','') if node['type']=='text' else '\n')
            group['appearance'].setdefault(mark['type'],[]).append((node.get('text','') if node['type']=='text' else '\n',sorted([m for m in node.get('marks',[]) if m['type'] not in KINDS],key=lambda m:m['type'])))
        for i,child in enumerate(node.get('content',[])):walk(child,node,i)
    walk(document)
    if block_ids.intersection(groups):raise ValueError('Inline and paragraph moves need separate identities.')
    if any(len(group['sides'])!=2 for group in groups.values()):raise ValueError('A tracked move is missing its source or destination. Preserve both sides, or review it first.')
    for group in groups.values():
        a,b=(value.strip() for value in group['text'].values())
        if not a or a!=b:raise ValueError('A tracked move must retain the same wording at its source and destination.')
        signatures=[]
        for kind,parts in group['appearance'].items():
            text=group['text'][kind];start=len(text)-len(text.lstrip());end=len(text.rstrip());offset=0;signature=[]
            for text,marks in parts:
                size=max(0,min(end,offset+len(text))-max(start,offset));offset+=len(text)
                if not size:continue
                if signature and signature[-1][1]==marks:signature[-1]=(signature[-1][0]+size,marks)
                else:signature.append((size,marks))
            signatures.append(signature)
        if signatures[0]!=signatures[1]:raise ValueError('A tracked move must retain the same character formatting at both ends.')


def write_word_moves(root):
    from docx.oxml import OxmlElement
    groups={}
    for paragraph in root.iter(f'{{{W}}}p'):
        previous=None
        for child in list(paragraph):
            if child.tag not in (f'{{{W}}}moveFrom',f'{{{W}}}moveTo'):
                previous=None;continue
            key=tuple(child.get(f'{{{W}}}{name}','') for name in ('id','author','date'))
            if previous is not None and previous.tag==child.tag and all(previous.get(f'{{{W}}}{name}','')==value for name,value in zip(('id','author','date'),key)):
                previous.extend(list(child));paragraph.remove(child);continue
            side=child.tag.rsplit('}',1)[-1]
            group=groups.setdefault(key,{})
            if side in group:raise ValueError('A Word move must have one contiguous source and destination.')
            group[side]=child;previous=child
    next_id=max((int(n.get(f'{{{W}}}id')) for n in root.iter() if (n.get(f'{{{W}}}id') or '').isdigit()),default=0)+1
    for number,(key,sides) in enumerate(groups.items()):
        if set(sides)!={'moveFrom','moveTo'}:raise ValueError('A Word move is missing its source or destination.')
        if move_text(sides['moveFrom']).strip()!=move_text(sides['moveTo']).strip():raise ValueError('A tracked move has different source and destination wording. Review it before Word export.')
        cores=[]
        for side in (sides['moveFrom'],sides['moveTo']):
            value=move_text(side);cores.append(slice_move(side,len(value)-len(value.lstrip()),len(value.rstrip())))
        if all(c is not None for c in cores) and word_move_format(cores[0])!=word_move_format(cores[1]):
            raise ValueError('This move changes inherited character formatting. Review it before Word export so both review appearances are preserved.')
        for kind,node in sides.items():
            text=move_text(node);left=len(text)-len(text.lstrip());right=len(text.rstrip())
            if right<=left:raise ValueError('A tracked move requires nonblank wording.')
            before=slice_move(node,0,left);after=slice_move(node,right,len(text));body=slice_move(node,left,right)
            node.getparent().replace(node,body);node=body
            start=OxmlElement('w:'+kind+'RangeStart');end=OxmlElement('w:'+kind+'RangeEnd')
            start.set(f'{{{W}}}id',str(next_id));end.set(f'{{{W}}}id',str(next_id));next_id+=1
            node.set(f'{{{W}}}id',str(next_id));next_id+=1
            start.set(f'{{{W}}}name','alderMove'+str(number));start.set(f'{{{W}}}author',key[1])
            if key[2]:start.set(f'{{{W}}}date',key[2])
            node.addprevious(start);node.addnext(end)
            # Word rejects a move by restoring its destination text. Keep edge
            # spacing as adjacent ordinary revisions so both decisions are exact.
            # Hidden native bookmarks retain their association after Word resave.
            for edge,space,anchor in [('L',before,start),('R',after,end)]:
                if space is None:continue
                space.tag=f'{{{W}}}'+('del' if kind=='moveFrom' else 'ins')
                space.set(f'{{{W}}}id',str(next_id));next_id+=1
                if kind=='moveFrom':
                    for t in space.iter(f'{{{W}}}t'):t.tag=f'{{{W}}}delText'
                a=OxmlElement('w:bookmarkStart');b=OxmlElement('w:bookmarkEnd')
                a.set(f'{{{W}}}id',str(next_id));b.set(f'{{{W}}}id',str(next_id));next_id+=1
                a.set(f'{{{W}}}name',f'_AlderMoveAdj_{number}_{"F" if kind=="moveFrom" else "T"}{edge}')
                if edge=='L':
                    for item in (a,space,b):anchor.addprevious(item)
                else:
                    for item in (b,space,a):anchor.addnext(item)


def read_word_moves(root):
    from .document_revisions import validate_revision
    tags={f'{{{W}}}{kind}{suffix}' for kind in ('moveFrom','moveTo') for suffix in ('','RangeStart','RangeEnd')}
    expected={n for n in root.iter() if n.tag in tags}
    if not expected:return {}
    processed=set();groups={};result={}
    def fail():raise ValueError('This Word document contains incomplete, nested or structural moves that Alder cannot yet retain. The original file has not been changed.')
    for paragraph in root.iter(f'{{{W}}}p'):
        active=None
        for node in paragraph:
            tag=node.tag.rsplit('}',1)[-1]
            if node.tag in tags:processed.add(node)
            if tag in ('moveFromRangeStart','moveToRangeStart'):
                if active is not None or not node.get(f'{{{W}}}name') or not node.get(f'{{{W}}}id'):fail()
                active={'kind':tag.removesuffix('RangeStart'),'start':node,'runs':[]}
            elif tag in ('moveFromRangeEnd','moveToRangeEnd'):
                if not active or tag!=active['kind']+'RangeEnd' or node.get(f'{{{W}}}id')!=active['start'].get(f'{{{W}}}id') or not active['runs']:fail()
                name=active['start'].get(f'{{{W}}}name');group=groups.setdefault(name,{})
                if active['kind'] in group:fail()
                group[active['kind']]=active['runs'];active=None
            elif tag in ('moveFrom','moveTo'):
                if not active or tag!=active['kind']:fail()
                if any(c.tag.rsplit('}',1)[-1] in ('ins','del','moveFrom','moveTo','rPrChange','drawing','pict','p','tbl','fldSimple','instrText','delInstrText','footnoteReference','endnoteReference') for c in node.iterdescendants()):fail()
                if any(c.tag not in (f'{{{W}}}r',f'{{{W}}}hyperlink') for c in node):fail()
                active['runs'].append(node)
            elif active is not None and tag not in ('proofErr','bookmarkStart','bookmarkEnd'):fail()
        if active is not None:fail()
    if processed!=expected:fail()
    stamps={}
    for name,sides in groups.items():
        if set(sides)!={'moveFrom','moveTo'}:fail()
        nodes=[n for group in sides.values() for n in group]
        authors={(n.get(f'{{{W}}}author',''),n.get(f'{{{W}}}date','')) for n in nodes}
        if len(authors)!=1:fail()
        author,date=authors.pop();stamp={'id':'change_'+uuid4().hex,'author':author,'date':date,'move':True};validate_revision(stamp)
        stamps[name]=stamp
        for node in nodes:result[node]=stamp.copy()
    for bookmark in root.iter(f'{{{W}}}bookmarkStart'):
        match=re.fullmatch(r'_AlderMoveAdj_(\d+)_([FT])[LR]',bookmark.get(f'{{{W}}}name',''))
        if not match:continue
        stamp=stamps.get('alderMove'+match[1]);node=bookmark.getnext()
        # Word moves zero-width bookmark boundaries across adjacent move range
        # boundaries on save; neither boundary is part of the bookmarked text.
        while node is not None and node.tag in tags-{f'{{{W}}}moveFrom',f'{{{W}}}moveTo'}:node=node.getnext()
        end=node.getnext() if node is not None else None
        while end is not None and end.tag in tags-{f'{{{W}}}moveFrom',f'{{{W}}}moveTo'}:end=end.getnext()
        if stamp is None or node is None:continue
        expected=f'{{{W}}}'+('del' if match[2]=='F' else 'ins')
        if node.tag!=expected:continue # The companion spacing was already reviewed in Word.
        if end is None or end.tag!=f'{{{W}}}bookmarkEnd' or end.get(f'{{{W}}}id')!=bookmark.get(f'{{{W}}}id') or not move_text(node).isspace():fail()
        if node.get(f'{{{W}}}author','')!=stamp['author'] or node.get(f'{{{W}}}date','')!=stamp['date']:fail()
        result[node]=stamp.copy()
    return result
