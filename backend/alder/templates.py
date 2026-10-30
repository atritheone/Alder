"""Local, collected document templates. Creating a document never edits its template."""
from copy import deepcopy
import hashlib
import json
import re
from .models import create_project, validate_project, ValidationError, uid, now
from .store import ConflictError


def relocate_raw_images(project, previous_id, next_id, identities=None):
    identities = identities or {}
    for chapter in project.get('book', {}).get('chapters', []):
        source = chapter.get('rawSource')
        if not source or not isinstance(source.get('text'), str):
            continue
        for asset in project.get('assets', []):
            previous_asset = asset['id']
            source['text'] = source['text'].replace(
                f'/api/projects/{previous_id}/assets/{previous_asset}',
                f'/api/projects/{next_id}/assets/{identities.get(previous_asset, previous_asset)}')
            source['text'] = source['text'].replace(f'asset:{previous_asset}', f'asset:{identities.get(previous_asset, previous_asset)}')


class Templates:
    def __init__(self, store):
        self.store = store
        self.assets = store.data_dir / 'templates' / 'assets'

    @staticmethod
    def key(identity):
        if not isinstance(identity, str) or not re.fullmatch(r'template_[a-f0-9]{32}', identity):
            raise ValidationError('Invalid template identity.')
        return 'document-template:' + identity

    @staticmethod
    def summary(value):
        return {key: value[key] for key in ('id', 'name', 'kind', 'createdAt', 'content')}

    def list(self):
        with self.store.connection() as conn:
            values = [json.loads(row[0]) for row in conn.execute("SELECT value FROM metadata WHERE key LIKE 'document-template-summary:%'")]
        return [self.summary(value) for value in sorted(values, key=lambda v: (v['name'].casefold(), v['id'])) if not value.get('removed')]

    def get(self, identity, *, removed=False):
        with self.store.connection() as conn:
            row = conn.execute('SELECT value FROM metadata WHERE key=?', (self.key(identity),)).fetchone()
        if row is None:
            raise KeyError('This template is no longer available.')
        value = json.loads(row[0])
        if value.get('removed') and not removed:
            raise KeyError('This template is no longer available.')
        return value

    def save(self, project_id, name, content=True):
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 200:
            raise ValidationError('Give the template a name of 1–200 characters.')
        if not isinstance(content, bool):
            raise ValidationError('Choose whether the template includes document content.')
        original = self.store.get(project_id)
        project = create_project(name.strip(), 'blank')
        # Templates contain the authored document and its formatting, not the
        # source file binding, history, Sandbox drafts or playback state.
        for field in ('settings', 'styles', 'dictionary', 'pronunciation', 'language'):
            if field in original:
                project[field] = deepcopy(original[field])
        if content and original.get('book'):
            project['book'] = deepcopy(original['book'])
        elif content:
            from .publishing import project_document
            project['book'] = {'version':1, 'chapters':[{'id':uid('chapter_'), 'title':section['title'] or 'Document', 'include':True,
                'document':{'type':'doc','content':section['blocks'] or [{'type':'paragraph'}]}} for section in project_document(original)]}
            if not project['book']['chapters']:
                project['book']['chapters'] = [{'id':uid('chapter_'), 'title':'Document', 'include':True, 'document':{'type':'doc','content':[{'type':'paragraph'}]}}]
        else:
            project['settings'].pop('stationeryPreset', None)
            project['book'] = {'version':1, 'chapters':[{'id':uid('chapter_'), 'title':'Document', 'include':True,
                'document':{'type':'doc','content':[{'type':'paragraph'}]}}]}
        # Only images actually used by the template are collected.
        used = set()
        def references(node):
            if isinstance(node, dict):
                if node.get('type') in ('image', 'inline_image'):
                    attrs = node.get('attrs', {})
                    if attrs.get('assetId'):
                        used.add(attrs['assetId'])
                for child in node.values():
                    references(child)
            elif isinstance(node, list):
                for child in node:
                    references(child)
        references(project['book'])
        if project['settings'].get('coverAssetId'):
            used.add(project['settings']['coverAssetId'])
        project['assets'] = [deepcopy(asset) for asset in original['assets'] if asset['id'] in used]
        relocate_raw_images(project, project_id, project['id'])
        for asset in project['assets']:
            path, _ = self.store.asset_path(project_id, asset['id'])
            data = path.read_bytes()
            filename = asset['path']
            if not re.fullmatch(r'[a-f0-9]{64}(?:\.[a-z0-9]{1,12})?', filename):
                raise ValidationError('A template image has an invalid collected filename.')
            if hashlib.sha256(data).hexdigest() != filename.split('.')[0].lower():
                raise ValidationError('A template image failed its integrity check.')
            self.store._atomic_bytes(self.assets / filename, data)
        project = validate_project(project)
        value = {'id':uid('template_'), 'name':name.strip(), 'createdAt':now(),
                 'kind':project['settings'].get('documentKind','docx'), 'content':content, 'project':project}
        if value['kind'] not in ('txt', 'docx', 'book'):
            value['kind'] = 'docx'
        with self.store._lock, self.store.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            for row in conn.execute("SELECT value FROM metadata WHERE key LIKE 'document-template-summary:%'"):
                other = json.loads(row[0])
                if not other.get('removed') and other['name'].casefold() == value['name'].casefold():
                    raise ConflictError('A template with this name already exists. Choose another name.')
            conn.execute('INSERT INTO metadata VALUES (?,?)', (self.key(value['id']), json.dumps(value, ensure_ascii=False)))
            conn.execute('INSERT INTO metadata VALUES (?,?)', ('document-template-summary:' + value['id'], json.dumps(self.summary(value), ensure_ascii=False)))
            conn.commit()
        return self.summary(value)

    def remove(self, identity, removed=True):
        # A reversible library action; existing documents and image bytes stay intact.
        with self.store._lock:
            value = self.get(identity, removed=True)
            value['removed'] = removed
            with self.store.connection() as conn:
                conn.execute('BEGIN IMMEDIATE')
                if not removed:
                    for row in conn.execute("SELECT value FROM metadata WHERE key LIKE 'document-template-summary:%'"):
                        other = json.loads(row[0])
                        if other['id'] != identity and not other.get('removed') and other['name'].casefold() == value['name'].casefold():
                            raise ConflictError('Another template now uses this name. Remove it before restoring this template.')
                conn.execute('UPDATE metadata SET value=? WHERE key=?', (json.dumps(value, ensure_ascii=False), self.key(identity)))
                conn.execute('UPDATE metadata SET value=? WHERE key=?', (json.dumps({**self.summary(value), 'removed':removed}, ensure_ascii=False), 'document-template-summary:' + identity))
                conn.commit()
        return self.summary(value)

    def create(self, identity, name):
        value = self.get(identity)
        project = deepcopy(value['project'])
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 200:
            raise ValidationError('Give the document a name of 1–200 characters.')
        identities = {}
        def collect(node):
            if isinstance(node, dict):
                for key in ('id', 'blockId', 'threadId'):
                    if isinstance(node.get(key), str):
                        identities.setdefault(node[key], uid('copy_'))
                for child in node.values():
                    collect(child)
            elif isinstance(node, list):
                for child in node:
                    collect(child)
        collect(project)
        identities[project['id']] = uid('project_')
        relocate_raw_images(project, project['id'], identities[project['id']], identities)
        def relocate(node):
            if isinstance(node, dict):
                for key, item in node.items():
                    if key == 'href' and isinstance(item, str) and item.startswith('#'):
                        node[key] = '#' + identities.get(item[1:], item[1:])
                    elif isinstance(item, str) and (key == 'id' or key.endswith('Id') or key in ('basedOn', 'nextStyle')):
                        node[key] = identities.get(item, item)
                    elif isinstance(item, list) and key.endswith('Ids'):
                        node[key] = [identities.get(value, value) if isinstance(value, str) else value for value in item]
                    else:
                        relocate(item)
            elif isinstance(node, list):
                for child in node:
                    relocate(child)
        relocate(project)
        project.update(name=name.strip(), createdAt=now())
        project = validate_project(project)
        # Verify every source before publishing the new document. Generated
        # copies share no file binding or mutable image directory with the template.
        images = []
        root = self.assets.resolve()
        for asset in project['assets']:
            path = (root / asset['path']).resolve()
            if not path.is_relative_to(root) or not path.is_file():
                raise ValidationError('A template image is missing. Restore it from a data backup or save the template again.')
            data = path.read_bytes()
            if hashlib.sha256(data).hexdigest() != asset['path'].split('.')[0].lower():
                raise ValidationError('A template image failed its integrity check.')
            images.append((asset['path'], data))
        for filename, data in images:
            self.store._atomic_bytes(self.store.asset_dir(project['id']) / filename, data)
        return self.store.insert(project)
