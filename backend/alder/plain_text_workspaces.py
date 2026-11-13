"""Explicit plain copies retain the complete source workspace unchanged."""
from .models import create_project, document_text, text_document, uid, validate_project


def plain_copy(store, project_id):
    source = store.get(project_id)
    chapters = source.get('book', {}).get('chapters', [])
    text = '\n\n'.join(document_text(c['document']) for c in chapters)
    project = create_project((source['name'] + ' - plain text')[:300], 'blank')
    project['clips'], project['placements'], project['assets'] = [], [], []
    project['book'] = {'version': 1, 'chapters': [{'id': uid('chapter_'), 'title': 'Text', 'role': 'chapter',
        'include': True, 'voiceId': None, 'document': text_document(text)}]}
    project['settings'].update(documentKind='txt', preferredFormat='txt', includeTitle=False, footer=False)
    project['plainCopyOf'] = source['id']
    return store.insert(validate_project(project))


def reopen_text(store, project_id, raw, encoding):
    from .plain_text_file import decode_file
    source = store.get(project_id)
    if source.get('settings', {}).get('documentKind') != 'txt':
        raise ValueError('Choose a TXT document.')
    if len(raw) > 30_000_000:
        raise ValueError('TXT reopening currently supports files up to 30 MB.')
    text, metadata = decode_file(raw, encoding)
    project = create_project((source['name'] + ' - reopened')[:300], 'blank')
    project['clips'], project['placements'], project['assets'] = [], [], []
    project['book'] = {'version': 1, 'chapters': [{'id': uid('chapter_'), 'title': 'Text', 'role': 'chapter',
        'include': True, 'voiceId': None, 'document': text_document(text)}]}
    project['settings'].update(source.get('settings', {}))
    project['settings'].update(documentKind='txt', preferredFormat='txt', textFile=metadata)
    project['reopenedFrom'] = source['id']
    return store.insert(validate_project(project))
