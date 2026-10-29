"""Heading-based generated contents. Refresh detached publications and explicit edits."""
import copy
import re


def validate_contents(attrs):
    if attrs.get('kind','headings') not in ('headings','figures','tables'):
        raise ValueError('Unsupported contents type.')
    if attrs.get('pageNumbers') is not None and type(attrs['pageNumbers']) is not bool:
        raise ValueError('Contents page numbers must be on or off.')
    if not isinstance(attrs.get('title', 'Contents'), str) or len(attrs.get('title', 'Contents')) > 200:
        raise ValueError('The contents title must be at most 200 characters.')
    if type(attrs.get('depth', 3)) is not int or not 1 <= attrs.get('depth', 3) <= 6:
        raise ValueError('Contents must include between one and six heading levels.')
    if attrs.get('entryStyle') is not None and (not isinstance(attrs['entryStyle'], str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', attrs['entryStyle'])):
        raise ValueError('Invalid contents entry style.')


def refresh_contents(documents, styles=None):
    from .document_references import reference_values
    from .document_captions import number_captions
    number_captions(documents)
    values = reference_values(documents)
    headings = []
    def collect(node):
        if node['type'] == 'table_of_contents': return
        if node['type'] == 'heading' or node.get('attrs',{}).get('captionLabel'): headings.append(node)
        for child in node.get('content', []): collect(child)
    for document in documents: collect(document)
    def field(target, text, format='text'):
        return {'type':'cross_reference', 'attrs':{'targetId':target, 'referenceFormat':format}, 'content':[{'type':'text','text':text}]}
    def refresh(node):
        if node['type'] == 'table_of_contents':
            attrs = node.get('attrs', {}); validate_contents(attrs)
            previous = {}
            for entry in node.get('content', []):
                target = next((c['attrs']['targetId'] for c in entry.get('content', []) if c['type'] == 'cross_reference'), None)
                if target: previous[target] = entry
            title = attrs.get('title', 'Contents')
            fallback = {k:v for k,v in next(iter(previous.values()),{}).get('attrs',{}).items() if k != 'blockId'}
            content = [{'type':'paragraph', 'attrs':{'keepWithNext':True}, 'content':[{'type':'text','text':title,'marks':[{'type':'strong'}]}]}] if title else []
            for heading in headings:
                ha = heading.get('attrs', {}); level = ha.get('level', 1); identifier = ha.get('blockId')
                kind=attrs.get('kind','headings')
                if kind == 'headings':
                    if heading['type'] != 'heading': continue
                else:
                    if ha.get('captionLabel') != ('Figure' if kind == 'figures' else 'Table'): continue
                    level=1
                text = values.get(identifier)
                if level > attrs.get('depth', 3) or not text: continue
                number = values.get((identifier,'number')) if kind == 'headings' else None
                style = (styles or {}).get(attrs.get('entryStyle'), {})
                pa = {**copy.deepcopy(previous.get(identifier, {}).get('attrs', fallback)), **{k:v for k,v in style.items() if k not in ('id','name','kind','basedOn','nextStyle')},
                      'styleId':attrs.get('entryStyle'), 'leftIndent':(level-1)*12, 'keepWithNext':False, 'headingNumbered':False}
                from .models import document_text
                page = next((document_text(c) for c in previous.get(identifier,{}).get('content',[]) if c['type']=='cross_reference' and c['attrs'].get('referenceFormat')=='page'),'—')
                parts = ([field(identifier,number,'number'),{'type':'text','text':' '}] if number else [])+[field(identifier,text)]
                if attrs.get('pageNumbers',True): parts.extend([{'type':'text','text':'\t'},field(identifier,page,'page')])
                content.append({'type':'paragraph', 'attrs':pa, 'content':parts})
            if len(content) == (1 if title else 0): content.append({'type':'paragraph','content':[{'type':'text','text':{'headings':'No headings available.','figures':'No figure captions available.','tables':'No table captions available.'}[attrs.get('kind','headings')]}]})
            node['content'] = content
            return
        for child in node.get('content', []): refresh(child)
    for document in documents: refresh(document)
