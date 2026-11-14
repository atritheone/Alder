"""Small, disposable narration index. Manuscripts and audio stay in manifests."""
import json
from pathlib import Path
import re


def summary(job):
    value={key:job[key] for key in ('id','projectId','sourceRevision','status','progress','message','createdAt','error','format','seconds','eventSequence') if key in job}
    chunks=job.get('chunks',[])
    # A summary never claims verified playback. Opening the recording hydrates
    # it through the normal integrity/review checks before Listen is enabled.
    return {**value,'summary':True,'text':'','chunks':[], 'chunkCount':len(chunks),
            'readyChunkCount':sum(c.get('status') in ('ready','completed') for c in chunks)}


class SpeechLibrary:
    def __init__(self, root):
        self.root = Path(root)
        self.index = self.root / "library-index.json"
        self.rows = None

    def path(self, identity):
        if not isinstance(identity, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", identity):
            raise KeyError("Unknown narration job.")
        path = (self.root / identity / "manifest.json").resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise KeyError("Unknown narration job.")
        return path

    def load(self, identity):
        try:
            row = json.loads(self.path(identity).read_text("utf-8"))
            if not isinstance(row, dict) or row.get("id") != identity:
                raise ValueError()
            return row
        except (OSError, ValueError, TypeError) as exc:
            raise KeyError("Unknown or damaged narration job. Its files were retained.") from exc

    def ids_for_project(self, project_id):
        if self.rows is None:
            try:
                cached = json.loads(self.index.read_text("utf-8"))
                self.rows = cached["jobs"] if cached.get("version") == 1 and isinstance(cached.get("jobs"), dict) else {}
            except (OSError, ValueError, TypeError, KeyError):
                self.rows = {}
        rows = {}
        for path in self.root.glob("*/manifest.json"):
            identity = path.parent.name
            try:
                checked = self.path(identity)
                if checked != path.resolve():
                    continue
                stat = checked.stat()
                signature = [stat.st_size, stat.st_mtime_ns]
                cached = self.rows.get(identity)
                if not isinstance(cached, dict) or cached.get("signature") != signature or not isinstance(cached.get("projectId"), str) or not isinstance(cached.get('summary'),dict):
                    job = self.load(identity)
                    cached = {"projectId": job["projectId"], "createdAt": job["createdAt"], "signature": signature,'summary':summary(job)}
                rows[identity] = cached
            except (OSError, KeyError, ValueError, TypeError):
                continue
        if rows != self.rows:
            self.rows = rows
            # This cache is a hint. A write failure cannot lose or hide a job.
            try:
                from .speech import _atomic_json
                _atomic_json(self.index, {"version": 1, "jobs": rows}, compact=True)
            except OSError:
                pass
        return [identity for identity, row in rows.items() if row["projectId"] == project_id]
