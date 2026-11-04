"""Retain both nine-level counter chains around complete outline-list changes."""
from copy import deepcopy
from .document_comments import walk
from .outline_lists import word_outline_bindings
from .list_boundary_numbering import boundary,derived_numbering


def prepare_outline_boundaries(sections, numbering, outlines, bindings):
    nodes = [n for s in sections for b in s['blocks'] for n in walk(b)]
    changed = [n for n in nodes if n['type'] in ('ordered_list', 'bullet_list') and boundary(n)]
    if not any(n.get('attrs', {}).get('listTemplate') for n in changed):
        return None
    if not any(n.get('attrs', {}).get('continuePrevious') for n in nodes):
        return None
    move_ids={boundary(n)['stamp']['id'] for n in changed if n.get('attrs',{}).get('revisionMove')}
    known_stamps={tuple(boundary(n)['stamp'].get(k,'') for k in ('id','author','date')) for n in changed}
    if any(not n.get('attrs', {}).get('listTemplate') for n in changed) or any(not derived_numbering(n,known_stamps) or n.get('attrs',{}).get('revisionBreak') for n in nodes) or any(n.get('attrs',{}).get('revisionMove') and (n['type'] not in ('ordered_list','bullet_list','paragraph','heading') or n['attrs']['revisionMove']['stamp']['id'] not in move_ids) for n in nodes):
        raise ValueError('Review overlapping list changes before exporting dependent outline boundaries to Word.')
    if any(n['type'] == 'list_item' and n.get('attrs', {}).get('revisionBlock') for n in nodes):
        raise ValueError('Review overlapping item boundaries before exporting dependent outline changes to Word.')

    def projection(kind):
        aliases = {}
        def copy(node):
            attrs = node.get('attrs', {})
            if (boundary(node) or {}).get('kind') == kind:
                return None
            result = deepcopy({k: v for k, v in node.items() if k != 'content'})
            if attrs.get('revisionProperties'):
                from .paragraph_revisions import paragraph_format
                previous=paragraph_format(attrs['revisionProperties'],kind=='insertion')
                result['attrs']={**previous['attrs'],'blockId':attrs.get('blockId')}
            result.get('attrs', {}).pop('revisionBlock', None)
            result.get('attrs', {}).pop('revisionMove', None)
            if 'content' in node:
                result['content'] = [c for child in node['content'] if (c := copy(child)) is not None]
            aliases[id(result)] = node
            return result
        parts = [{'blocks': [c for b in s['blocks'] if (c := copy(b)) is not None]} for s in sections]
        bound, records = word_outline_bindings(numbering.document, parts)
        return {id(aliases[id(r['node'])]): {
            **r, 'node': aliases[id(r['node'])], 'root': aliases[id(r['root'])],
            'previous': aliases[id(r['previous'])] if r['previous'] is not None else None,
            'number': bound[id(r['items'][0]['node'])][0],
        } for r in records.values()}

    old, final = projection('insertion'), projection('deletion')
    stamps, number_aliases, result = {}, {}, {}
    moved={};pairs={}
    for node in changed:
        move=node.get('attrs',{}).get('revisionMove')
        if move:moved.setdefault(move['originalId'],{})[move['kind']]=node
    for pair in moved.values():
        if set(pair)!={'insertion','deletion'}:raise ValueError('A moved outline is missing one complete boundary.')
        source,target=pair['deletion'],pair['insertion']
        a,b=old[id(source)],final[id(target)]
        left=[n for n in walk(source) if id(n) in old];right=[n for n in walk(target) if id(n) in final]
        if len(left)!=len(right):raise ValueError('A moved outline changed its nested structure.')
        for x,y in zip(left,right):pairs[id(y)]=old[id(x)]
    for node in nodes:
        identity = id(node)
        if identity not in old and identity not in final:
            continue
        a, b = old.get(identity), final.get(identity)
        record = b or a
        if record['level']:
            continue
        change = boundary(node)
        dependencies = [stamps[id(r['previous'])] for r in (a, b) if r and r['previous'] is not None and stamps.get(id(r['previous']))]
        stamp = change['stamp'] if change else next(iter(dependencies), None)
        if any(s != stamp for s in dependencies):
            raise ValueError('Review independent whole-list changes in one outline chain before Word export.')
        stamps[identity] = stamp
        if a and b and stamp is None:
            number_aliases[a['number']] = b['number']
    for node in nodes:
        identity = id(node)
        a, b = old.get(identity), final.get(identity)
        if a is None and b is None:
            continue
        record = b or a
        chosen = record['number'] if b else number_aliases.get(record['number'], record['number'])
        current = outlines[identity]
        for item in current['items']:
            bindings[id(item['node'])] = (chosen, current['level'], {**current['template'][current['level']],'indent':current['template'][current['level']]['indent']+current.get('baseIndent',0)})
        stamp = stamps.get(id(record['root']))
        prior=a or pairs.get(identity)
        if prior and b and stamp:
            a=prior
            oldspec={**a['template'][a['level']],'indent':a['template'][a['level']]['indent']+a.get('baseIndent',0)}
            newspec={**b['template'][b['level']],'indent':b['template'][b['level']]['indent']+b.get('baseIndent',0)}
            previous_number=number_aliases.get(a['number'],a['number'])
            if identity not in pairs or previous_number!=chosen:result[identity] = (stamp, previous_number, oldspec, newspec)
    return result
