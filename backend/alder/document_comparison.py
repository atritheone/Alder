"""Build a separate review of prose, lists and tables without changing inputs."""
from collections import Counter
from copy import deepcopy
from difflib import SequenceMatcher
import hashlib
import json
import re
from uuid import uuid4

from .models import validate_document,document_text
from .document_revisions import validate_revision,review_document
from .revision_formatting import format_patches


def canonical(node):
    """Identity is independent of wording/appearance when comparing copies."""
    if node.get('type')=='doc' and not node.get('content'):node={**node,'content':[{'type':'paragraph'}]}
    result={k:deepcopy(v) for k,v in node.items() if k not in ('attrs','content','marks')}
    attrs={k:deepcopy(v) for k,v in node.get('attrs',{}).items() if k!='blockId' and v is not None}
    if (node.get('type')=='ordered_list' or node.get('type')=='bullet_list' and attrs.get('listTemplate')) and attrs.get('continuePrevious'):attrs.pop('order',None)
    if attrs:result['attrs']=attrs
    if node.get('marks'):result['marks']=sorted(deepcopy(node['marks']),key=lambda m:m['type'])
    if node.get('content'):
        children=[]
        for c in node['content']:
            c=canonical(c)
            if children and c.get('type')=='text' and {k:v for k,v in c.items() if k!='text'}=={k:v for k,v in children[-1].items() if k!='text'}:children[-1]['text']+=c['text']
            else:children.append(c)
        result['content']=children
    return result


def compare_projects(store,request,create=False):
    """Snapshot both inputs under the same lock; publish only a validated copy."""
    from .models import create_project,validate_project,ValidationError,uid,now
    from .store import ConflictError
    from .document_revisions import revision_summary
    from .mail_merge import walk
    mode=request.get('mode','compare')
    if mode not in ('compare','combine'):raise ValidationError('Choose compare or combine reviews.')
    with store._lock:
        if any(not isinstance(request.get(k),str) for k in ('originalId','revisedId')):raise ValidationError('Choose two available documents.')
        a,b=[store.get(request.get(k,'')) for k in ('originalId','revisedId')]
        if a['id']==b['id']:raise ValidationError('Choose two different documents.')
        for key,source in [('originalRevision',a),('revisedRevision',b)]:
            if type(request.get(key)) is not int or request[key]!=source['revision']:
                raise ConflictError('A source document changed. Preview the comparison again.')
        if not a.get('book') or not b.get('book'):raise ValidationError('Open both files in Write before comparing them.')
        if any(a['settings'].get(k)!=b['settings'].get(k) for k in ('fontFamily','fontSize','lineHeight')):raise ValidationError('These documents use different default typography. Match their default font and spacing before comparing; direct paragraph and text formatting can differ.')
        left,right=a['book']['chapters'],deepcopy(b['book']['chapters'])
        if len(left)!=len(right):raise ValidationError('These books have different chapter structures. Compare matching chapter copies first.')
        # Unify equivalent named styles, retaining conflicting definitions under
        # distinct identities so either review outcome keeps its appearance.
        styles=deepcopy(a['styles']);mapping={};by_id={s['id']:s for s in b['styles']}
        def signature(style,available,seen=frozenset()):
            if style['id'] in seen:raise ValidationError('A source contains circular style inheritance. Resolve it before comparing.')
            seen=seen|{style['id']}
            result={k:v for k,v in style.items() if k not in ('id','basedOn','nextStyle')}
            if style.get('basedOn'):
                if style['basedOn'] not in available:raise ValidationError('A source style has a missing base. Resolve it before comparing.')
                result['base']=signature(available[style['basedOn']],available,seen)
            if style.get('nextStyle') in available:result['nextName']=available[style['nextStyle']]['name']
            return result
        old_by_id={s['id']:s for s in styles}
        for s in b['styles']:
            matching=next((v for v in a['styles'] if signature(v,old_by_id)==signature(s,by_id)),None)
            mapping[s['id']]=matching['id'] if matching else uid('style_')
        for s in b['styles']:
            if mapping[s['id']] in old_by_id:continue
            s=deepcopy(s);s['id']=mapping[s['id']]
            for k in ('basedOn','nextStyle'):
                if s.get(k):s[k]=mapping[s[k]]
            s['name']=s['name'][:180]+' (revised)';styles.append(s)
        for n in walk(right):
            if n.get('styleId') in mapping:n['styleId']=mapping[n['styleId']]
        result=create_project(a['name'][:170]+(' - combined review' if mode=='combine' else ' - comparison'),'blank')
        for key in ('settings','language','dictionary','pronunciation'):result[key]=deepcopy(a[key])
        result['styles']=styles;result['book']=deepcopy(a['book'])
        result['settings'].update(documentKind='book' if len(left)>1 else 'docx',preferredFormat='docx',trackChanges=True,reviewAuthor=request.get('author',''))
        summaries=[];conflicts=[];reanchored=0
        try:
            for index,(original,revised,chapter) in enumerate(zip(left,right,result['book']['chapters'])):
                if mode=='combine':
                    from .document_combination import combine_documents
                    combined=combine_documents(original['document'],revised['document'],request.get('choices'),str(index)+'_')
                    chapter['document']=combined['document'];conflicts.extend({**c,'chapter':chapter['title']} for c in combined['conflicts']);reanchored+=combined['reanchoredComments']
                else:chapter['document']=compare_documents(original['document'],revised['document'],request.get('author',''),now())
                for key in ('rawSource','rawFormat'):chapter.pop(key,None)
                summaries.append({'title':chapter['title'],'changes':len(revision_summary(chapter['document']))})
        except ValueError as error:raise ValidationError(str(error)) from error
        if mode=='combine' and set(request.get('choices') or {})-{c['id'] for c in conflicts}:raise ValidationError('The conflict choices no longer match these copies. Preview again.')
        if create and any(not c['choice'] for c in conflicts):raise ValidationError('Choose which review to keep for every conflict before creating the combined copy.')
        used={n.get('assetId') for n in walk({'settings':result['settings'],'book':result['book']})};used.add(result['settings'].get('coverAssetId'))
        result['assets']=[deepcopy(v) for v in a['assets'] if v['id'] in used]
        for n in walk({'settings':result['settings'],'book':result['book']}):
            if n.get('assetId'):n['src']=f"/api/projects/{result['id']}/assets/{n['assetId']}"
        result=validate_project(result)
        comments={n['attrs']['threadId'] for n in walk(result['book']) if n.get('type')=='comment_anchor'}
        summary={'chapters':summaries,'changes':sum(s['changes'] for s in summaries),'comments':len(comments)}
        if mode=='combine':summary.update(conflicts=conflicts,reanchoredComments=reanchored)
        if not create:return summary
        # Prepare and verify images before publishing the new project. Failed
        # comparisons never overwrite a source or register a partial result.
        assets=[]
        for asset in result['assets']:
            path,_=store.asset_path(a['id'],asset['id']);data=path.read_bytes()
            if hashlib.sha256(data).hexdigest()!=asset['path'].split('.')[0]:raise ValidationError('A source picture failed its integrity check.')
            assets.append((asset['path'],data))
        for filename,data in assets:store._atomic_bytes(store.asset_dir(result['id'])/filename,data)
        return {**summary,'project':store.insert(result)}


def compare_documents(original,revised,author,date):
    """Paragraph matching, moves, text edits and independent appearance changes.

    Pathological diff inputs fall back to a complete changed passage rather
    than running an unbounded quadratic character comparison.
    """
    def stamp(move=False):
        value={'id':'change_'+uuid4().hex,'author':author,'date':date}
        if move:value['move']=True
        validate_revision(value);return value
    stamp()
    from .comparison_comments import extract_comments,attach_comments
    original,revised=deepcopy((original,revised))
    validate_document(original);validate_document(revised)
    original,old_comments,old_annotations=extract_comments(original,recursive=True)
    revised,new_comments,new_annotations=extract_comments(revised,recursive=True)
    from .mail_merge import walk
    def prose(p):return p['type'] in ('paragraph','heading') and all(c['type'] in ('text','hard_break') for c in p.get('content',[]))
    containers={'ordered_list','bullet_list','list_item','table','table_row','table_cell','table_header'}
    def structured(node):return prose(node) or node['type'] in containers and all(structured(c) for c in node.get('content',[]))
    def movable(node):return prose(node) or node['type'] in ('ordered_list','bullet_list','table','table_row','list_item') and structured(node)
    for doc in (original,revised):
        validate_document(doc)
        for p in walk(doc):
            if any(p.get('attrs',{}).get(k) for k in ('revisionProperties','revisionMove','revisionBlock')) or p.get('type','').startswith('revision_'):
                raise ValueError('This comparison requires documents without pending revisions. Use Combine reviewed copies to retain existing reviews.')
    before,after=deepcopy(original.get('content',[])),deepcopy(revised.get('content',[]))
    from .list_formatting import list_sequences
    list_predecessors=[{id(node):id(previous) for node,previous in list_sequences({'content':nodes}) if previous is not None} for nodes in (before,after)]
    list_format_groups={}
    column_format_groups={}
    from .outline_lists import outline_layout
    outline_records=[{id(record['node']):record for record in outline_layout({'type':'doc','content':nodes})} for nodes in (before,after)]
    for predecessors,records in zip(list_predecessors,outline_records):
        predecessors.update({identity:id(record['previous']) for identity,record in records.items() if record['level']==0 and record['previous'] is not None})
    from .tracked_block_moves import identity_nodes
    for node in before+after:
        for identified in (node,*identity_nodes(node)):
            if not identified.setdefault('attrs',{}).get('blockId'):identified['attrs']['blockId']='block_'+uuid4().hex
    def key(n):return hashlib.sha256(json.dumps(canonical(n),sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    def sequence_plan(before,after,old_parent,new_parent):
        old,new=[key(n) for n in before],[key(n) for n in after]
        prefix=0
        while prefix<min(len(old),len(new)) and old[prefix]==new[prefix]:prefix+=1
        end_a,end_b=len(old),len(new)
        while end_a>prefix and end_b>prefix and old[end_a-1]==new[end_b-1]:end_a-=1;end_b-=1
        middle=SequenceMatcher(None,old[prefix:end_a],new[prefix:end_b],autojunk=False).get_opcodes() if (end_a-prefix)*(end_b-prefix)<=4_000_000 else [('replace',0,end_a-prefix,0,end_b-prefix)]
        ops=([('equal',0,prefix,0,prefix)] if prefix else [])+[(tag,a+prefix,b+prefix,c+prefix,d+prefix) for tag,a,b,c,d in middle]+([('equal',end_a,len(old),end_b,len(new))] if end_a<len(old) else [])
        deleted={i for tag,a,b,c,d in ops if tag!='equal' for i in range(a,b)}
        inserted={j for tag,a,b,c,d in ops if tag!='equal' for j in range(c,d)}
        old_counts,new_counts=Counter(old),Counter(new)
        destinations={new[j]:j for j in inserted if old_counts[new[j]]==1 and new_counts[new[j]]==1}
        moves={i:(destinations[old[i]],stamp(True)) for i in deleted if old[i] in destinations and movable(before[i])}
        # Adjacent blocks that travelled together are one move, including the
        # native paragraph/table boundary inside the same Word move range.
        bands=[]
        for i in sorted(moves):
            if bands and i==bands[-1][-1]+1 and moves[i][0]==moves[bands[-1][-1]][0]+1:bands[-1].append(i)
            else:bands.append([i])
        parts={}
        for band in bands:
            record=moves[band[0]][1]
            for part,i in enumerate(band):
                moves[i]=(moves[i][0],record);parts[i]={'part':part,'count':len(band)} if len(band)>1 else {}
        return ops,moves,{j:(i,s) for i,(j,s) in moves.items()},parts
    locations={}
    def path(value):return value if isinstance(value,tuple) else (value,)
    def locate(side,index,start,end,output,into=0):locations.setdefault((side,path(index)),[]).append((start,end,path(output),into))
    def locate_tree(side,node,address,output):
        if node['type'] in ('paragraph','heading'):locate(side,address,0,len(document_text(node)),output)
        else:
            for i,child in enumerate(node.get('content',[])):locate_tree(side,child,(*path(address),i),(*path(output),i))

    def marked(p,kind,record,move=False,parts=None):
        if not (movable(p) if move else prose(p) or p['type'] in ('table','table_row','list_item','ordered_list','bullet_list') and structured(p)):raise ValueError('This changed list, object or section needs a structured comparison. Both files are unchanged.')
        result=deepcopy(p);attrs=result.setdefault('attrs',{});identity=attrs.get('blockId') or 'block_'+uuid4().hex
        attrs['blockId']='block_'+uuid4().hex if move and kind=='deletion' else identity
        attrs['revisionMove' if move else 'revisionBlock']={'kind':kind,'stamp':record,'originalId':identity,**(parts or {})}
        if move and kind=='deletion':
            for child in identity_nodes(result):child.setdefault('attrs',{})['blockId']='block_'+uuid4().hex
        return result

    def parts(paragraph):
        result=[];offset=0
        for node in paragraph.get('content',[]):
            end=offset+(len(node['text']) if node['type']=='text' else 1);result.append((offset,end,node));offset=end
        return result

    def paragraph_change(a,b,old_index,new_index,output_index):
        if not prose(a) or not prose(b):raise ValueError('A changed or moved list, table, object or section needs a structured comparison. Both files are unchanged.')
        record=stamp();left,right=parts(a),parts(b);text_a=document_text(a);text_b=document_text(b)
        result=deepcopy(b);result.setdefault('attrs',{})['blockId']=a.get('attrs',{}).get('blockId') or 'block_'+uuid4().hex
        output=[];out_length=0
        def append(text,marks,kind='text'):
            nonlocal out_length
            if not text:return
            out_length+=len(text)
            marks=deepcopy(marks)
            if kind=='text' and output and output[-1]['type']=='text' and output[-1].get('marks',[])==marks:output[-1]['text']+=text
            else:output.append({'type':kind,**({'text':text} if kind=='text' else {}),**({'marks':marks} if marks else {})})
        def span(runs,start,end,kind=None):
            locate('old' if kind=='deletion' else 'new',old_index if kind=='deletion' else new_index,start,end,output_index,out_length)
            for lo,hi,n in runs:
                if hi<=start:continue
                if lo>=end:break
                marks=n.get('marks',[])+([{'type':'revision_'+kind,'attrs':record}] if kind else [])
                append((n['text'] if n['type']=='text' else '\n')[max(0,start-lo):min(hi,end)-lo],marks,n['type'])
        # Token boundaries keep accented words and joined emoji intact. Equal
        # passages are subsequently split only at authored formatting boundaries.
        def tokens(text):return re.findall(r'\s+|\S+',text)
        x,y=tokens(text_a),tokens(text_b)
        offsets=lambda values:[0]+[m.end() for m in re.finditer(r'\s+|\S+',''.join(values))]
        xa,ya=offsets(x),offsets(y)
        edits=SequenceMatcher(None,x,y,autojunk=False).get_opcodes() if len(x)*len(y)<=4_000_000 else [('replace',0,len(x),0,len(y))]
        for tag,i,j,k,l in edits:
            if tag!='equal':
                if tag in ('delete','replace'):span(left,xa[i],xa[j],'deletion')
                if tag in ('insert','replace'):span(right,ya[k],ya[l],'insertion')
                continue
            start,end,other=xa[i],xa[j],ya[k]
            old_runs=[r for r in left if r[1]>start and r[0]<end];new_runs=[r for r in right if r[1]>other and r[0]<other+end-start]
            oi=ni=0
            while start<end:
                old_run,new_run=old_runs[oi],new_runs[ni];size=min(end-start,old_run[1]-start,new_run[1]-other)
                old_marks,new_marks=old_run[2].get('marks',[]),new_run[2].get('marks',[]);patches=format_patches(old_marks,new_marks)
                if old_run[2]['type']!=new_run[2]['type']:
                    locate('old',old_index,start,start+size,output_index,out_length)
                    append(text_a[start:start+size],old_marks+[{'type':'revision_deletion','attrs':record}],old_run[2]['type'])
                    locate('new',new_index,other,other+size,output_index,out_length)
                    append(text_a[start:start+size],new_marks+[{'type':'revision_insertion','attrs':record}],new_run[2]['type'])
                    start+=size;other+=size
                    if start==old_run[1]:oi+=1
                    if other==new_run[1]:ni+=1
                    continue
                marks=new_marks
                if patches:marks=new_marks+[{'type':'revision_format','attrs':{'base':old_marks,'records':[{'stamp':record,'status':'pending','patches':patches}]}}]
                locate('old',old_index,start,start+size,output_index,out_length)
                locate('new',new_index,other,other+size,output_index,out_length)
                append(text_a[start:start+size],marks,new_run[2]['type']);start+=size;other+=size
                if start==old_run[1]:oi+=1
                if other==new_run[1]:ni+=1
        result['content']=output
        if not text_a:locate('old',old_index,0,0,output_index)
        if not text_b:locate('new',new_index,0,0,output_index,out_length)
        def appearance(p):return {'type':p['type'],'attrs':{k:deepcopy(v) for k,v in p.get('attrs',{}).items() if k!='blockId' and v is not None}}
        old_appearance,new_appearance=appearance(a),appearance(b)
        if old_appearance!=new_appearance:result['attrs']['revisionProperties']={'base':old_appearance,'records':[{'stamp':record,'status':'pending','before':old_appearance,'after':new_appearance}]}
        return result

    def structural_change(a,b,old_address,new_address,output_address):
        if prose(a) and prose(b):return paragraph_change(a,b,old_address,new_address,output_address)
        if a['type']==b['type']=='table':
            from .comparison_columns import column_boundary_change
            boundary = column_boundary_change(a,b,path(old_address),path(new_address),path(output_address),canonical,stamp,locate_tree)
            if boundary is not None:return boundary
            from .docx_support import table_grid
            old_columns,old_cells=table_grid(a.get('content',[]));new_columns,new_cells=table_grid(b.get('content',[]))
            if old_columns==new_columns and [c[:4] for c in old_cells]==[c[:4] for c in new_cells]:
                changed=[(left[-1],right[-1]) for left,right in zip(old_cells,new_cells) if left[-1].get('attrs',{}).get('colwidth')!=right[-1].get('attrs',{}).get('colwidth')]
                if changed:
                    record=stamp()
                    for left,right in changed:column_format_groups[(id(left),id(right))]=record
        appearance=lambda n:canonical({k:v for k,v in n.items() if k!='content'})
        if a['type'] in ('table_cell','table_header') and b['type']==a['type'] and structured(a) and structured(b):
            if any(a.get('attrs',{}).get(k)!=b.get('attrs',{}).get(k) for k in ('colspan','rowspan')):
                raise ValueError('This changed table grid needs a structured comparison of its boundaries. Both files are unchanged.')
            result={**deepcopy(b),'content':compare_sequence(a.get('content',[]),b.get('content',[]),path(old_address),path(new_address),path(output_address))}
            before,after=appearance(a),appearance(b)
            for side in (before,after):side.setdefault('attrs',{})
            if before!=after:
                result.setdefault('attrs',{})['revisionProperties']={'base':before,'records':[{'stamp':column_format_groups.get((id(a),id(b))) or stamp(),'status':'pending','before':before,'after':after}]}
            return result
        changed=appearance(a)!=appearance(b)
        table_format=a['type'] in ('table','table_row') and a['type']==b['type'] or a['type'] in ('ordered_list','bullet_list') and b['type'] in ('ordered_list','bullet_list')
        if a['type'] not in containers or not structured(a) or not structured(b) or changed and not table_format:
            raise ValueError('This changed list or table needs a structured comparison of its boundaries. Both files are unchanged.')
        result=deepcopy(b)
        if changed:
            before,after=appearance(a),appearance(b)
            for side in (before,after):side.setdefault('attrs',{})
            allowed={'align'} if a['type']=='table' else {'allowSplit','minHeight'} if a['type']=='table_row' else {'listStyle','order','continuePrevious','listTemplate'}
            if any(before['attrs'].get(k)!=after['attrs'].get(k) for k in before['attrs'].keys()|after['attrs'].keys() if k not in allowed):
                raise ValueError('This changed table needs a structured comparison of its properties. Both files are unchanged.')
            record=stamp()
            if a['type'] in ('ordered_list','bullet_list'):
                transition=tuple(json.dumps({k:side['attrs'].get(k) for k in ('listTemplate','listStyle')},sort_keys=True) for side in (before,after))
                previous=list_format_groups.get((list_predecessors[0].get(id(a)),list_predecessors[1].get(id(b))))
                if previous and previous[1]==transition:record=previous[0]
                parents=[records.get(id(node)) for records,node in zip(outline_records,(a,b))]
                if all(parents) and parents[0]['level']==parents[1]['level'] and parents[0]['level']>0:
                    owner=list_format_groups.get(tuple(id(p['root']) for p in parents))
                    # A type change dictated by the changed outline template is
                    # part of that same operation, not an independent revision.
                    from .list_formatting import BULLETS
                    kinds=['bullet_list' if p['template'][p['level']]['format'] in BULLETS else 'ordered_list' for p in parents]
                    keys=set(before['attrs'])|set(after['attrs'])
                    if owner and kinds==[a['type'],b['type']] and a['type']!=b['type'] and all(before['attrs'].get(k)==after['attrs'].get(k) for k in keys if k!='listStyle'):
                        record=owner[0]
                list_format_groups[(id(a),id(b))]=(record,transition)
            result.setdefault('attrs',{})['revisionProperties']={'base':before,'records':[{'stamp':record,'status':'pending','before':before,'after':after}]}
        if a['type']!='table_row':
            return {**result,'content':compare_sequence(a.get('content',[]),b.get('content',[]),path(old_address),path(new_address),path(output_address))}
        if len(a.get('content',[]))!=len(b.get('content',[])):
            raise ValueError('This changed table grid needs a structured comparison of its boundaries. Both files are unchanged.')
        children=[]
        for index,(left,right) in enumerate(zip(a.get('content',[]),b.get('content',[]))):
            old_path=(*path(old_address),index);new_path=(*path(new_address),index);out_path=(*path(output_address),index)
            if canonical(left)==canonical(right):
                locate_tree('old',left,old_path,out_path);locate_tree('new',right,new_path,out_path);children.append(deepcopy(left))
            else:children.append(structural_change(left,right,old_path,new_path,out_path))
        result['content']=children
        return result

    def compare_sequence(before,after,old_parent=(),new_parent=(),out_parent=()):
        if len(before)==len(after)==1:
            for placeholder,listing,annotations,address,side in [
                (before[0],after[0],old_annotations,(*old_parent,0),'new'),
                (after[0],before[0],new_annotations,(*new_parent,0),'old')]:
                if canonical(placeholder)=={'type':'paragraph'} and address not in annotations and listing['type'] in ('ordered_list','bullet_list'):
                    locate_tree(side,listing,(*(new_parent if side=='new' else old_parent),0),(*out_parent,0))
                    return [marked(listing,'insertion' if side=='new' else 'deletion',stamp())]
        ops,moves,reverse,move_parts=sequence_plan(before,after,old_parent,new_parent)
        output=[]
        def emit(side,index,record=None,parts=None):
            old_side=side=='old';nodes=before if old_side else after;parent=old_parent if old_side else new_parent
            locate_tree(side,nodes[index],(*parent,index),(*out_parent,len(output)))
            paired=moves if old_side else reverse;source=index if old_side else paired[index][0] if index in paired else None
            if index in paired:output.append(marked(before[source],'deletion' if old_side else 'insertion',paired[index][1],True,move_parts[source]))
            else:output.append(marked(nodes[index],'deletion' if old_side else 'insertion',record or stamp(),parts=parts))
        def emit_range(side,begin,end):
            nodes,paired=(before,moves) if side=='old' else (after,reverse)
            index=begin
            while index<end:
                stop=index+1
                if nodes[index]['type'] in ('table_row','list_item') and index not in paired:
                    while stop<end and nodes[stop]['type']==nodes[index]['type'] and stop not in paired:stop+=1
                record=stamp()
                for part,i in enumerate(range(index,stop)):emit(side,i,record,{'part':part,'count':stop-index} if stop-index>1 else None)
                index=stop
        for tag,a,b,c,d in ops:
            if tag=='equal':
                for i,j in zip(range(a,b),range(c,d)):
                    out=(*out_parent,len(output));locate_tree('old',before[i],(*old_parent,i),out);locate_tree('new',after[j],(*new_parent,j),out);output.append(deepcopy(before[i]))
            elif tag=='delete':emit_range('old',a,b)
            elif tag=='insert':emit_range('new',c,d)
            else:
                i,j=a,c
                while i<b or j<d:
                    if i<b and i in moves:emit('old',i);i+=1
                    elif j<d and j in reverse:emit('new',j);j+=1
                    elif i<b and j<d:
                        from .compare_item_breaks import item_boundary_change
                        boundary = item_boundary_change(before[i:min(b,i+2)],after[j:min(d,j+2)],(*old_parent,i),(*new_parent,j),(*out_parent,len(output)),canonical,stamp,locate,locate_tree)
                        if boundary:
                            old_count,new_count,nodes=boundary;output.extend(nodes);i+=old_count;j+=new_count;continue
                        output.append(structural_change(before[i],after[j],(*old_parent,i),(*new_parent,j),(*out_parent,len(output))));i+=1;j+=1
                    elif i<b:emit_range('old',i,b);i=b
                    else:emit_range('new',j,d);j=d
        return output

    result={'type':'doc','content':compare_sequence(before,after)}
    # Local sequence matching cannot see an unchanged list moved between two
    # different parent items/cells. Pair only unambiguous complete boundaries;
    # duplicate lists and independent edits remain separate review decisions.
    from .comparison_list_moves import pair_list_moves
    pair_list_moves(result, before, after, key, marked, stamp)
    validate_document(result)
    # Never publish a plausible comparison whose two decisions lose input content.
    if canonical(review_document(result,'original'))!=canonical(original) or canonical(review_document(result,'final'))!=canonical(revised):
        raise ValueError('This comparison could not preserve both document views. Both source files are unchanged.')
    result=attach_comments(result,old_comments,new_comments,locations)
    from .document_comments import mirror_word_move_comments
    mirror_word_move_comments(result)
    validate_document(result)
    return result
