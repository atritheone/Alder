"""Frozen semantic input and verified output for the desktop page renderer."""
import base64
import hashlib
import io
import json
import re


def prepare_layout(project, options=None):
    from .stationery import validate_stock
    validate_stock(project)
    from .publishing import _prepare_publication, _settings, _publication_sections, _Resources, _warn, plain_text
    from .models import validate_document
    warnings = []
    options = {**(options or {})}
    options.setdefault('reviewView', 'final')
    if options['reviewView'] == 'markup':
        raise ValueError('Print publication requires the final or original review view.')
    prepared = _prepare_publication(project, options, warnings)
    settings = _settings(prepared, options)
    sections = _publication_sections(prepared, warnings)
    resources = _Resources(prepared, settings, warnings)
    blocks = []
    def paragraph(text, kind='paragraph', attrs=None):
        return {'type': kind, 'attrs': attrs or {}, 'content': [{'type': 'text', 'text': str(text)}]}
    if settings['includeTitle']:
        # Word's Title style is not Heading 1: a title must not become the
        # current chapter in a running STYLEREF heading field.
        blocks.append(paragraph(project.get('name') or 'Untitled', attrs={'fontSize':26,'spaceBefore':0,'spaceAfter':15}))
        if settings.get('author'): blocks.append(paragraph(settings['author']))
    if settings.get('includeToc'):
        blocks.append(paragraph('Contents', 'heading', {'level': 1}))
        blocks.extend(paragraph(s['title']) for s in sections if s['title'])
        blocks.append({'type': 'page_break'})
        _warn(warnings, 'The publication contents option lists chapter titles. Insert a table of contents in Write for heading entries and generated page references.')
    for index, section in enumerate(sections):
        if index and settings.get('chapterPageBreaks'):
            blocks.append({'type': 'page_break'})
        if section['title']: blocks.append(paragraph(section['title'], 'heading', {'level': 1}))
        blocks.extend(section['blocks'])
    def walk(node):
        from .running_matter import stories
        for story in stories(node.get('attrs',{}).get('runningMatter')): walk(story)
        node.get('attrs', {}).pop('_headingLabel', None)
        node.get('attrs', {}).pop('_noteLabel', None)
        node.get('attrs', {}).pop('rangeName', None)
        node.get('attrs', {}).pop('_noteReference', None)
        if node['type']=='document_note':walk(node['attrs']['body'])
        for derived in ('_outlineLabel','_outlineHanging','_outlineIndent'):node.get('attrs',{}).pop(derived,None)
        if node['type'] in ('cross_reference', 'bookmark_end'):
            # Native Word/HTML exporters use derived names. The editing schema
            # keeps stable identities and resolves destination names itself.
            node.get('attrs', {}).pop('targetName', None)
            if node['type'] == 'bookmark_end': node.get('attrs', {}).pop('unresolved', None)
        if node['type'] in ('image', 'inline_image'):
            image = resources.image(node.get('attrs', {}))
            if not image:
                raise ValueError('A publication image is missing or unreadable. Collect or replace the image before printing.')
            data, mime = image['data'], image['mime']
            node['attrs']['src'] = f'data:{mime};base64,' + base64.b64encode(data).decode('ascii')
            node['attrs']['crop'] = None  # The detached raster already contains the crop.
        if 'content' in node:
            if any(child['type'] == 'comment_anchor' for child in node['content']):
                _warn(warnings, 'Review comments are omitted from this publication format; retain the Alder or DOCX document for review.')
            node['content'] = [child for child in node['content'] if child['type'] != 'comment_anchor']
            for child in node['content']: walk(child)
    document = {'type': 'doc', 'content': blocks or [{'type': 'paragraph'}]}
    # Native Word uses a generated bookmark around each note reference. The
    # desktop page renderer resolves directly against the note's stable id.
    from .document_notes import notes
    note_aliases={'note_reference_'+hashlib.sha256(node['attrs']['blockId'].encode()).hexdigest()[:32]:node['attrs']['blockId'] for node in notes([document])}
    def restore_note_targets(node):
        if node['type']=='cross_reference' and node.get('attrs',{}).get('_noteReference'):
            node['attrs']['targetId']=note_aliases.get(node['attrs']['targetId'],node['attrs']['targetId'])
        for child in node.get('content',[]):restore_note_targets(child)
    restore_note_targets(document)
    validate_document(document)
    walk(document)
    from .running_matter import stories
    for story in stories(settings.get('runningMatter')): walk(story)
    # Filesystem-only renderer options never cross into the page or manifest.
    settings.pop('assetRoot', None)
    identity = hashlib.sha256(json.dumps({'document': document, 'settings': settings, 'language': prepared.get('language','en')}, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()
    return {'version': 1, 'projectId': project['id'], 'sourceRevision': project.get('revision', 0), 'sourceIdentity': identity,
            'name': project.get('name') or 'Untitled', 'language':prepared.get('language','en'),'document': document, 'settings': settings, 'styles': prepared.get('styles', []),
            'warnings': warnings, 'text': plain_text(document)}


def validate_rendered_pdf(data, pages, require_tags=False):
    from pypdf import PdfReader
    if not data.startswith(b'%PDF-') or len(data) > 100 * 1024 * 1024:
        raise ValueError('Invalid or oversized rendered PDF.')
    if not isinstance(pages, list) or not pages:
        raise ValueError('The renderer did not provide its page map.')
    try:
        reader = PdfReader(io.BytesIO(data), strict=True)
    except Exception as exc:
        raise ValueError('The renderer did not produce a readable PDF.') from exc
    if len(reader.pages) != len(pages):
        raise ValueError('The PDF page count differs from the document page map.')
    for actual, expected in zip(reader.pages, pages):
        for dimension in ('width', 'height'):
            value = expected.get(dimension) if isinstance(expected, dict) else None
            if type(value) not in (float, int) or not 150 <= value <= 6000:
                raise ValueError('The renderer supplied invalid page geometry.')
            if abs(float(getattr(actual.mediabox, dimension)) - value * .75) > 1:
                raise ValueError('The PDF page geometry differs from the document page map.')
    root=reader.trailer['/Root']
    mark_info=root.get('/MarkInfo')
    marked=mark_info.get_object().get('/Marked') if mark_info else None
    tagged=bool(root.get('/StructTreeRoot') and getattr(marked,'value',marked) is True)
    language=str(root.get('/Lang') or '')
    title=str((reader.metadata or {}).get('/Title') or '')
    if require_tags and (not tagged or not language or not title):
        raise ValueError('The renderer did not retain PDF tags, document language and title.')
    # This reports structural presence, not PDF/UA conformance. Reading order and
    # semantic associations are qualified against exported fixtures separately.
    return {'status': 'passed', 'format': 'pdf', 'pages': len(pages), 'layoutEngine': 'alder-page-map',
            'tagged':tagged,'language':language,'documentTitle':title}


def output_name(name):
    stem = re.sub(r'[^\w .-]', '', str(name)).strip(' .')[:80] or 'Untitled'
    if stem.split('.', 1)[0].upper() in {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}:
        stem = 'Alder-' + stem
    return stem + '.pdf'
