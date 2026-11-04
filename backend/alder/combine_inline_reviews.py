"""Merge disjoint inline/property revisions against one unchanged original."""
from copy import deepcopy
from .document_comparison import canonical
from .document_revisions import review_document
from .revision_formatting import format_marks
from .paragraph_revisions import paragraph_format


def merge_paragraph(a,b,base,signature):
    if any(p['type'] not in ('paragraph','heading') or p.get('attrs',{}).get('revisionBlock') or p.get('attrs',{}).get('revisionMove') for p in (a,b)):return None
    if any(n['type'] not in ('text','hard_break') or any(m.get('attrs',{}).get('move') for m in n.get('marks',[])) for p in (a,b) for n in p.get('content',[])):return None
    def pending(log):return [r for r in (log or {}).get('records',[]) if r['status']=='pending']
    def properties(p):
        log=p.get('attrs',{}).get('revisionProperties');records=pending(log);touched=set()
        for r in records:
            if r['before']['type']!=r['after']['type']:touched.add('type')
            old,new=r['before']['attrs'],r['after']['attrs']
            touched.update(k for k in old.keys()|new.keys() if old.get(k)!=new.get(k))
        return records,touched
    ra,ta=properties(a);rb,tb=properties(b)
    if ta&tb:return None
    attrs=deepcopy(base.get('attrs',{}));node_type=base['type']
    if ra or rb:
        log={'base':{'type':node_type,'attrs':{k:v for k,v in attrs.items() if k!='blockId' and v is not None}},'records':deepcopy(ra+rb)}
        final=paragraph_format(log);node_type=final['type'];attrs={**final['attrs'],'blockId':attrs.get('blockId'),'revisionProperties':log}
    def index(p):
        spans=[];insertions={};offset=0
        for n in p.get('content',[]):
            marks=[m for m in n.get('marks',[]) if m['type'] in ('revision_insertion','revision_deletion')]
            if len(marks)>1:return None
            size=len(n['text']) if n['type']=='text' else 1
            if marks and marks[0]['type']=='revision_insertion':insertions.setdefault(offset,[]).append(n)
            else:spans.append((offset,offset+size,n));offset+=size
        return spans,insertions,offset
    ia,ib=index(a),index(b)
    if ia is None or ib is None or ia[2]!=ib[2]:return None
    def changed(n):return any(m['type']=='revision_deletion' or m['type']=='revision_format' and pending(m['attrs']) for m in n.get('marks',[]))
    def cut(n,start,end):return {**deepcopy(n),**({'text':n['text'][start:end]} if n['type']=='text' else {})}
    def format_merge(a,b):
        logs=[next((m['attrs'] for m in n.get('marks',[]) if m['type']=='revision_format'),None) for n in (a,b)]
        if not all(logs) or any(m['type'] in ('revision_insertion','revision_deletion') for n in (a,b) for m in n.get('marks',[])):return None
        def touched(log):
            values=set()
            for r in pending(log):
                for patch in r['patches']:
                    before,after=patch['before'],patch['after']
                    if before is None or after is None:values.add((patch['type'],'*'))
                    else:values.update((patch['type'],k) for k in before.keys()|after.keys() if before.get(k)!=after.get(k))
            return values
        x,y=map(touched,logs)
        if any(t==u and (k==l or '*' in (k,l)) for t,k in x for u,l in y):return None
        log={'base':format_marks(logs[0],True),'records':deepcopy(pending(logs[0])+pending(logs[1]))}
        return {**deepcopy(a),'marks':format_marks(log)+[{'type':'revision_format','attrs':log}]}
    cuts=sorted({0,ia[2],*ia[1],*ib[1],*(v for side in (ia,ib) for start,end,n in side[0] for v in (start,end))})
    output=[];indices=[0,0]
    for i,start in enumerate(cuts):
        inserts=[side[1].get(start,[]) for side in (ia,ib)]
        if all(inserts) and signature(inserts[0])!=signature(inserts[1]):return None
        for side in (0,1):
            if inserts[side] and any(lo<start<hi and changed(n) for lo,hi,n in (ib if side==0 else ia)[0]):return None
        output.extend(deepcopy(inserts[0] or inserts[1]))
        if i==len(cuts)-1:continue
        end=cuts[i+1];parts=[]
        for side,source in enumerate((ia,ib)):
            while indices[side]<len(source[0]) and source[0][indices[side]][1]<=start:indices[side]+=1
            if indices[side]>=len(source[0]):return None
            lo,hi,n=source[0][indices[side]];parts.append(cut(n,start-lo,end-lo))
        x,y=map(changed,parts)
        if x and y and signature([parts[0]])!=signature([parts[1]]):
            merged=format_merge(*parts)
            if merged is None:return None
            output.append(merged)
        else:output.append(parts[1] if y and not x else parts[0])
    result={'type':node_type,'attrs':attrs,'content':output}
    if canonical(review_document({'type':'doc','content':[result]},'original'))!=canonical({'type':'doc','content':[base]}):return None
    return result
