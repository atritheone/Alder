"""Stage imported documents without publishing partial or cancelled workspaces."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
import base64
import hashlib
import shutil
import tempfile
import threading
import time

from .models import ValidationError, create_project, now, text_document, uid, validate_project
from .store import Store
from .performance import span


def imported_project(imported, name, staging):
    """Keep the source draft and create the editable book in one snapshot."""
    p = create_project(Path(name).stem, 'blank')
    for asset in imported.get('assets', []):
        p['assets'].append(staging.store_asset(p['id'], asset['name'], base64.b64decode(asset['data'], validate=True), asset.get('mime'), asset.get('id')))
    track = next(t for t in p['tracks'] if t['role'] == 'reference')
    clip = {'id': uid('clip_'), 'trackId': track['id'], 'slot': 0,
            'title': imported.get('title') or Path(name).stem,
            'document': imported.get('document') or text_document(imported.get('text', '')),
            'variants': [], 'tags': ['imported']}
    if imported.get('rawSource'): clip.update(rawSource=imported['rawSource'], rawFormat=imported['rawFormat'])
    p['clips'].append(clip)
    p['placements'].append({'id': uid('placement_'), 'clipId': clip['id'], 'sectionId': p['sections'][0]['id'], 'order': 1})
    chapters = imported.get('chapters') or [{'title': clip['title'], 'role': 'chapter', 'document': deepcopy(clip['document']),
        **({k: deepcopy(clip[k]) for k in ('rawSource', 'rawFormat')} if clip.get('rawSource') else {})}]
    p['book'] = {'version': 1, 'chapters': [{**chapter, 'id': uid('chapter_'), 'include': True, 'voiceId': None} for chapter in chapters]}
    kind = 'book' if imported.get('chapters') else 'txt' if Path(name).suffix.lower() == '.txt' else 'docx'
    suffix = Path(name).suffix.lower().lstrip('.')
    preferred = 'md' if suffix in ('md', 'markdown') else 'alder' if kind == 'book' else suffix if suffix in ('odt', 'rtf') else kind
    p['settings'].update(imported.get('settings') or {})
    p['settings'].update(documentKind=kind, preferredFormat=preferred, includeTitle=False, footer=False)
    p['lastImport'] = {'name': name, 'warnings': imported.get('warnings', []), 'clipId': clip['id'], 'createdAt': now(),
        **({'pageSettings': imported['settings']} if imported.get('settings') else {}),
        **({'bookStructure': True} if imported.get('chapters') else {})}
    return validate_project(p)


class DocumentOpening:
    def __init__(self, store, importer=None):
        self.store, self.importer = store, importer
        self.lock = threading.RLock()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='alder-opening')
        self.jobs = {}
        self.closed = False
        self.root = (store.data_dir / 'imports' / 'opening').resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _cleanup(self, job):
        path = job.get('directory')
        if path and path.parent == self.root and path.is_relative_to(self.root):
            shutil.rmtree(path, ignore_errors=True)
        job.pop('project', None)
        job.pop('archive', None)

    def _public(self, job):
        return {key: job[key] for key in ('id', 'name', 'status', 'error', 'projectId') if key in job}

    def start(self, name, content):
        name = Path(str(name or 'document.txt').replace('\\', '/')).name
        if Path(name).suffix.lower() not in ('.alder', '.txt', '.md', '.markdown', '.docx', '.odt', '.rtf', '.html', '.htm', '.epub', '.pdf'):
            raise ValidationError('Choose a supported text document to import.')
        with self.lock:
            if self.closed: raise ValidationError('Document opening is shutting down.')
            # Bound queued uploads and retained metadata. An abandoned ready
            # result expires without ever becoming a saved user workspace.
            for identity, job in list(self.jobs.items()):
                if job['status'] in ('ready', 'failed', 'cancelled', 'completed') and job['future'].done() and time.monotonic() - job['touched'] > 900:
                    self._cleanup(job); self.jobs.pop(identity)
            if sum(job['status'] not in ('failed', 'cancelled', 'completed') for job in self.jobs.values()) >= 4:
                raise ValidationError('Finish or cancel the current file imports before opening more.')
            while len(self.jobs) >= 32:
                oldest = next((key for key, job in self.jobs.items() if job['status'] in ('failed', 'cancelled', 'completed') and job['future'].done()), None)
                if oldest is None: raise ValidationError('Finish or cancel the current file imports before opening more.')
                self.jobs.pop(oldest)
            identity = uid('opening_')
            directory = Path(tempfile.mkdtemp(prefix=identity+'-', dir=self.root)).resolve()
            job = {'id': identity, 'name': name, 'status': 'reading', 'touched': time.monotonic(), 'directory': directory, 'cancel': threading.Event()}
            self.jobs[identity] = job
            job['future'] = self.pool.submit(self._prepare, job, content)
            return self._public(job)

    def _prepare(self, job, content):
        try:
            if job['cancel'].is_set(): return
            path = job['directory'] / ('source' + Path(job['name']).suffix.lower())
            path.write_bytes(content)
            if path.suffix == '.alder':
                prepared = self.store.prepare_archive(str(path))
                with self.lock:
                    if job['cancel'].is_set(): return
                    job.update(archive=prepared, status='ready', touched=time.monotonic())
                return
            if self.importer is None:
                from .publishing import import_document
            else: import_document = self.importer
            with span("opening.parse"):
                imported = import_document(path)
            with self.lock:
                if job['cancel'].is_set(): return
                job['status'] = 'collecting'
            staging = Store(job['directory'] / 'staged')
            with span("opening.validate"):
                project = imported_project(imported, job['name'], staging)
            with self.lock:
                if job['cancel'].is_set(): return
                job.update(project=project, status='ready', touched=time.monotonic())
        except Exception as error:
            with self.lock:
                if not job['cancel'].is_set(): job.update(status='failed', error=str(error))
        finally:
            with self.lock:
                if job['status'] != 'ready': self._cleanup(job)

    def get(self, identity):
        with self.lock:
            job = self.jobs[identity]; job['touched'] = time.monotonic()
            return self._public(job)

    def cancel(self, identity):
        with self.lock:
            job = self.jobs[identity]
            if job['status'] in ('failed', 'completed', 'cancelled'): return self._public(job)
            job['cancel'].set()
            ready = job['status'] == 'ready'
            job.update(status='cancelled', touched=time.monotonic())
            if job['future'].cancel() or ready: self._cleanup(job)
            return self._public(job)

    def commit(self, identity):
        # The short durable handoff is atomic with respect to cancellation.
        # Parsing and collecting assets finish before entering this section.
        with self.lock:
            job = self.jobs[identity]
            if job['status'] == 'completed': return self.store.get(job['projectId'])
            if job['status'] != 'ready': raise ValidationError('This imported document is not ready to open.')
            if 'archive' in job:
                try:
                    saved = self.store.commit_archive(job['archive'])
                except Exception as error:
                    job.update(status='failed', error=str(error)); self._cleanup(job)
                    raise
                job.update(status='completed', projectId=saved['id'], touched=time.monotonic())
                self._cleanup(job)
                return saved
            project = job['project']
            destination = (self.store.data_dir / 'assets' / project['id']).resolve()
            if destination.exists(): raise ValidationError('The imported workspace identity already exists.')
            try:
                for asset in project['assets']:
                    source = job['directory'] / 'staged' / 'assets' / project['id'] / asset['path']
                    content = source.read_bytes()
                    if asset['path'].split('.')[0] != hashlib.sha256(content).hexdigest():
                        raise ValidationError('An imported image failed its integrity check.')
                    self.store._atomic_bytes(destination / asset['path'], content)
                with span("opening.commit"):
                    saved = self.store._insert_validated_many([project])[0]
            except Exception as error:
                if destination.parent == (self.store.data_dir / 'assets').resolve(): shutil.rmtree(destination, ignore_errors=True)
                job.update(status='failed', error=str(error)); self._cleanup(job)
                raise
            job.update(status='completed', projectId=saved['id'], touched=time.monotonic())
            self._cleanup(job)
            return saved

    def shutdown(self):
        with self.lock:
            self.closed = True
            for identity in list(self.jobs): self.cancel(identity)
        self.pool.shutdown(wait=False, cancel_futures=True)
