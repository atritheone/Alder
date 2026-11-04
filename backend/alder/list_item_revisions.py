"""Complete changed list items, reconstructed from native paragraph revisions."""
from .document_comments import walk


def require_word_item_change(node):
    allowed={'list_item','ordered_list','bullet_list','paragraph','text','hard_break','comment_anchor','bookmark','bookmark_end'}
    if any(n['type'] not in allowed for n in walk(node)):
        raise ValueError('Review changed list items containing objects or tables before Word export. Alder and HTML/EPUB retain their complete review.')


def require_word_list_change(node, sections):
    require_word_item_change(node)


def restore_word_item_changes(document):
    def visit(node):
        if node['type'] in ('ordered_list','bullet_list'):
            paragraphs=[n for n in walk(node) if n['type']=='paragraph']
            changes=[p.get('attrs',{}).get('revisionBlock') for p in paragraphs]
            if changes and all(changes):
                first=changes[0]
                if all(c['kind']==first['kind'] and all(c['stamp'].get(k,'')==first['stamp'].get(k,'') for k in ('author','date')) for c in changes):
                    identity='list_'+first['originalId']
                    node.setdefault('attrs',{}).update(blockId=identity,revisionBlock={'kind':first['kind'],'stamp':first['stamp'],'originalId':identity})
                    for paragraph in paragraphs:paragraph['attrs'].pop('revisionBlock')
                    return
            items=node.get('content',[])
            for item in items:
                paragraphs=[n for n in walk(item) if n['type']=='paragraph']
                changes=[p.get('attrs',{}).get('revisionBlock') for p in paragraphs]
                if not changes or not all(changes):continue
                first=changes[0]
                if any(c['kind']!=first['kind'] or any(c['stamp'].get(k,'')!=first['stamp'].get(k,'') for k in ('author','date')) for c in changes):continue
                identity='item_'+first['originalId']
                item.setdefault('attrs',{}).update(blockId=identity,revisionBlock={**first,'originalId':identity})
                for paragraph in paragraphs:paragraph['attrs'].pop('revisionBlock')
            # Native Word may split group IDs. Keep ranges spanning changed
            # items indivisible without joining unrelated adjacent revisions.
            edges={};joined=set()
            for index,item in enumerate(items):
                for anchor in walk(item):
                    attrs=anchor.get('attrs',{})
                    if anchor['type']=='comment_anchor':key=('comment',attrs['threadId']);edge=attrs['edge']
                    elif anchor['type']=='bookmark' and attrs.get('range'):key=('bookmark',attrs.get('blockId'));edge='start'
                    elif anchor['type']=='bookmark_end':key=('bookmark',attrs['targetId']);edge='end'
                    else:continue
                    edges.setdefault(key,{})[edge]=index
            for ends in edges.values():
                start,end=ends.get('start'),ends.get('end')
                if start is None or end is None or start>=end:continue
                changes=[i.get('attrs',{}).get('revisionBlock') for i in items[start:end+1]]
                if not any(changes):continue
                if not all(changes) or any(c['kind']!=changes[0]['kind'] or any(c['stamp'].get(k,'')!=changes[0]['stamp'].get(k,'') for k in ('author','date')) for c in changes):
                    raise ValueError('A Word comment or bookmark crosses incompatible changed list items.')
                joined.update(range(start+1,end+1))
            group=[]
            def finish():
                for part,item in enumerate(group):item['attrs']['revisionBlock'].update(stamp=group[0]['attrs']['revisionBlock']['stamp'],count=len(group),part=part)
            for index,item in enumerate(items):
                if not item.get('attrs',{}).get('revisionBlock') or (group and index not in joined):finish();group=[]
                if item.get('attrs',{}).get('revisionBlock'):group.append(item)
            finish()
        for child in node.get('content',[]):visit(child)
    visit(document)
