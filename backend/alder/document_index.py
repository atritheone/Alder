"""Anchored index entries, generated hierarchy and bounded Word XE exchange."""
import copy
import json
import re
import unicodedata


def validate_entry(attrs):
    terms=attrs.get('terms')
    if not isinstance(terms,list) or not 1<=len(terms)<=3 or any(not isinstance(term,str) or not term or term.strip()!=term or len(term)>200 or re.search(r'[\x00-\x1f\x7f]',term) for term in terms):
        raise ValueError('Use one to three index terms of at most 200 characters each.')
    see=attrs.get('see')
    if see is not None and (not isinstance(see,str) or len(see)>200 or re.search(r'[\x00-\x1f\x7f]',see)):
        raise ValueError('Use a plain-text index cross-reference of at most 200 characters.')
    target=attrs.get('rangeId')
    if target is not None and (not isinstance(target,str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}',target)):
        raise ValueError('Invalid index page range.')
    if target and see:raise ValueError('Choose a page range or a cross-reference for an index entry.')


def validate_reference(attrs):
    validate_entry(attrs)
    ids=attrs.get('targetIds')
    if not isinstance(ids,list) or len(ids)>100000 or any(not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}',value) for value in ids):
        raise ValueError('Invalid index entry identities.')
    if attrs.get('unresolved') is not None and type(attrs['unresolved']) is not bool:raise ValueError('Invalid index reference status.')


def entries(documents):
    result=[]
    def walk(node):
        if node['type']=='table_of_contents' or any(mark['type']=='revision_deletion' for mark in node.get('marks',[])):return
        if node['type']=='index_entry':result.append(node['attrs'])
        for child in node.get('content',[]):walk(child)
    for document in documents:walk(document)
    return result


def groups(sources):
    tree={}
    for source in sources:
        validate_entry(source);branch=tree
        for index,term in enumerate(source['terms']):
            group=branch.setdefault(term,{'term':term,'children':{},'ids':[],'see':[]})
            if index==len(source['terms'])-1:
                if source.get('see'):
                    if source['see'] not in group['see']:group['see'].append(source['see'])
                else:group['ids'].append(source['blockId'])
            branch=group['children']
    result=[]
    def order(term):return (''.join(c for c in unicodedata.normalize('NFKD',term) if not unicodedata.combining(c)).lower(),term)
    def walk(branch,parent):
        for term in sorted(branch,key=order):
            group=branch[term];terms=parent+[term]
            result.append({'terms':terms,'ids':group['ids'],'see':group['see']});walk(group['children'],terms)
    walk(tree,[]);return result


def refresh_index(node,sources,styles=None):
    from .models import document_text
    attrs=node.get('attrs',{});previous={}
    for paragraph in node.get('content',[]):
        reference=next((child for child in paragraph.get('content',[]) if child['type']=='index_reference'),None)
        if reference:previous[tuple(reference['attrs']['terms'])]=paragraph
    fallback={k:v for k,v in next(iter(previous.values()),{}).get('attrs',{}).items() if k!='blockId'}
    title=attrs.get('title','Index')
    legacy=[paragraph for paragraph in node.get('content',[]) if not any(child['type']=='index_reference' for child in paragraph.get('content',[])) and document_text(paragraph)!=title]
    content=[{'type':'paragraph','attrs':{'keepWithNext':True},'content':[{'type':'text','text':title,'marks':[{'type':'strong'}]}]}] if title else []
    for group in groups(sources):
        prior=previous.get(tuple(group['terms']),{})
        old=next((child for child in prior.get('content',[]) if child['type']=='index_reference'),None)
        if old is None:
            term=group['terms'][-1]
            for paragraph in legacy:
                text=document_text(paragraph).strip()
                if text==term or text.startswith(term+', ') or text.startswith(term+'\t') or text.startswith(term+'. '):
                    suffix=text[len(term):].lstrip(', \t')
                    if re.fullmatch(r'[0-9A-Za-z]+(?:[–-][0-9A-Za-z]+)?(?:,\s*[0-9A-Za-z]+(?:[–-][0-9A-Za-z]+)?)*',suffix):
                        old={'type':'index_reference','content':[{'type':'text','text':suffix}]}
                    prior=paragraph;legacy.remove(paragraph);break
        style=(styles or {}).get(attrs.get('entryStyle'),{})
        pa={**copy.deepcopy(prior.get('attrs',fallback)),**{k:v for k,v in style.items() if k not in ('id','name','kind','basedOn','nextStyle')},'styleId':attrs.get('entryStyle'),'leftIndent':(len(group['terms'])-1)*12,'keepWithNext':False,'headingNumbered':False}
        ids=group['ids'] if attrs.get('pageNumbers',True) else []
        parts=[{'type':'text','text':group['terms'][-1]}]
        if ids:parts.append({'type':'text','text':', '})
        parts.append({'type':'index_reference','attrs':{'terms':group['terms'],'targetIds':ids,'unresolved':bool((old or {}).get('attrs',{}).get('unresolved'))},'content':[{'type':'text','text':document_text(old) or '—'}] if ids and old else [{'type':'text','text':'—'}] if ids else []})
        if group['see']:parts.append({'type':'text','text':'. '+'; '.join(group['see']),'marks':[{'type':'em'}]})
        content.append({'type':'paragraph','attrs':pa,'content':parts})
    if len(content)==(1 if title else 0):content.append({'type':'paragraph','content':[{'type':'text','text':'No index entries available.'}]})
    node['content']=content


def xe_instruction(attrs):
    validate_entry(attrs)
    def escape(value):return value.replace('\\','\\\\').replace('"','\\"').replace(':','\\:')
    name=attrs.get('rangeName')
    if attrs.get('rangeId') and (not name or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,39}',name)):
        raise ValueError('An index page range has a missing or incomplete bookmark. Repair it before Word export.')
    return ' XE "'+':'.join(escape(term) for term in attrs['terms'])+'"'+(' \\t "'+escape(attrs['see'])+'"' if attrs.get('see') else '')+(' \\r '+name if attrs.get('rangeId') else '')+' '


def read_xe(instruction,warnings):
    quoted=r'"((?:\\.|[^"\\])*)"'
    match=re.fullmatch(r'\s*XE\s+'+quoted+r'(?:\s+\\t\s+'+quoted+r'|\s+\\r\s+(?:"([A-Za-z][A-Za-z0-9_]{0,39})"|([A-Za-z][A-Za-z0-9_]{0,39})))?\s*',instruction,re.I)
    if not match:return None
    def decode(value):return re.sub(r'\\(.)',r'\1',value)
    terms=[''];at=0
    while at<len(match[1]):
        char=match[1][at]
        if char=='\\' and at+1<len(match[1]):at+=1;terms[-1]+=match[1][at]
        elif char==':':terms.append('')
        else:terms[-1]+=char
        at+=1
    attrs={'terms':terms,'see':decode(match[2]) if match[2] else None}
    if match[3] or match[4]:attrs['rangeId']=match[3] or match[4]
    try:validate_entry(attrs)
    except ValueError:return None
    from uuid import uuid4
    attrs['blockId']='index_'+uuid4().hex
    return {'type':'index_entry','attrs':attrs}


def html_entry(attrs):
    import html
    payload={key:attrs[key] for key in ('terms','see','rangeId') if key in attrs}
    if attrs.get('rangeId') and attrs.get('rangeName'):payload['rangeId']=attrs['rangeName']
    return '<span data-index-entry="'+html.escape(json.dumps(payload,ensure_ascii=False),quote=True)+'" data-index-id="'+html.escape(attrs.get('blockId',''),quote=True)+'"></span>'
