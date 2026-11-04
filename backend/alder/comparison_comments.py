"""Carry both inputs' comment threads through the comparison's text mapping."""
from copy import deepcopy
import json
from uuid import uuid4


def extract_comments(document,recursive=False,live_moves=False):
    plain=deepcopy(document);threads={};annotated=set()
    def paragraphs(node,path=(),ghost=False):
        for index,child in enumerate(node.get('content',[])):
            address=(*path,index)
            hidden=ghost or (live_moves and child.get('attrs',{}).get('revisionMove',{}).get('kind')=='deletion')
            if not recursive:yield index,child,hidden
            elif child['type'] in ('paragraph','heading'):yield address,child,hidden
            else:yield from paragraphs(child,address,hidden)
    for index,paragraph,ghost in paragraphs(plain):
        content=[];offset=0
        for node in paragraph.get('content',[]):
            if node['type']=='comment_anchor':
                # A validated moved range has an identical display copy on its
                # source. Strip both copies, but map the one live thread only.
                if ghost:continue
                attrs=node['attrs'];item=threads.setdefault(attrs['threadId'],{'thread':deepcopy(attrs['thread']),'edges':{}})
                if attrs['edge'] in item['edges'] or item['thread']!=attrs['thread']:raise ValueError('Repair incomplete or inconsistent comment anchors before comparing.')
                item['edges'][attrs['edge']]=(index,offset);annotated.add(index)
            else:
                content.append(node);offset+=1 if node['type']=='hard_break' else len(node.get('text',''))
        paragraph['content']=content
    if any(set(v['edges'])!={'start','end'} or v['edges']['start']>v['edges']['end'] for v in threads.values()):raise ValueError('Repair incomplete comment anchors before comparing.')
    return plain,threads,annotated


def attach_comments(document,original,revised,locations):
    """Shared thread identities combine replies; revised anchors take precedence.

    Independently imported identical comments deduplicate only when their full
    thread and mapped range agree. Different comments never merge by wording alone.
    """
    def position(side,edge,at):
        paragraph,offset=at;segments=locations.get((side,paragraph),[])
        matches=[v for v in segments if v[0]<=offset<=v[1]]
        if not matches:raise ValueError('A comment could not be mapped without losing its anchor. Both files are unchanged.')
        start,end,output,into=matches[-1] if edge=='start' else matches[0]
        return output,into+offset-start
    merged={}
    for side,threads in [('old',original),('new',revised)]:
        for identity,item in threads.items():
            current=deepcopy(item);current['edges']={edge:position(side,edge,at) for edge,at in item['edges'].items()}
            if identity in merged:
                before=merged[identity]['thread'];after=current['thread'];entries=deepcopy(before['entries'])
                for entry in after['entries']:
                    if entry in entries:continue
                    if any(v['id']==entry['id'] for v in entries):entry={**entry,'id':'entry_'+uuid4().hex}
                    entries.append(entry)
                current['thread']={'resolved':before['resolved'] and after['resolved'],'entries':entries}
            merged[identity]=current
    seen=set();anchors={}
    for item in merged.values():
        if item['edges']['start']>item['edges']['end']:raise ValueError('A comment range crossed during comparison. Both files are unchanged.')
        signature=json.dumps({'edges':item['edges'],'thread':{**item['thread'],'entries':[{k:v for k,v in e.items() if k!='id'} for e in item['thread']['entries']]}},sort_keys=True)
        if signature in seen:continue
        seen.add(signature);identity='comment_'+uuid4().hex
        for edge,(paragraph,offset) in item['edges'].items():
            anchors.setdefault(paragraph,[]).append((offset,{'type':'comment_anchor','attrs':{'threadId':identity,'edge':edge,'thread':deepcopy(item['thread'])}}))
    for index,markers in anchors.items():
        markers.sort(key=lambda v:(v[0],0 if v[1]['attrs']['edge']=='start' else 1))
        paragraph=document
        for part in index if isinstance(index,tuple) else (index,):paragraph=paragraph['content'][part]
        output=[];offset=0;next_marker=0
        for node in paragraph.get('content',[]):
            if node['type']!='text':
                while next_marker<len(markers) and markers[next_marker][0]<=offset:
                    output.append(markers[next_marker][1]);next_marker+=1
                output.append(node);offset+=1 if node['type']=='hard_break' else 0;continue
            end=offset+len(node['text']);start=offset
            while next_marker<len(markers) and markers[next_marker][0]<=end:
                at,anchor=markers[next_marker];next_marker+=1
                if at>start:output.append({**deepcopy(node),'text':node['text'][start-offset:at-offset]})
                output.append(anchor);start=at
            if end>start:output.append({**deepcopy(node),'text':node['text'][start-offset:]})
            offset=end
        output.extend(anchor for _,anchor in markers[next_marker:]);paragraph['content']=output
    return document
