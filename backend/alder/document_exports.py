"""Bounded, cancellable export preparation with an explicit publication handoff."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
import json
import shutil
import threading
import time

from .models import ValidationError, uid
from .store import ConflictError
from . import export_staging


class DocumentExports:
    def __init__(self, store, builder=None):
        self.store, self.builder = store, builder
        self.root = (store.data_dir / 'exports').resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        export_staging.recover(self.root)
        self.lock = threading.RLock()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='alder-export')
        self.jobs = {}
        self.closed = False

    def _public(self, job):
        return {key: job[key] for key in ('id', 'status', 'format', 'projectId', 'sourceRevision', 'error') if key in job}

    def _cleanup(self, job):
        path = job['directory']
        if job.get('ownsDirectory') and path.parent == self.root and path.is_relative_to(self.root): shutil.rmtree(path, ignore_errors=True)
        if handle := job.pop('lease', None): export_staging.finish(handle, not (job.get('ownsDirectory') and path.exists()))
        job.pop('project', None)
        job.pop('result', None)

    def start(self, project_id, format, options=None, expected_revision=None):
        format = str(format).lower()
        if format not in ('txt', 'md', 'html', 'docx', 'odt', 'rtf', 'pdf', 'epub', 'azw3'):
            raise ValidationError('Choose a supported export format.')
        if options is not None and not isinstance(options, dict): raise ValidationError('Invalid export options.')
        with self.lock:
            if self.closed: raise ValidationError('Document export is shutting down.')
            for identity, job in list(self.jobs.items()):
                if job['future'].done() and time.monotonic() - job['touched'] > 900:
                    if job['status'] != 'completed': self._cleanup(job)
                    self.jobs.pop(identity)
            # A cancelled library call still owns its worker until it returns.
            if sum(not j['future'].done() or j['status'] == 'ready' for j in self.jobs.values()) >= 4:
                raise ValidationError('Finish or cancel the current exports before starting more.')
            while len(self.jobs) >= 32:
                identity = next((key for key, j in self.jobs.items() if j['future'].done() and j['status'] != 'ready'), None)
                if identity is None: raise ValidationError('Finish or cancel the current exports before starting more.')
                self.jobs.pop(identity)
            project = self.store.get(project_id)
            if expected_revision is not None and expected_revision != project['revision']:
                raise ConflictError('The document changed during export preparation. Export the current version again.')
            identity = uid('export_')
            job = {'id': identity, 'projectId': project_id, 'sourceRevision': project['revision'], 'project': project,
                   'format': format, 'options': deepcopy(options or {}), 'directory': (self.root / identity).resolve(),
                   'status': 'queued', 'touched': time.monotonic(), 'cancel': threading.Event()}
            job['options']['assetRoot'] = self.store.asset_dir(project_id)
            self.jobs[identity] = job
            job['future'] = self.pool.submit(self._prepare, job)
            return self._public(job)

    def _prepare(self, job):
        try:
            with self.lock:
                if job['cancel'].is_set(): return
                job['status'] = 'building'
                project = job['project']
            job['lease'] = export_staging.begin(self.root, job['id'])
            job['directory'].mkdir()
            job['ownsDirectory'] = True
            if self.builder is None:
                from .publishing import build_export
            else: build_export = self.builder
            result = build_export(project, job['format'], job['directory'], job['options'])
            path = Path(result['path']).resolve()
            if not path.is_relative_to(job['directory']) or not path.is_file():
                raise ValidationError('The export component returned an invalid file reference.')
            with self.lock:
                if job['cancel'].is_set(): return
                job.update(status='ready', touched=time.monotonic(), result={**result, 'id': job['id'],
                    'projectId': job['projectId'], 'sourceRevision': job['sourceRevision'], 'downloadUrl': f"/api/exports/{job['id']}"})
        except Exception as error:
            with self.lock:
                if not job['cancel'].is_set(): job.update(status='failed', error=str(error))
        finally:
            with self.lock:
                job.pop('project', None)
                if job['status'] not in ('ready', 'completed'): self._cleanup(job)

    def get(self, identity):
        with self.lock:
            job = self.jobs[identity]; job['touched'] = time.monotonic()
            return self._public(job)

    def complete(self, identity):
        with self.lock:
            job = self.jobs[identity]
            if job['status'] == 'completed': return deepcopy(job['result'])
            if job['status'] != 'ready': raise ValidationError('This export is not ready.')
            try:
                self.store._atomic_bytes(job['directory'] / 'result.json', json.dumps(job['result'], default=str).encode('utf-8'))
            except Exception as error:
                job.update(status='failed', error=str(error)); self._cleanup(job)
                raise
            job.update(status='completed', touched=time.monotonic())
            if handle := job.pop('lease', None): export_staging.finish(handle)
            return deepcopy(job['result'])

    def cancel(self, identity):
        with self.lock:
            job = self.jobs[identity]
            if job['status'] == 'completed': return self._public(job)
            job['cancel'].set(); job.update(status='cancelled', touched=time.monotonic())
            if job['future'].cancel() or job['future'].done() or 'result' in job: self._cleanup(job)
            return self._public(job)

    def shutdown(self):
        with self.lock:
            self.closed = True
            for identity in self.jobs: self.cancel(identity)
            self.pool.shutdown(wait=False, cancel_futures=True)
