"""Disposable version-list cache. Recovery always reads authoritative history."""
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile


class VersionMetadata:
    def __init__(self, data_dir):
        self.root=Path(data_dir)/'cache'/'version-metadata-v1'

    def path(self, identity):
        return self.root/(hashlib.sha256(identity.encode('utf-8')).hexdigest()+'.json')

    def read(self, identity, revision, updated_at):
        try:
            path=self.path(identity)
            with path.open('rb') as stream:raw=stream.read(512001)
            if len(raw)>512000:return None
            value=json.loads(raw)
            if value.get('version')!=1 or value.get('id')!=identity or value.get('revision')!=revision or value.get('sourceUpdatedAt')!=updated_at:return None
            rows=value['rows'];cursor=value['cursor']
            if not isinstance(rows,list) or not 1<=len(rows)<=201 or type(cursor) is not int:return None
            if any(not isinstance(row,dict) or set(row)!={'sequence','revision','name','updatedAt'}
                   or type(row['sequence']) is not int or type(row['revision']) is not int or not isinstance(row['name'],str)
                   or not isinstance(row['updatedAt'],str) for row in rows):return None
            order=[row['sequence'] for row in rows]
            if order!=sorted(set(order),reverse=True) or cursor not in order:return None
            return {'revision':revision,'sourceUpdatedAt':updated_at,'cursor':cursor,'rows':rows}
        except (OSError,ValueError,TypeError,KeyError,AttributeError):return None

    def write(self, identity, value):
        temporary=None
        try:
            self.root.mkdir(parents=True,exist_ok=True)
            payload=json.dumps({'version':1,'id':identity,**value},ensure_ascii=False).encode('utf-8')
            if len(payload)>512000:return
            fd,temporary=tempfile.mkstemp(prefix='.metadata-',suffix='.tmp',dir=self.root)
            with os.fdopen(fd,'wb') as stream:stream.write(payload)
            # No authored commit depends on this cache's durability. A missing
            # or stale entry is rebuilt from SQLite after revision validation.
            os.replace(temporary,self.path(identity));temporary=None
            files=[path for path in self.root.glob('*.json') if re.fullmatch(r'[a-f0-9]{64}\.json',path.name)]
            for path in sorted(files,key=lambda p:p.stat().st_mtime_ns)[:-64]:path.unlink(missing_ok=True)
        except (OSError,ValueError,TypeError):pass
        finally:
            if temporary:
                try:Path(temporary).unlink(missing_ok=True)
                except OSError:pass
