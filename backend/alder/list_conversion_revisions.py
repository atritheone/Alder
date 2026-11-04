"""Native ordinary/outline conversion with independent original/final geometry."""
from copy import deepcopy
from .document_comments import walk
from .paragraph_revisions import paragraph_format
from .cell_revisions import native_cell_revision
from .outline_lists import word_outline_bindings
from .list_formatting import relative_list_level

LISTS = ('ordered_list', 'bullet_list')


def prepare_list_conversions(sections, numbering, final_numbers, final_outlines, final_bindings):
    nodes = [n for s in sections for b in s['blocks'] for n in walk(b)]
    conversions = {}
    for node in nodes:
        log = node.get('attrs', {}).get('revisionProperties')
        if node['type'] not in LISTS or not log:
            continue
        prior = paragraph_format(log, True)
        if bool(prior['attrs'].get('listTemplate')) != bool(node['attrs'].get('listTemplate')):
            conversions[id(node)] = native_cell_revision(log)[0]
    if not conversions:
        return None
    if any(n.get('attrs', {}).get(k) for n in nodes for k in ('revisionMove', 'revisionBlock', 'revisionBreak')):
        raise ValueError('Review overlapping list boundaries before exporting an outline conversion to Word.')

    aliases = {}
    def original(node):
        result = deepcopy({k: v for k, v in node.items() if k != 'content'})
        log = node.get('attrs', {}).get('revisionProperties')
        if node['type'] in LISTS and log:
            previous = paragraph_format(log, True)
            result['type'], result['attrs'] = previous['type'], deepcopy(previous['attrs'])
        if 'content' in node:
            result['content'] = [original(n) for n in node['content']]
        aliases[id(result)] = node
        return result
    prior_sections = [{'blocks': [original(n) for n in s['blocks']]} for s in sections]
    old_bindings, old_outlines = word_outline_bindings(numbering.document, prior_sections)

    def records(parts, outlines, bindings, alias):
        result = {}
        def scope(parent, depth=0, owner=None, base=0):
            previous = {}
            for node in parent.get('content', []):
                if node['type'] in ('table_cell', 'table_header'):
                    scope(node)
                    continue
                if node['type'] not in LISTS:
                    scope(node, depth, owner, base)
                    continue
                attrs = node.get('attrs', {})
                current = alias(node)
                current_owner = current if id(current) in conversions else owner
                current_base = depth if id(current) in conversions else base
                outline = outlines.get(id(node))
                if outline:
                    number, level, spec = bindings[id(outline['items'][0]['node'])]
                    predecessor = alias(outline['previous']) if outline['previous'] is not None else None
                else:
                    level, spec = depth-current_base, relative_list_level(depth)
                    if current_base:spec={**spec,'nestedDepth':current_base,'nestedRoot':level==0}
                    key = attrs.get('listStyle') or 'decimal'
                    predecessor = previous.get(key) if node['type'] == 'ordered_list' and attrs.get('continuePrevious') else None
                    old = result.get(id(predecessor)) if predecessor is not None else None
                    from .nested_list_conversion import create_ordinary
                    args=(node['type']=='ordered_list',1 if attrs.get('continuePrevious') else attrs.get('order',1),attrs.get('listStyle'),bool(attrs.get('continuePrevious')))
                    number=old['number'] if old else create_ordinary(numbering,*args,current_base) if current_base else numbering.create(*args,relative=True)
                    if node['type'] == 'ordered_list':
                        previous[key] = current
                    for item in node.get('content', []):
                        bindings[id(item['content'][0])] = (number, level, spec)
                result[id(current)] = dict(number=number, level=level, spec=spec, previous=predecessor, owner=current_owner)
                scope(node, depth + 1, current_owner, current_base)
        for section in parts:
            scope({'content': section['blocks']})
        return result

    old = records(prior_sections, old_outlines, old_bindings, lambda n: aliases[id(n)])
    final = records(sections, final_outlines, final_bindings, lambda n: n)
    for identity, record in final.items():
        if identity not in final_outlines:
            final_numbers[identity] = record['number']
    result, stamps, number_aliases = {}, {}, {}
    for node in nodes:
        identity = id(node)
        if identity not in final:
            continue
        a, b = old[identity], final[identity]
        if a['level'] != b['level']:
            raise ValueError('Review conversion at an independently nested outline boundary before Word export.')
        log = node.get('attrs', {}).get('revisionProperties')
        native = native_cell_revision(log) if log else None
        own = native[0] if native else None
        dependencies = [conversions[id(r['owner'])] for r in (a, b) if r['owner'] is not None]
        dependencies += [stamps[id(r['previous'])] for r in (a, b) if r['previous'] is not None and stamps.get(id(r['previous']))]
        stamp = own or next(iter(dependencies), None)
        if any(s != stamp for s in dependencies):
            raise ValueError('Review independent changes in a converted numbering chain before Word export.')
        stamps[identity] = stamp
        if stamp is None:
            number_aliases[a['number']] = b['number']
        else:
            result[identity] = (stamp, number_aliases.get(a['number'], a['number']), a['spec'], b['spec'])
    return result


def reunite_conversions(groups, numbering):
    owners = []
    for listing, entries, scope, number in groups.values():
        log = listing.get('attrs', {}).get('revisionProperties')
        if not log:
            continue
        before = log['base']['attrs'].get('listTemplate')
        after = listing['attrs'].get('listTemplate')
        if bool(before) != bool(after):
            old = entries[0][0][0][0]
            owners.append((old if before else number, log['records'][0]['stamp']))
    for listing, entries, scope, number in groups.values():
        log = listing.get('attrs', {}).get('revisionProperties')
        if not log:
            continue
        old = entries[0][0][0][0]
        for record in log['records']:
            candidates = [s for native, s in owners if native in (old, number) and all(s.get(k) == record['stamp'].get(k) for k in ('author', 'date'))]
            if candidates:
                record['stamp'] = candidates[0]
