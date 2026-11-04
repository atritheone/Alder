"""Combine independent reviewed copies without accepting either author's edits."""
from copy import deepcopy
from difflib import SequenceMatcher
import hashlib
import json
from uuid import uuid4

from .models import validate_document,document_text
from .document_revisions import review_document,revision_summary
from .document_comparison import canonical
from .comparison_comments import extract_comments,attach_comments
from .mail_merge import walk


def combine_documents(first,second,choices=None,prefix=''):
    choices={} if choices is None else choices
    if not isinstance(choices,dict) or any(v not in ('original','revised') for v in choices.values()):raise ValueError('Choose which reviewed copy to keep for each conflict.')
    validate_document(first);validate_document(second)
    a,comments_a,_=extract_comments(first,recursive=True,live_moves=True);b,comments_b,_=extract_comments(second,recursive=True,live_moves=True)
    baseline=review_document(a,'original')
    if canonical(baseline)!=canonical(review_document(b,'original')):raise ValueError('These copies do not share the same original document. Use Compare documents instead, or choose reviews of the same original.')
    # Every imported copy owns its revision identifiers; authors and dates remain
    # untouched. Equivalent records are deduplicated by their semantic signature.
    ids={}
    for n in walk(b):
        if all(k in n for k in ('id','author','date')):
            ids.setdefault(n['id'],'change_'+uuid4().hex);n['id']=ids[n['id']]
    base=baseline.get('content',[]);regions=[key for i in range(len(base)+1) for key in ([('gap',i),('body',i)] if i<len(base) else [('gap',i)])]
    from .combine_review_regions import review_regions
    left,left_indices,left_links=review_regions(a,base,regions)
    right,right_indices,right_links=review_regions(b,base,regions)
    def signature(nodes):
        source=deepcopy({'type':'doc','content':nodes})
        identities={n['attrs']['blockId']:i for i,n in enumerate(walk(source)) if isinstance(n.get('attrs'),dict) and n['attrs'].get('blockId')}
        for n in walk(source):
            if 'nextId' in n:n['nextId']=identities.get(n['nextId'],n['nextId'])
            n.pop('blockId',None);n.pop('originalId',None)
            if all(k in n for k in ('id','author','date')):n.pop('id')
        return json.dumps(canonical(source),sort_keys=True,ensure_ascii=False)
    def pending(nodes):return revision_summary({'type':'doc','content':nodes})
    from .combine_structured_reviews import merge_structure
    parent={key:key for key in regions}
    def find(key):
        while parent[key]!=key:
            parent[key]=parent[parent[key]];key=parent[key]
        return key
    def union(a,b):parent[find(a)]=find(b)
    # A move, or one author operation spanning paragraphs, is indivisible.
    for branch in (left,right):
        groups={}
        for key,nodes in branch.items():
            for record in pending(nodes):
                if record['id'] in groups:union(key,groups[record['id']])
                else:groups[record['id']]=key
    for keys in left_links+right_links:
        for key in keys[1:]:union(keys[0],key)
    components={}
    for key in regions:components.setdefault(find(key),[]).append(key)
    def component_nodes(branch,keys):return [n for key in keys for n in branch[key]]
    automatic={};conflicts=[];conflict_ids={};selected={}
    def conflict(keys,old,new,path=()):
        identifier=prefix+'conflict_'+hashlib.sha256(repr((keys,path) if path else keys).encode()).hexdigest()[:16]
        snippets=lambda nodes:document_text({'type':'doc','content':nodes}).strip()[:500]
        location={}
        if path:
            names={'table':'table','table_row':'row','table_cell':'cell','table_header':'cell',
                   'ordered_list':'list','bullet_list':'list','list_item':'item','paragraph':'paragraph','heading':'heading'}
            siblings=base;parts=[]
            for index in (keys[0][1],*path):
                node=siblings[index];name=names.get(node['type'],node['type'])
                number=sum(names.get(n['type'],n['type'])==name for n in siblings[:index+1])
                parts.append(f'{name} {number}');siblings=node.get('content',[])
            location={'location':', '.join(parts)}
        return {'id':identifier,'paragraph':min(key[1] for key in keys)+1,
                'original':snippets(old),'revised':snippets(new),'choice':choices.get(identifier),**location}
    for root,keys in components.items():
        old,new=component_nodes(left,keys),component_nodes(right,keys)
        changed_a,changed_b=bool(pending(old)),bool(pending(new))
        selected[root]='revised' if changed_b and not changed_a else 'original'
        if not (changed_a and changed_b) or signature(old)==signature(new):continue
        # Merge stable nested boundaries; conflicts between independent nested
        # paragraphs can be chosen without discarding neighbouring reviews.
        if len(keys)==1 and keys[0][0]=='body' and len(old)==len(new)==1:
            merged=merge_structure(old[0],new[0],base[keys[0][1]],signature)
            nested=[]
            if merged is None:
                def resolve(a,b,path):
                    record=conflict(keys,[a],[b],path);nested.append(record)
                    return deepcopy(b if record['choice']=='revised' else a)
                merged=merge_structure(old[0],new[0],base[keys[0][1]],signature,resolve)
            if merged is not None:
                conflicts.extend(nested)
                automatic[root]=[merged];continue
        record=conflict(keys,old,new);identifier=record['id']
        conflict_ids[root]=identifier;selected[root]=choices.get(identifier,'original')
        conflicts.append(record)
    conflicts.sort(key=lambda c:c['paragraph'])
    result=[];output_regions={}
    for key in regions:
        root=find(key)
        nodes=automatic[root] if root in automatic else (left if selected[root]=='original' else right)[key]
        output_regions[key]=list(range(len(result),len(result)+len(nodes)))
        result.extend(deepcopy(nodes))
    output={'type':'doc','content':result}
    validate_document(output)
    if canonical(review_document(output,'original'))!=canonical(baseline):raise ValueError('The combined review could not retain the shared original. Both files are unchanged.')
    # Preserve comments from either copy, even when a conflict removes their
    # quoted wording. Such ranges collapse at the corresponding edit boundary.
    locations={};relocated=set()
    def mapped_offset(old,new,offset,edge):
        if old==new:return offset,False
        edits=SequenceMatcher(None,old,new,autojunk=True).get_opcodes() if len(old)*len(new)<=4_000_000 else [('replace',0,len(old),0,len(new))]
        matches=[op for op in edits if op[1]<=offset<=op[2]]
        if not matches:return min(offset,len(new)),True
        tag,start,end,left,right=matches[-1] if edge=='start' else matches[0]
        return (left+offset-start,False) if tag=='equal' else (left if edge=='start' else right,True)
    # Comment offsets include pending deleted wording and exclude atomic break
    # markers, exactly like extract_comments. Final-view text is not that space.
    def raw_text(node):return ''.join('\n' if c['type']=='hard_break' else c.get('text','') for c in node.get('content',[]))
    def paragraphs(node,address=()):
        if node.get('attrs',{}).get('revisionMove',{}).get('kind')=='deletion':return
        if node['type'] in ('paragraph','heading'):
            yield address,node
        else:
            for i,child in enumerate(node.get('content',[])):
                yield from paragraphs(child,(*address,i))
    def destinations_for(keys):
        return [(address,node) for candidate in keys for i in output_regions[candidate] for address,node in paragraphs(result[i],(i,))]
    cache={};identity_targets={}
    for side,doc,indices,threads,branch in [('old',a,left_indices,comments_a,left),('new',b,right_indices,comments_b,right)]:
        for identity,thread in threads.items():
            for edge,(index,offset) in thread['edges'].items():
                key,part=indices[index[0]];root=find(key);keys=components[root]
                if root not in identity_targets:
                    targets={}
                    for address,node in destinations_for(keys):
                        block_identity=node.get('attrs',{}).get('blockId')
                        if block_identity:targets.setdefault(block_identity,[]).append((address,node))
                    identity_targets[root]=targets
                old_node=doc
                for component in index:old_node=old_node['content'][component]
                matching=identity_targets[root].get(old_node.get('attrs',{}).get('blockId'),[])
                if len(matching)==1:
                    target,new_node=matching[0]
                    into,moved=mapped_offset(raw_text(old_node),raw_text(new_node),offset,edge)
                    if moved:relocated.add((side,identity))
                    locations.setdefault((side,index),[]).append((offset,offset,target,into))
                    continue
                if root in automatic:
                    # Automatic container merges retain every child boundary.
                    # Map within that paragraph so repeated wording elsewhere
                    # cannot attract a comment to a different item or cell.
                    target=(output_regions[key][0],*index[1:])
                    old_node,new_node=doc,output
                    for component in index:old_node=old_node['content'][component]
                    for component in target:new_node=new_node['content'][component]
                    into,moved=mapped_offset(raw_text(old_node),raw_text(new_node),offset,edge)
                    if moved:relocated.add((side,identity))
                    locations.setdefault((side,index),[]).append((offset,offset,target,into))
                    continue
                if (side,root) not in cache:
                    old_parts=[(key,part,address,p) for key in keys for part,n in enumerate(branch[key]) for address,p in paragraphs(n)]
                    offsets={};position=0
                    for candidate,part_index,address,node in old_parts:
                        offsets[candidate,part_index,address]=position;position+=len(raw_text(node))+1
                    destinations=destinations_for(keys)
                    old_text='\n'.join(raw_text(n) for _,_,_,n in old_parts)
                    new_text='\n'.join(raw_text(node) for _,node in destinations)
                    cache[side,root]=(offsets,destinations,old_text,new_text)
                offsets,destinations,old_text,new_text=cache[side,root]
                if destinations:
                    into,moved=mapped_offset(old_text,new_text,offsets[key,part,index[1:]]+offset,edge)
                    target,target_node=destinations[-1]
                    for candidate,node in destinations:
                        length=len(raw_text(node))
                        if into<=length:target,target_node=candidate,node;break
                        into-=length+1
                    into=max(0,min(into,len(raw_text(target_node))))
                else:
                    following=destinations_for(regions[regions.index(keys[-1])+1:])
                    available=following or destinations_for(regions)
                    if not available:raise ValueError('A combined comment has no remaining paragraph for its anchor. Both copies are unchanged.')
                    target,target_node=available[0] if following else available[-1];into=0 if following else len(raw_text(target_node));moved=True
                if moved:relocated.add((side,identity))
                locations.setdefault((side,index),[]).append((offset,offset,target,into))
    output=attach_comments(output,comments_a,comments_b,locations)
    from .document_comments import mirror_word_move_comments
    mirror_word_move_comments(output)
    validate_document(output)
    return {'document':output,'conflicts':conflicts,'reanchoredComments':len(relocated)}
