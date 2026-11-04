"""Anchored index entries, generated hierarchy and bounded Word XE exchange."""
import copy
import json
import re
from .index_collation import sort_keys, word_language, language_from_word


def index_group(value=None):return (value or 'I').upper()


def validate_group(value):
    if value is not None and (not isinstance(value,str) or not re.fullmatch('[A-Za-z]',value)):
        raise ValueError('Choose an index group from A to Z; General is group I.')


def index_key(value):return (tuple(value['terms']),tuple(value.get('sortTerms') or ()) if any(value.get('sortTerms') or ()) else ())


def validate_entry(attrs):
    validate_group(attrs.get('indexGroup'))
    terms=attrs.get('terms')
    if not isinstance(terms,list) or not 1<=len(terms)<=3 or any(not isinstance(term,str) or not term or term.strip()!=term or len(term)>200 or re.search(r'[\x00-\x1f\x7f]',term) for term in terms):
        raise ValueError('Use one to three index terms of at most 200 characters each.')
    sorts=attrs.get('sortTerms')
    if sorts is not None and (not isinstance(sorts,list) or len(sorts)>len(terms) or any(not isinstance(term,str) or term.strip()!=term or len(term)>200 or re.search(r'[\x00-\x1f\x7f]',term) for term in sorts)):
        raise ValueError('Use plain sort text of at most 200 characters for each index level.')
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
        if (node.get('attrs',{}).get('revisionMove') or node.get('attrs',{}).get('revisionBlock') or {}).get('kind')=='deletion':return
        if node['type']=='table_of_contents' or any(mark['type']=='revision_deletion' for mark in node.get('marks',[])):return
        if node['type']=='index_entry':result.append(node['attrs'])
        for child in node.get('content',[]):walk(child)
    for document in documents:walk(document)
    return result


def groups(sources,group_name=None,use_sort_text=True,language=None):
    tree={}
    for source in sources:
        validate_entry(source)
        if index_group(source.get('indexGroup'))!=index_group(group_name):continue
        branch=tree
        for index,term in enumerate(source['terms']):
            sort=((source.get('sortTerms') or [])[index] if index<len(source.get('sortTerms') or []) else '') if use_sort_text else ''
            group=branch.setdefault((term,sort or term),{'term':term,'sort':sort or term,'children':{},'ids':[],'see':[]})
            if index==len(source['terms'])-1:
                if source.get('see'):
                    if source['see'] not in group['see']:group['see'].append(source['see'])
                else:group['ids'].append(source['blockId'])
            branch=group['children']
    result=[]
    def walk(branch,parent,sorts,order):
        for key in sorted(branch,key=lambda key:(order(key[1]),order(key[0]),key[0].encode('utf-16-be'),key[1].encode('utf-16-be'))):
            group=branch[key];term=group['term'];terms=parent+[term];sort_terms=sorts+[group['sort'] if group['sort']!=term else '']
            result.append({'terms':terms,'ids':group['ids'],'see':group['see'],**({'sortTerms':sort_terms} if any(sort_terms) else {})});walk(group['children'],terms,sort_terms,order)
    if tree:
        with sort_keys(language) as order:walk(tree,[],[],order)
    return result


def refresh_index(node,sources,styles=None):
    from .models import document_text
    attrs=node.get('attrs',{});previous={}
    for paragraph in node.get('content',[]):
        reference=next((child for child in paragraph.get('content',[]) if child['type']=='index_reference'),None)
        if reference:previous[index_key(reference['attrs'])]=paragraph
    fallback={k:v for k,v in next(iter(previous.values()),{}).get('attrs',{}).items() if k!='blockId'}
    title=attrs.get('title','Index')
    legacy=[paragraph for paragraph in node.get('content',[]) if not any(child['type']=='index_reference' for child in paragraph.get('content',[])) and document_text(paragraph)!=title]
    content=[{'type':'paragraph','attrs':{'keepWithNext':True},'content':[{'type':'text','text':title,'marks':[{'type':'strong'}]}]}] if title else []
    for group in groups(sources,attrs.get('indexGroup'),attrs.get('useSortText',True),attrs.get('indexLanguage')):
        prior=previous.get(index_key(group),{})
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
        parts.append({'type':'index_reference','attrs':{'terms':group['terms'],'sortTerms':group.get('sortTerms'),'targetIds':ids,'unresolved':bool((old or {}).get('attrs',{}).get('unresolved'))},'content':[{'type':'text','text':document_text(old) or '—'}] if ids and old else [{'type':'text','text':'—'}] if ids else []})
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
    sorts=attrs.get('sortTerms') or []
    sort_text=':'.join(escape((sorts[index] if index<len(sorts) else '') or term) for index,term in enumerate(attrs['terms']))
    return ' XE "'+':'.join(escape(term) for term in attrs['terms'])+'"'+(' \\f "'+index_group(attrs['indexGroup'])+'"' if attrs.get('indexGroup') else '')+(' \\y "'+sort_text+'"' if any(sorts) else '')+(' \\t "'+escape(attrs['see'])+'"' if attrs.get('see') else '')+(' \\r '+name if attrs.get('rangeId') else '')+' '


def field_tokens(instruction):
    """Read bounded field syntax; never evaluate an instruction."""
    if not isinstance(instruction,str) or len(instruction)>10000:return None
    tokens=[];at=0
    pattern=re.compile(r'\s*(?:"((?:\\.|[^"\\])*)"|([^\s"]+))')
    while at<len(instruction):
        if not instruction[at:].strip():break
        match=pattern.match(instruction,at)
        if not match:return None
        tokens.append((match[1] if match[1] is not None else match[2],match[1] is not None));at=match.end()
    return tokens


def decode_field(value):return re.sub(r'\\(.)',r'\1',value)


def term_levels(raw):
    terms=[''];at=0
    while at<len(raw):
        char=raw[at]
        if char=='\\' and at+1<len(raw):at+=1;terms[-1]+=raw[at]
        elif char==':':terms.append('')
        else:terms[-1]+=char
        at+=1
    return terms


def read_xe(instruction,warnings):
    tokens=field_tokens(instruction)
    if not tokens or len(tokens)<2 or tokens[0][1] or tokens[0][0].upper()!='XE' or not tokens[1][1]:return None
    attrs={'terms':term_levels(tokens[1][0]),'see':None};seen=set();at=2
    while at<len(tokens):
        switch,quoted=tokens[at];switch=switch.lower();at+=1
        if quoted or switch not in ('\\t','\\r','\\f','\\y') or switch in seen or at>=len(tokens):return None
        seen.add(switch);raw=tokens[at][0];value=decode_field(raw);at+=1
        if switch=='\\t':attrs['see']=value
        elif switch=='\\r':
            if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,39}',value):return None
            attrs['rangeId']=value
        elif switch=='\\f':attrs['indexGroup']=index_group(value[:1]) if value else ''
        else:
            sorts=term_levels(raw)
            attrs['sortTerms']=[sort if index>=len(attrs['terms']) or sort!=attrs['terms'][index] else '' for index,sort in enumerate(sorts)]
    try:validate_entry(attrs)
    except ValueError:return None
    from uuid import uuid4
    attrs['blockId']='index_'+uuid4().hex
    return {'type':'index_entry','attrs':attrs}


def index_instruction(attrs):
    validate_group(attrs.get('indexGroup'))
    return ' INDEX \\c "1"'+(' \\f "'+index_group(attrs['indexGroup'])+'"' if attrs.get('indexGroup') else '')+(' \\y' if attrs.get('useSortText',True) else '')+' \\z "'+str(word_language(attrs.get('indexLanguage')))+'" '


def read_index_instruction(instruction):
    tokens=field_tokens(instruction)
    if not tokens or tokens[0][1] or tokens[0][0].upper()!='INDEX':return None
    attrs={'indexGroup':None,'useSortText':False};at=1;seen=set()
    while at<len(tokens):
        switch,quoted=tokens[at];switch=switch.lower();at+=1
        if quoted or switch not in ('\\c','\\f','\\y','\\z') or switch in seen:return None
        seen.add(switch)
        if switch=='\\y':attrs['useSortText']=True;continue
        if at>=len(tokens):return None
        value=decode_field(tokens[at][0]);at+=1
        if switch=='\\c' and value!='1':return None
        if switch=='\\z':
            language=language_from_word(value)
            if language is None:return None
            attrs['indexLanguage']=language
        if switch=='\\f':
            if not value:return None
            attrs['indexGroup']=index_group(value[:1])
    try:validate_group(attrs['indexGroup'])
    except ValueError:return None
    return attrs


def html_entry(attrs):
    import html
    payload={key:attrs[key] for key in ('terms','see','rangeId','indexGroup','sortTerms') if key in attrs}
    if attrs.get('rangeId') and attrs.get('rangeName'):payload['rangeId']=attrs['rangeName']
    return '<span data-index-entry="'+html.escape(json.dumps(payload,ensure_ascii=False),quote=True)+'" data-index-id="'+html.escape(attrs.get('blockId',''),quote=True)+'"></span>'
