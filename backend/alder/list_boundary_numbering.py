"""Keep both numbering chains around complete ordinary-list revisions."""
from .document_comments import walk

def boundary(node):
    attrs=node.get('attrs',{})
    return attrs.get('revisionBlock') or attrs.get('revisionMove')

def derived_numbering(node,stamps):
    log=node.get('attrs',{}).get('revisionProperties')
    if not log:return True
    if node['type'] not in ('ordered_list','bullet_list') or boundary(node):return False
    for record in log['records']:
        a,b=record['before'],record['after']
        if a['type']!=b['type'] or tuple(record['stamp'].get(k,'') for k in ('id','author','date')) not in stamps:return False
        if any(a['attrs'].get(k)!=b['attrs'].get(k) for k in a['attrs'].keys()|b['attrs'].keys() if k not in ('order','continuePrevious')):return False
    return True


def prepare_boundary_numbering(sections, numbering, final_numbers):
    nodes=[n for section in sections for block in section['blocks'] for n in walk(block)]
    changed=[n for n in nodes if n['type'] in ('ordered_list','bullet_list') and boundary(n)]
    if not changed or not any(n.get('attrs',{}).get('continuePrevious') for n in nodes):return None
    if any(n.get('attrs',{}).get('listTemplate') for n in nodes):
        raise ValueError('Review whole-list changes before Word export when outline numbering continues between lists.')
    move_ids={boundary(n)['stamp']['id'] for n in changed if n.get('attrs',{}).get('revisionMove')}
    stamps={tuple(boundary(n)['stamp'].get(k,'') for k in ('id','author','date')) for n in changed}
    if any(not derived_numbering(n,stamps) or n.get('attrs',{}).get('revisionMove') and (n['type'] not in ('ordered_list','bullet_list','paragraph','heading') or n['attrs']['revisionMove']['stamp']['id'] not in move_ids) or n['type']=='list_item' and n.get('attrs',{}).get('revisionBlock') for n in nodes):
        raise ValueError('Review overlapping list changes before exporting dependent whole-list numbering to Word.')
    result={};moved_numbers={}
    def scope(parent):
        original,final={},{}
        for node in parent.get('content',[]):
            attrs=node.get('attrs',{});change=boundary(node)
            if node['type']=='ordered_list':
                marker=attrs.get('listStyle') or 'decimal';continuing=attrs.get('continuePrevious',False)
                oldprev=original.get(marker) if continuing else None
                newprev=final.get(marker) if continuing else None
                oldstart=oldprev[1] if oldprev else 1 if continuing else attrs.get('order',1)
                newstart=newprev[1] if newprev else 1 if continuing else attrs.get('order',1)
                oldnumber=oldprev[0] if oldprev else None
                number=newprev[0] if newprev else final_numbers.get(id(node))
                if number is None:number=numbering.create(True,newstart,marker,continuing)
                if oldnumber is None:
                    oldnumber=number if oldstart==newstart and not (change and change['kind']=='deletion') else numbering.create(True,oldstart,marker,continuing)
                dependencies=[p[2] for p in (oldprev,newprev) if p and p[2]]
                stamp=change['stamp'] if change else next(iter(dependencies),None)
                if any(p!=stamp for p in dependencies):
                    raise ValueError('Review independent whole-list changes in one numbering chain before Word export to retain each decision.')
                final_numbers[id(node)]=oldnumber if change and change['kind']=='deletion' else number
                if change and change['stamp'].get('move'):
                    moved_numbers.setdefault(change['originalId'],{})[change['kind']]=(node,final_numbers[id(node)],stamp)
                if not change and (oldstart!=newstart or oldnumber!=number) and stamp:
                    result[id(node)]=(stamp,oldnumber)
                count=len(node.get('content',[]))
                if not change or change['kind']!='insertion':original[marker]=(oldnumber,oldstart+count,stamp)
                if not change or change['kind']!='deletion':final[marker]=(number,newstart+count,stamp)
            # The contents of an inserted/deleted list already belong to that
            # complete revision; no descendant property changes may overlap it.
            if not (change and node['type'] in ('ordered_list','bullet_list')):scope(node)
    for section in sections:scope({'content':section['blocks']})
    for pair in moved_numbers.values():
        if set(pair)!={'insertion','deletion'}:raise ValueError('A continued list move is missing one complete numbering boundary.')
        source,old_number,_=pair['deletion'];target,number,stamp=pair['insertion']
        if old_number!=number:result[id(target)]=(stamp,old_number)
    return result


def reunite_boundary_numbering(groups):
    boundaries=[]
    for listing,entries,scope,number in groups.values():
        change=boundary(listing)
        if change:boundaries.append((scope,number,change['stamp']))
    original,final,stamps={},{},{}
    for listing,entries,scope,number in groups.values():
        attrs=listing.get('attrs',{});change=boundary(listing)
        info=entries[0][0][0]
        old,_,kind,_,marker=info
        oldkey=(scope,marker);key=(scope,attrs.get('listStyle') or 'decimal')
        oldcontinues=original.get(oldkey)==old
        continues=final.get(key)==number
        if not change or change['kind']!='insertion':original[oldkey]=old
        if not change or change['kind']!='deletion':final[key]=number
        log=listing.get('attrs',{}).get('revisionProperties')
        if not log:continue
        candidates=[stamp for owner,native,stamp in boundaries if owner==scope and native in (old,number)]
        for record in log['records']:
            matching=list({stamp['id']:stamp for stamp in candidates if all(stamp.get(k)==record['stamp'].get(k) for k in ('author','date'))}.values())
            if len(matching)==1:
                stamps[record['stamp']['id']]=matching[0]
                record['stamp']=matching[0]
                # A displayed insertion/deletion is not a predecessor in both
                # projections. Restore continuation across that ghost boundary.
                if (kind=='ordered_list' or log['base']['attrs'].get('listTemplate')) and oldcontinues:
                    log['base']['attrs']['continuePrevious']=True
                    record['before']['attrs']['continuePrevious']=True
                if (listing['type']=='ordered_list' or attrs.get('listTemplate')) and continues:
                    attrs['continuePrevious']=True
                    record['after']['attrs']['continuePrevious']=True
    for listing,entries,scope,number in groups.values():
        for record in listing.get('attrs',{}).get('revisionProperties',{}).get('records',[]):
            record['stamp']=stamps.get(record['stamp']['id'],record['stamp'])


def reunite_moved_numbering(groups):
    """A moved continuation's old numPr belongs to the move, not a new edit."""
    sources={}
    for listing,entries,scope,number in groups.values():
        move=listing.get('attrs',{}).get('revisionMove')
        if move and move['kind']=='deletion':sources[(move['stamp']['id'],move['originalId'])]=(listing,number)
    pairs=[];numbers=set()
    for listing,entries,scope,number in groups.values():
        move=listing.get('attrs',{}).get('revisionMove')
        if not move or move['kind']!='insertion':continue
        source=sources.get((move['stamp']['id'],move['originalId']))
        if source is None:continue
        if listing.get('attrs',{}).get('listTemplate'):
            numbers.update((source[1],number))
        left=[n for n in walk(source[0]) if id(n) in groups];right=[n for n in walk(listing) if id(n) in groups]
        if len(left)!=len(right):raise ValueError('A moved list changed its nested numbering structure.')
        pairs.extend((x,y,source[0],move,y is listing) for x,y in zip(left,right))
    # Word stores the root start in each native definition. Alder already
    # retains it in order; a moved continuation must share one template with
    # both predecessor chains rather than becoming a new outline style.
    while True:
        previous=len(numbers)
        for listing,entries,scope,number in groups.values():
            old=entries[0][0][0][0]
            if old in numbers or number in numbers:numbers.update((old,number))
        if len(numbers)==previous:break
    for listing,entries,scope,number in groups.values():
        if number not in numbers:continue
        attrs=listing.get('attrs',{})
        appearances=[attrs]
        log=attrs.get('revisionProperties')
        if log:appearances.extend([log['base']['attrs'],*[r[side]['attrs'] for r in log['records'] for side in ('before','after')]])
        for appearance in appearances:
            if appearance.get('listTemplate'):appearance['listTemplate'][0]['start']=1
    for original,listing,source,move,root in pairs:
        entries=groups[id(listing)][1]
        attrs=listing.get('attrs',{});log=attrs.get('revisionProperties')
        if not log:continue
        def fail():raise ValueError('Review independent formatting inside a moved list before importing; the original file has not been changed.')
        if root and bool(attrs.get('continuePrevious'))!=bool(source.get('attrs',{}).get('continuePrevious')):fail()
        if not entries or any(not entry or entry[0][0]!=groups[id(original)][3] for entry,_ in entries):fail()
        for record in log['records']:
            if any(record['stamp'].get(k)!=move['stamp'].get(k) for k in ('author','date')):fail()
            before,after=record['before'],record['after']
            if before['type']!=after['type'] or before['type']!=listing['type']:fail()
            if root and not source.get('attrs',{}).get('continuePrevious') and after['attrs'].get('order',1)!=source.get('attrs',{}).get('order',1):fail()
            if any(before['attrs'].get(k)!=after['attrs'].get(k) for k in before['attrs'].keys()|after['attrs'].keys() if k not in ('order','continuePrevious')):fail()
        attrs.pop('revisionProperties')
        if root:
            if source.get('attrs',{}).get('continuePrevious'):attrs['continuePrevious']=True
            else:attrs.pop('continuePrevious',None)
