"""Bounded local document properties and a deliberately formatted current date."""
from datetime import date
import re

FIELD_LABELS = {'date':'Current date','title':'Document title','author':'Author','subject':'Subject','page':'Page number','pageCount':'Total pages'}
FIELD_LABELS.update({f'heading{level}':f'Heading {level}' for level in range(1,7)})
FIELD_LABELS['merge']='Merge field'


def validate_merge_key(value):
    if not isinstance(value,str) or not re.fullmatch(r'[\w .-]{1,100}',value,re.UNICODE) or value!=value.strip():
        raise ValueError('Name the merge field using 1-100 letters, numbers, spaces, dots, underscores or hyphens.')
    return value


def read_merge_key(instruction):
    match=re.fullmatch(r'MERGEFIELD\s+(?:"([^"\\]+)"|([\w.-]+))(?:\s+\\\*\s+(?:CHARFORMAT|MERGEFORMAT))?\s*',instruction,re.I)
    if not match:return None
    try:return validate_merge_key(match[1] or match[2])
    except ValueError:return None


def is_heading_field(kind):
    return isinstance(kind,str) and re.fullmatch(r'heading[1-6]',kind) is not None

def field_values(project, today=None):
    def text(value): return re.sub(r'\s+', ' ', value).strip()[:10000] if isinstance(value,str) else ''
    settings = project.get('settings',{})
    return {'date':(today or date.today()).isoformat(),'title':text(project.get('name')),
            'author':text(settings.get('author')),'subject':text(settings.get('subject'))}

def refresh_fields(documents, project, warnings, today=None):
    values = field_values(project,today)
    def walk(node):
        if node['type'] == 'document_field':
            attrs = node['attrs']; kind = attrs['fieldKind']
            if kind in ('page','pageCount','merge') or is_heading_field(kind): return  # Layout/data-dependent, never document metadata.
            value = values[kind]
            attrs['unresolved'] = not bool(value)
            node['content'] = [{'type':'text','text':value or f'[{FIELD_LABELS[kind]} not set]'}]
            if not value:
                message = f'A {FIELD_LABELS[kind].lower()} field has no value. Its visible placeholder is retained.'
                if message not in warnings: warnings.append(message)
        for child in node.get('content',[]): walk(child)
    for document in documents: walk(document)

def field_instruction(kind, heading_styles=None, merge_key=None):
    if kind=='merge':return ' MERGEFIELD "'+validate_merge_key(merge_key)+'" \\* CHARFORMAT '
    if is_heading_field(kind):
        target = (heading_styles or {}).get(kind, kind[-1])
        return ' STYLEREF ' + (target if target.isdigit() else '"'+target+'"') + ' \\* CHARFORMAT '
    if kind in ('page','pageCount'): return (' PAGE ' if kind=='page' else ' NUMPAGES ') + '\\* CHARFORMAT '
    return ' DATE \\@ "yyyy-MM-dd" \\* CHARFORMAT ' if kind == 'date' else ' DOCPROPERTY ' + kind.title() + ' \\* CHARFORMAT '

def read_field(instruction, heading_styles=None):
    if read_merge_key(instruction) is not None:return 'merge'
    heading = re.fullmatch(r'STYLEREF\s+(?:([1-6])|"Heading ([1-6])")(?:\s+\\\*\s+(?:CHARFORMAT|MERGEFORMAT))?\s*', instruction, re.I)
    if heading:
        level=heading[1] or heading[2]
        return 'heading'+level if heading_styles is None else heading_styles.get(level)
    named = re.fullmatch(r'STYLEREF\s+"([^"\\]+)"(?:\s+\\\*\s+(?:CHARFORMAT|MERGEFORMAT))?\s*', instruction, re.I)
    if named: return (heading_styles or {}).get(named[1].casefold())
    page = re.fullmatch(r'(PAGE|NUMPAGES)(?:\s+\\\*\s+(?:CHARFORMAT|MERGEFORMAT))?\s*',instruction,re.I)
    if page: return 'page' if page[1].upper()=='PAGE' else 'pageCount'
    if re.fullmatch(r'DATE\s+\\@\s+"yyyy-MM-dd"(?:\s+\\\*\s+(?:CHARFORMAT|MERGEFORMAT))?\s*',instruction,re.I): return 'date'
    match = re.fullmatch(r'DOCPROPERTY\s+"?(Title|Author|Subject)"?(?:\s+\\\*\s+(?:CHARFORMAT|MERGEFORMAT))?\s*',instruction,re.I)
    return match[1].lower() if match else None
