"""Local CSV mail merge. Values are literal text, never code or field instructions."""
import csv
import hashlib
import io
import json
from copy import deepcopy

from .models import ValidationError, create_project, validate_project, uid
from .store import ConflictError


def read_csv(text, delimiter=','):
    if not isinstance(text,str) or len(text.encode('utf-8')) > 5*1024*1024:
        raise ValidationError('Choose a CSV file no larger than 5 MB.')
    if delimiter not in (',',';', '\t'):
        raise ValidationError('Choose comma, semicolon or tab separation.')
    if '\x00' in text:
        raise ValidationError('The CSV contains invalid text. Save it as UTF-8 CSV.')
    try:
        source=csv.reader(io.StringIO(text.lstrip('\ufeff'),newline=''),delimiter=delimiter,strict=True)
        headers=next(source,[])
        if not 1<=len(headers)<=100 or any(not value.strip() or len(value)>100 for value in headers):
            raise ValidationError('The first CSV row needs 1-100 nonempty column names, each at most 100 characters.')
        if len(set(headers))!=len(headers):
            raise ValidationError('CSV column names must be unique.')
        rows=[]
        for row in source:
            if not row:continue
            if len(row)!=len(headers):
                raise ValidationError(f'CSV record {len(rows)+1} has {len(row)} values; expected {len(headers)}.')
            if any(len(value)>10000 for value in row):raise ValidationError('A CSV value exceeds 10000 characters.')
            rows.append(row)
            if len(rows)>10000:raise ValidationError('Choose a CSV with at most 10000 records.')
        if not rows:raise ValidationError('The CSV has column names but no records.')
        return {'headers':headers,'rows':rows}
    except csv.Error as error:
        raise ValidationError('The CSV could not be read. Check its quoting and column separator.') from error


def walk(value):
    if isinstance(value,dict):
        yield value
        for child in value.values():yield from walk(child)
    elif isinstance(value,list):
        for child in value:yield from walk(child)


def merge_keys(value):
    return sorted({node['attrs']['mergeKey'] for node in walk(value) if node.get('type')=='document_field' and node.get('attrs',{}).get('fieldKind')=='merge'})


def resolved(value, values):
    if isinstance(value,list):return [resolved(child,values) for child in value]
    if not isinstance(value,dict):return value
    if value.get('type')=='document_field' and value.get('attrs',{}).get('fieldKind')=='merge':
        # The parent flattens this temporary result to marked text and line breaks.
        text=values[value['attrs']['mergeKey']].replace('\r\n','\n').replace('\r','\n')
        content=[]
        for i,line in enumerate(text.split('\n')):
            if i:content.append({'type':'hard_break'})
            if line:content.append({'type':'text','text':line,'marks':deepcopy(value.get('marks',[]))})
        return {'_mergedRuns':content}
    result={key:resolved(child,values) for key,child in value.items()}
    if isinstance(result.get('content'),list):
        result['content']=[part for child in result['content'] for part in (child['_mergedRuns'] if '_mergedRuns' in child else [child])]
    return result


def create_documents(store, project_id, request):
    rows=request.get('rows');mapping=request.get('mapping');numbers=request.get('records')
    if not isinstance(rows,list) or not 1<=len(rows)<=100:
        raise ValidationError('Select between 1 and 100 records per merge.')
    if not isinstance(numbers,list) or len(numbers)!=len(rows) or any(type(n) is not int or not 1<=n<=10000 for n in numbers) or len(set(numbers))!=len(numbers):
        raise ValidationError('Select distinct CSV records.')
    if not isinstance(mapping,dict) or any(not isinstance(k,str) or not isinstance(v,str) for k,v in mapping.items()):
        raise ValidationError('Map every merge field to a CSV column.')
    for row in rows:
        if not isinstance(row,dict) or len(row)>100 or any(not isinstance(k,str) or not isinstance(v,str) or len(v)>10000 or any(ord(c)<32 and c not in '\t\r\n' for c in v) for k,v in row.items()):
            raise ValidationError('The selected CSV records contain invalid or excessive text.')
    if len(json.dumps(rows,ensure_ascii=False).encode('utf-8'))>5*1024*1024:
        raise ValidationError('The selected records exceed 5 MB. Merge a smaller group.')
    with store._lock:
        original=store.get(project_id)
        if type(request.get('expectedRevision')) is not int or request['expectedRevision']!=original['revision']:
            raise ConflictError('The template changed. Open Mail merge again before creating documents.')
        if not original.get('book'):raise ValidationError('Mail merge needs a Write document.')
        template=create_project(original['name'],'blank')
        for key in ('book','settings','styles','language','dictionary','pronunciation'):
            if key in original:template[key]=deepcopy(original[key])
        template['book']['chapters']=[c for c in template['book']['chapters'] if c.get('include',True)]
        if not template['book']['chapters']:raise ValidationError('Include at least one chapter before merging.')
        for chapter in template['book']['chapters']:
            for key in ('rawSource','rawFormat'):chapter.pop(key,None)
        template['settings'].update(documentKind=original['settings'].get('documentKind') if original['settings'].get('documentKind')=='book' else 'docx',preferredFormat='docx')
        keys=merge_keys({'book':template['book'],'settings':template['settings']})
        if not keys:raise ValidationError('Insert at least one merge field in the document first.')
        if set(keys)!=set(mapping) or any(mapping[key] not in row for key in keys for row in rows):
            raise ValidationError('Map every merge field to an available CSV column.')
        for node in walk(template):
            if node.get('type') in ('revision_insertion','revision_deletion','revision_break') or node.get('status')=='pending':
                raise ValidationError('Review pending tracked changes before merging this template.')
        used={n.get('attrs',{}).get('assetId') for n in walk(template) if n.get('type') in ('image','inline_image')}
        used.add(template['settings'].get('coverAssetId'))
        template['assets']=[deepcopy(a) for a in original['assets'] if a['id'] in used]
        images=[]
        for asset in template['assets']:
            path,_=store.asset_path(project_id,asset['id']);data=path.read_bytes()
            if hashlib.sha256(data).hexdigest()!=asset['path'].split('.')[0]:raise ValidationError('A template picture failed its integrity check.')
            images.append((asset['path'],data))
        if sum(len(data) for _,data in images)*len(rows)>256*1024*1024:
            raise ValidationError('These documents would copy more than 256 MB of pictures. Merge fewer records at once.')
        copies=[];size=0
        for number,row in zip(numbers,rows):
            document=resolved(deepcopy(template),{key:row[mapping[key]] for key in keys})
            document['id']=uid('project_');document['name']=original['name'][:170]+' - '+str(number)
            identities={}
            for node in walk(document):
                for key in ('id','blockId','threadId'):
                    if isinstance(node.get(key),str):identities.setdefault(node[key],uid('merge_'))
            identities[document['id']]=document['id']
            for node in walk(document):
                for key,item in list(node.items()):
                    if isinstance(item,str) and (key=='id' or key.endswith('Id') or key in ('basedOn','nextStyle')):node[key]=identities.get(item,item)
                    elif key=='href' and isinstance(item,str) and item.startswith('#'):node[key]='#'+identities.get(item[1:],item[1:])
                    elif isinstance(item,list) and key.endswith('Ids'):node[key]=[identities.get(v,v) if isinstance(v,str) else v for v in item]
                    elif key=='src' and isinstance(item,str) and item.startswith('asset:'):node[key]='asset:'+identities.get(item[6:],item[6:])
            for node in walk(document):
                if node.get('type') in ('image','inline_image') and node.get('attrs',{}).get('assetId'):
                    node['attrs']['src']=f"/api/projects/{document['id']}/assets/{node['attrs']['assetId']}"
            from .document_fields import refresh_fields
            from .document_references import reference_values
            stories=[node for node in walk(document['book']) if node.get('type')=='doc']
            stories += [node for node in walk(document['settings']) if node.get('type')=='doc']
            refresh_fields(stories,document,[])
            targets=reference_values([chapter['document'] for chapter in document['book']['chapters']])
            for node in walk(document['book']):
                if node.get('type')=='cross_reference' and node['attrs'].get('referenceFormat','text')=='text':
                    value=targets.get(node['attrs']['targetId']);node['attrs']['unresolved']=not bool(value)
                    if value:node['content']=[{'type':'text','text':value}]
            document=validate_project(document);size+=len(json.dumps(document,ensure_ascii=False).encode('utf-8'))
            if size>64*1024*1024:raise ValidationError('The merged documents exceed 64 MB. Merge fewer records at once.')
            copies.append(document)
        for document in copies:
            for filename,data in images:store._atomic_bytes(store.asset_dir(document['id'])/filename,data)
        saved=store.insert_many(copies)
        return {'projects':[{'id':p['id'],'name':p['name']} for p in saved]}
