"""Separate, linked header/footer stories; body text never includes running matter."""
import copy
import math

PARTS = ('header', 'footer')
VARIANTS = ('default', 'first', 'even')
NODES = {'doc', 'paragraph', 'text', 'hard_break', 'document_field', 'table', 'table_row', 'table_cell', 'table_header', 'image', 'inline_image'}
MARKS = {'strong', 'em', 'underline', 'strike', 'subscript', 'superscript', 'text_style', 'link', 'highlight'}


def stories(value):
    for part in PARTS:
        for document in (value or {}).get(part, {}).values():
            if document is not None:
                yield document


def validate_running_matter(value, section=False):
    from .models import validate_document
    if value is None:
        return
    allowed = {*PARTS, 'differentFirst', 'headerDistanceMm', 'footerDistanceMm'}
    if not section:
        allowed.add('differentEven')
    if not isinstance(value, dict) or set(value) - allowed:
        raise ValueError('Invalid header/footer settings.')
    for key in ('differentFirst', 'differentEven'):
        if key in value and type(value[key]) is not bool:
            raise ValueError('Header/footer page variants must be on or off.')
    for key in ('headerDistanceMm', 'footerDistanceMm'):
        if key in value:
            number = value[key]
            if type(number) not in (int, float) or not math.isfinite(number) or not 0 <= number <= 100:
                raise ValueError('Header/footer distances must be between 0 and 100 mm.')
    for part in PARTS:
        if part not in value:
            continue
        if not isinstance(value[part], dict) or set(value[part]) - set(VARIANTS):
            raise ValueError('Invalid header/footer page variant.')
    def check(node):
        if node['type'] not in NODES or any(mark['type'] not in MARKS for mark in node.get('marks', [])):
            raise ValueError('Headers and footers support formatted paragraphs, tables, images, links and document fields.')
        if node.get('attrs', {}).get('revisionProperties') or node.get('attrs', {}).get('captionLabel'):
            raise ValueError('Review changes and captions belong to the document body.')
        if node.get('type') in ('image', 'inline_image') and node.get('attrs', {}).get('wrap', 'none') != 'none':
            raise ValueError('Pictures in headers and footers use inline or standalone placement.')
        for child in node.get('content', []):
            check(child)
    for document in stories(value):
        validate_document(document)
        if document.get('type') != 'doc':
            raise ValueError('A header/footer requires a document.')
        check(document)


def legacy_running_matter(settings):
    def text(value):
        return {'type':'doc', 'content':[{'type':'paragraph', 'content':[{'type':'text','text':value}]}]}
    return {'header':{'default':text(settings['header']) if settings.get('header') else None},
            'footer':{'default':{'type':'doc','content':[{'type':'paragraph','attrs':{'align':'center'},'content':[{'type':'document_field','attrs':{'fieldKind':'page'},'content':[{'type':'text','text':'1'}]}]}]} if settings.get('footer',True) else None},
            'differentFirst':False, 'differentEven':False, 'headerDistanceMm':10, 'footerDistanceMm':10}


def resolve_running_matter(previous, local):
    result = copy.deepcopy(previous)
    for key, value in (local or {}).items():
        if key in PARTS:
            result.setdefault(key, {}).update(copy.deepcopy(value))
        else:
            result[key] = value
    return result


def project_running_stories(project):
    yield from stories(project.get('settings', {}).get('runningMatter'))
    def walk(node):
        if node.get('type') == 'section_break':
            yield from stories(node.get('attrs', {}).get('runningMatter'))
        for child in node.get('content', []):
            yield from walk(child)
    for chapter in project.get('book', {}).get('chapters', []):
        yield from walk(chapter['document'])
    for clip in project.get('clips', []):
        for item in [clip,*clip.get('variants', [])]:
            yield from walk(item['document'])
    for placement in project.get('placements', []):
        if placement.get('frozenDocument'): yield from walk(placement['frozenDocument'])


def portable_story(value, resources=None):
    """Publication preparation has resolved styles; don't leak dangling IDs."""
    value=copy.deepcopy(value)
    def clean(node):
        if resources is not None and node['type'] in ('image','inline_image'):
            import base64
            image=resources.image(node.get('attrs',{}),apply_crop=False)
            if not image: raise ValueError('A document story image is missing. Collect or replace it before exporting.')
            node['attrs']['src']='data:'+image['mime']+';base64,'+base64.b64encode(image['data']).decode('ascii')
            node['attrs'].pop('assetId',None)
        node.get('attrs',{}).pop('styleId',None)
        for mark in node.get('marks',[]): mark.get('attrs',{}).pop('styleId',None)
        for child in node.get('content',[]): clean(child)
    clean(value)
    return value


def portable_matter(value, resources=None):
    value=copy.deepcopy(value)
    for doc in stories(value):
        portable=portable_story(doc,resources);doc.clear();doc.update(portable)
    return value


def html_metadata(settings, resources=None):
    import html
    import json
    value=portable_matter(settings.get('runningMatter'),resources)
    return '<meta name="alder-running-matter" content="'+html.escape(json.dumps(value,ensure_ascii=False),quote=True)+'"/>' if value is not None else ''


def collect_story_images(value, assets, warnings):
    from .publishing import _Resources, _asset_from_bytes
    def walk(node, depth=0):
        if depth>60: raise ValueError('Document story nesting is too deep.')
        attrs=node.get('attrs',{})
        if node.get('type') in ('image','inline_image') and str(attrs.get('src','')).startswith('data:image/'):
            probe=_Resources({'assets':[]},{},warnings).image(attrs,apply_crop=False)
            if not probe: raise ValueError('An embedded document story image is unreadable.')
            asset_id=_asset_from_bytes(probe['data'],attrs.get('alt') or 'Story image',assets,warnings)
            attrs.update(assetId=asset_id,src='asset:'+asset_id)
        for child in node.get('content',[]): walk(child,depth+1)
    walk(value)
    return value


def collect_portable_images(value, assets, warnings):
    for story in stories(value):collect_story_images(story,assets,warnings)
    return value


def read_html_metadata(text, assets=None, warnings=None):
    import json
    from bs4 import BeautifulSoup
    head=BeautifulSoup(text,'html.parser').head
    entry=head.find('meta',attrs={'name':'alder-running-matter'}) if head else None
    if entry is None:return None
    value=json.loads(entry.get('content','null'))
    if assets is not None: collect_portable_images(value,assets,warnings if warnings is not None else [])
    validate_running_matter(value)
    return value


def with_story_defaults(story):
    value=copy.deepcopy(story)
    def defaults(item):
        if item.get('type')=='paragraph':
            item['attrs']={'fontSize':9,'lineHeight':1.2,'spaceBefore':0,'spaceAfter':0,**{k:v for k,v in item.get('attrs',{}).items() if v is not None}}
        for child in item.get('content',[]):defaults(child)
    defaults(value)
    return value


def write_running_matter(section, value, block, document, first=False):
    """Absent variants link to previous; explicit null creates an empty story."""
    from docx.shared import Mm
    if first:
        document.settings.odd_and_even_pages_header_footer = value.get('differentEven',False)
    if 'differentFirst' in value:
        section.different_first_page_header_footer = value['differentFirst']
    for part in PARTS:
        distance = value.get(part+'DistanceMm')
        if distance is not None:
            setattr(section, part+'_distance', Mm(distance))
        for variant, story in value.get(part, {}).items():
            name = {'default':part, 'first':'first_page_'+part, 'even':'even_page_'+part}[variant]
            target = getattr(section,name)
            target.is_linked_to_previous = False
            for child in list(target._element):
                target._element.remove(child)
            for node in (story or {}).get('content',[]):
                # Running text defaults to nine points and single spacing.
                block(target,with_story_defaults(node))
            if not list(target._element) or list(target._element)[-1].tag.rsplit('}',1)[-1]!='p':
                target.add_paragraph()


def read_running_matter(section, paragraph, warnings, first=False, container=None):
    result={'differentFirst':section.different_first_page_header_footer}
    if first:
        result['differentEven']=section._document_part.settings.odd_and_even_pages_header_footer
    for part in PARTS:
        distance=getattr(section,part+'_distance')
        result[part+'DistanceMm']=distance.mm if distance is not None else 10
        variants={}
        for variant,name in (('default',part),('first','first_page_'+part),('even','even_page_'+part)):
            target=getattr(section,name)
            if target.is_linked_to_previous:
                if first: variants[variant]=None
                continue
            content=container(target) if container is not None else [paragraph(p) for p in target.paragraphs]
            # Unsupported material cannot masquerade as a fully preserved story.
            from .models import document_text
            document={'type':'doc','content':content or [{'type':'paragraph'}]}
            try:
                validate_running_matter({part:{variant:document}})
                if target.tables and container is None:
                    raise ValueError('Table layout in running matter is unsupported.')
            except ValueError:
                extra='\n'.join(cell.text for table in target.tables for row in table.rows for cell in row.cells)
                text='\n'.join(t for t in (document_text(document),extra) if t)
                document={'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':text}]}] if text else [{'type':'paragraph'}]}
                warnings.append('Complex DOCX header/footer content was converted to plain paragraphs. Retain the original for its layout and objects.')
            variants[variant]=document
        if variants:
            result[part]=variants
    return result
