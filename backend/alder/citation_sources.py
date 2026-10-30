"""Local CSL-JSON library and bounded, portable citation metadata."""
from copy import deepcopy
import json
import math
import re
from .models import ValidationError, uid, now
from .store import ConflictError

SOURCE_TYPES = set('article article-journal article-magazine article-newspaper bill book broadcast chapter classic collection dataset document entry entry-dictionary entry-encyclopedia event figure graphic hearing interview legal_case legislation manuscript map motion_picture musical_score pamphlet paper-conference patent performance periodical personal_communication post post-weblog regulation report review review-book software song speech standard thesis treaty webpage'.split())
LOCATORS = {'page', 'chapter', 'section', 'paragraph', 'volume', 'issue', 'figure', 'table'}

def validate_source(source):
    count = 0
    def walk(value, depth):
        nonlocal count
        count += 1
        if count > 4000 or depth > 8: raise ValidationError('Source metadata is too large or deeply nested.')
        if value is None or type(value) is bool: return
        if type(value) in (int, float):
            if not math.isfinite(value): raise ValidationError('Invalid source number.')
            return
        if isinstance(value, str):
            if len(value) > 10000 or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', value): raise ValidationError('Invalid source text.')
            return
        if isinstance(value, list) and len(value) <= 500:
            for child in value: walk(child, depth + 1)
            return
        if isinstance(value, dict):
            for key, child in value.items():
                if not isinstance(key, str) or len(key) > 100 or key in ('__proto__', 'constructor', 'prototype'): raise ValidationError('Invalid source metadata key.')
                walk(child, depth + 1)
            return
        raise ValidationError('Invalid source metadata.')
    if not isinstance(source, dict) or not isinstance(source.get('id'), str) or not 1 <= len(source['id']) <= 128 or not isinstance(source.get('type'),str) or source['type'] not in SOURCE_TYPES:
        raise ValidationError('A source needs a CSL-JSON id and supported type.')
    walk(source, 0)
    for key in ('title','container-title','publisher','publisher-place','URL','DOI','ISBN','ISSN','language'):
        if source.get(key) is not None and not isinstance(source[key],str): raise ValidationError('Source '+key+' must be text.')
    for key in ('author','editor','translator','collection-editor','compiler','original-author','interviewer','recipient','container-author','director','illustrator','composer','editorial-director','reviewed-author'):
        if source.get(key) is None: continue
        if not isinstance(source[key],list) or any(not isinstance(name,dict) or any(not isinstance(value,str) if field not in ('comma-suffix','static-ordering','parse-names') else type(value) is not bool for field,value in name.items()) for name in source[key]):
            raise ValidationError('Source names must use CSL-JSON name objects.')
    for key in ('issued','accessed','available-date','event-date','original-date','submitted'):
        if source.get(key) is None: continue
        date=source[key]
        if not isinstance(date,dict):raise ValidationError('Source dates must use CSL-JSON date objects.')
        if date.get('date-parts') is not None:
            parts=date['date-parts']
            if not isinstance(parts,list) or len(parts)>2 or any(not isinstance(part,list) or not 1<=len(part)<=3 or any(type(number) is not int or abs(number)>9999 for number in part) for part in parts):raise ValidationError('Invalid source date parts.')
    if len(json.dumps(source, ensure_ascii=False, separators=(',', ':'))) > 64000: raise ValidationError('Source metadata exceeds 64000 characters.')
    return source

def validate_citation(attrs):
    items = attrs.get('items')
    if not isinstance(items, list) or not 1 <= len(items) <= 100: raise ValidationError('A citation needs 1–100 sources.')
    for item in items:
        if not isinstance(item, dict) or set(item) - {'source', 'locator', 'label', 'prefix', 'suffix', 'suppressAuthor'}: raise ValidationError('Invalid citation item.')
        validate_source(item.get('source'))
        for key in ('locator', 'prefix', 'suffix'):
            if item.get(key) is not None and (not isinstance(item[key], str) or len(item[key]) > 1000): raise ValidationError('Invalid citation locator or surrounding text.')
        if item.get('label') is not None and item['label'] not in LOCATORS: raise ValidationError('Unsupported citation locator label.')
        if item.get('suppressAuthor') is not None and type(item['suppressAuthor']) is not bool: raise ValidationError('Invalid author suppression.')

class CitationSources:
    def __init__(self, store): self.store = store
    @staticmethod
    def key(identity):
        if not isinstance(identity, str) or not re.fullmatch(r'source_[a-f0-9]{32}', identity): raise ValidationError('Invalid library source identity.')
        return 'citation-source:' + identity
    def list(self):
        with self.store.connection() as conn:
            values = [json.loads(row[0]) for row in conn.execute("SELECT value FROM metadata WHERE key LIKE 'citation-source:%'")]
        return sorted((v for v in values if not v.get('removed')), key=lambda v: (str(v['source'].get('title', '')).casefold(), v['source']['id']))
    def save(self, source, revision=None):
        source = deepcopy(validate_source(source)); identity = source['id']; key = self.key(identity)
        with self.store._lock, self.store.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row = conn.execute('SELECT value FROM metadata WHERE key=?', (key,)).fetchone()
            existing = json.loads(row[0]) if row else None
            if (existing and revision != existing['revision']) or (not existing and revision not in (None, 0)):
                raise ConflictError('This library source changed. Reopen Sources before saving it.')
            value = {'source': source, 'revision': (existing['revision'] if existing else 0) + 1, 'updatedAt': now()}
            conn.execute('INSERT OR REPLACE INTO metadata VALUES (?,?)', (key, json.dumps(value, ensure_ascii=False)))
            conn.commit()
        return value
    def remove(self, identity, revision):
        key = self.key(identity)
        with self.store._lock, self.store.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row = conn.execute('SELECT value FROM metadata WHERE key=?', (key,)).fetchone()
            if not row: raise KeyError('The source no longer exists.')
            value = json.loads(row[0])
            if revision != value['revision']: raise ConflictError('This library source changed. Reopen Sources before removing it.')
            value.update(removed=True, revision=value['revision'] + 1)
            conn.execute('UPDATE metadata SET value=? WHERE key=?', (json.dumps(value, ensure_ascii=False), key)); conn.commit()
        return value
    def import_items(self, items):
        if not isinstance(items, list) or not 1 <= len(items) <= 10000: raise ValidationError('Import a CSL-JSON array containing 1–10000 sources.')
        # Validate the whole import before writing any record; duplicates are
        # compared without transport ids so repeated imports remain idempotent.
        for item in items: validate_source(item)
        signature = lambda item: json.dumps({k:v for k,v in item.items() if k != 'id'}, sort_keys=True, ensure_ascii=False)
        with self.store._lock, self.store.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            known = {signature(v['source']):v for v in self.list()}
            added = []
            for item in items:
                key = signature(item)
                if key in known: continue
                source = {**deepcopy(item), 'id':uid('source_')}
                value = {'source':source, 'revision':1, 'updatedAt':now()}
                conn.execute('INSERT INTO metadata VALUES (?,?)', (self.key(source['id']), json.dumps(value, ensure_ascii=False)))
                known[key] = value; added.append(value)
            conn.commit()
        return {'added':len(added), 'duplicates':len(items)-len(added), 'sources':self.list()}
