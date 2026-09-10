"""Transactional local persistence, recoverable history, and portable archives."""
from __future__ import annotations

from contextlib import closing, contextmanager
from copy import deepcopy
import hashlib
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import tempfile
from threading import RLock
from zipfile import ZipFile, ZIP_DEFLATED, BadZipFile

from .models import ValidationError, create_project, now, uid, validate_project


class ConflictError(ValueError):
    def __init__(self, message: str, current: dict | None = None):
        super().__init__(message)
        self.current = current


class Store:
    def __init__(self, data_dir: Path | str):
        self.data_dir = Path(data_dir).resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "alder.sqlite3"
        self._lock = RLock()
        with self.connection() as conn:
            # Check compatibility before DDL, journal-mode changes, or any write.
            # Version 1 is the only released schema; future migrations must take
            # a verified backup before changing this compatibility boundary.
            try:
                tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
                if tables:
                    version = conn.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone() if "metadata" in tables else None
                    if version is None or version[0] != "1":
                        raise ValidationError("This Alder database uses an unsupported schema version. Its files have been preserved.")
            except sqlite3.DatabaseError as exc:
                raise ValidationError("This Alder database could not be read. Its files have been preserved; restore a collected project archive.") from exc
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL,
                    updated_at TEXT NOT NULL, cursor INTEGER NOT NULL, snapshot TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS history (
                    project_id TEXT NOT NULL, seq INTEGER NOT NULL, snapshot TEXT NOT NULL,
                    PRIMARY KEY(project_id, seq));
                CREATE TABLE IF NOT EXISTS archives (
                    path TEXT PRIMARY KEY, project_id TEXT NOT NULL, digest TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """)
            conn.execute("INSERT OR IGNORE INTO metadata VALUES ('schema_version','1')")
            conn.commit()

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            try:
                conn.execute("PRAGMA foreign_keys=ON")
                conn.execute("PRAGMA synchronous=FULL")
            except sqlite3.DatabaseError as exc:
                raise ValidationError("This Alder database could not be read. Its files have been preserved; restore a collected project archive.") from exc
            yield conn
        finally:
            conn.close()

    def list_projects(self) -> list[dict]:
        with self.connection() as conn:
            return [dict(row) for row in conn.execute("SELECT id,name,revision,updated_at AS updatedAt FROM projects ORDER BY updated_at DESC")]

    def get(self, project_id: str) -> dict:
        with self.connection() as conn:
            row = conn.execute("SELECT snapshot FROM projects WHERE id=?", (project_id,)).fetchone()
            if row is None:
                raise KeyError("Project does not exist.")
            return json.loads(row[0])

    def create(self, name: str | None = None, template: str = "demo") -> dict:
        return self.insert(create_project(name, template))

    def insert(self, project: dict) -> dict:
        p = validate_project(project)
        p["revision"] = 1
        p["updatedAt"] = now()
        payload = json.dumps(p, ensure_ascii=False)
        with self._lock, self.connection() as conn:
            try:
                conn.execute("INSERT INTO projects VALUES (?,?,?,?,?,?)", (p["id"], p["name"], 1, p["updatedAt"], 0, payload))
                conn.execute("INSERT INTO history VALUES (?,?,?)", (p["id"], 0, payload))
                conn.commit()
            except sqlite3.IntegrityError as exc:
                raise ConflictError("A project with this identity is already open.") from exc
        return p

    def update(self, project_id: str, project: dict, expected_revision: int) -> dict:
        with self._lock, self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
            if row is None:
                raise KeyError("Project does not exist.")
            current = json.loads(row["snapshot"])
            if expected_revision != row["revision"]:
                raise ConflictError("A newer revision is already saved. Reload before applying this change.", current)
            if not isinstance(project, dict) or project.get("id") != project_id:
                raise ValidationError("The project identity cannot change during an edit.")
            p = validate_project(project, current)
            p["createdAt"] = current["createdAt"]
            p["updatedAt"] = now()
            p["revision"] = row["revision"] + 1
            payload = json.dumps(p, ensure_ascii=False)
            cursor = row["cursor"] + 1
            conn.execute("DELETE FROM history WHERE project_id=? AND seq>?", (project_id, row["cursor"]))
            conn.execute("INSERT INTO history VALUES (?,?,?)", (project_id, cursor, payload))
            # Bound full-document history while preserving the current durable snapshot.
            # Keep 200 acknowledged authoring operations, independently per project.
            conn.execute("DELETE FROM history WHERE project_id=? AND seq<?", (project_id, max(0, cursor - 200)))
            conn.execute("UPDATE projects SET name=?,revision=?,updated_at=?,cursor=?,snapshot=? WHERE id=?",
                         (p["name"], p["revision"], p["updatedAt"], cursor, payload, project_id))
            conn.commit()
            return p

    def history_step(self, project_id: str, direction: int) -> dict:
        with self._lock, self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            current = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
            if current is None:
                raise KeyError("Project does not exist.")
            row = conn.execute("SELECT snapshot FROM history WHERE project_id=? AND seq=?", (project_id, current["cursor"] + direction)).fetchone()
            if row is None:
                return json.loads(current["snapshot"])
            previous = json.loads(current["snapshot"])
            p = validate_project(json.loads(row[0]), previous)
            p["revision"] = current["revision"] + 1
            p["updatedAt"] = now()
            conn.execute("UPDATE projects SET name=?,revision=?,updated_at=?,cursor=?,snapshot=? WHERE id=?",
                         (p["name"], p["revision"], p["updatedAt"], current["cursor"] + direction, json.dumps(p, ensure_ascii=False), project_id))
            conn.commit()
            return p

    def history_status(self, project_id: str) -> dict:
        with self.connection() as conn:
            row = conn.execute("SELECT cursor FROM projects WHERE id=?", (project_id,)).fetchone()
            if row is None:
                raise KeyError("Project does not exist.")
            bounds = conn.execute("SELECT MIN(seq),MAX(seq) FROM history WHERE project_id=?", (project_id,)).fetchone()
            return {"canUndo": row[0] > bounds[0], "canRedo": row[0] < bounds[1]}

    def asset_dir(self, project_id: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", project_id):
            raise ValidationError("Invalid project identity.")
        directory = self.data_dir / "assets" / project_id
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    def store_asset(self, project_id: str, name: str, content: bytes, mime: str | None = None, asset_id: str | None = None) -> dict:
        if len(content) > 64 * 1024 * 1024:
            raise ValidationError("Individual assets are limited to 64 MB.")
        safe_name = Path(name.replace("\\", "/")).name or "asset"
        ext = Path(safe_name).suffix.lower()
        if not re.fullmatch(r"\.[a-z0-9]{1,12}", ext):
            ext = ""
        stored_name = hashlib.sha256(content).hexdigest() + ext
        target = self.asset_dir(project_id) / stored_name
        if not target.exists():
            self._atomic_bytes(target, content)
        return {"id": asset_id or uid("asset_"), "name": safe_name, "mime": mime or mimetypes.guess_type(safe_name)[0] or "application/octet-stream",
                "path": stored_name, "size": len(content), "sha256": hashlib.sha256(content).hexdigest()}

    def asset_path(self, project_id: str, asset_id: str) -> tuple[Path, dict]:
        project = self.get(project_id)
        asset = next((a for a in project["assets"] if a["id"] == asset_id), None)
        if asset is None or not asset.get("path"):
            raise KeyError("Asset is not registered in this project.")
        root = self.asset_dir(project_id).resolve()
        target = (root / asset["path"]).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            raise KeyError("Asset is missing. Relink it from the project browser.")
        return target, asset

    @staticmethod
    def _atomic_bytes(path: Path, content: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".alder-", suffix=".tmp", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as out:
                out.write(content)
                out.flush()
                os.fsync(out.fileno())
            os.replace(temporary, path)
        finally:
            Path(temporary).unlink(missing_ok=True)

    def save_archive(self, project_id: str, path: str | None = None, overwrite_external: bool = False) -> Path:
        p = self.get(project_id)
        safe_stem = re.sub(r"[^\w .-]", "_", p["name"]).rstrip(" .")[:80] or "Untitled"
        if safe_stem.split(".", 1)[0].upper() in {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}:
            safe_stem = "Alder-" + safe_stem
        destination = Path(path).expanduser().resolve() if path else (self.data_dir / "projects" / (safe_stem + ".alder")).resolve()
        if destination.suffix.lower() != ".alder":
            destination = destination.with_suffix(".alder")
        destination.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            prior = conn.execute("SELECT digest FROM archives WHERE path=?", (str(destination),)).fetchone()
        if destination.exists() and prior and not overwrite_external and hashlib.sha256(destination.read_bytes()).hexdigest() != prior[0]:
            raise ConflictError("This project file changed outside Alder. Use Save As to preserve both versions.")
        entries: dict[str, bytes] = {"project.json": json.dumps(p, ensure_ascii=False, indent=2).encode("utf-8")}
        voice_ids = {entry.get("voiceId") for entry in p["tracks"] + p["clips"] + p.get("pronunciation", [])} - {None, "", "default"}
        saved_voices = []
        for voice_id in sorted(voice_ids):
            if not isinstance(voice_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", voice_id):
                raise ValidationError("A project refers to an invalid voice profile.")
            voice_dir = self.data_dir / "speech" / "voices" / voice_id
            if not (voice_dir / "voice.json").is_file() or not (voice_dir / "reference.wav").is_file():
                raise ValidationError("A reference voice is missing. Choose an available voice before collecting this project.")
            for voice_file in ("voice.json", "reference.wav"):
                entries[f"voices/{voice_id}/{voice_file}"] = (voice_dir / voice_file).read_bytes()
            saved_voices.append(voice_id)
        for asset in p["assets"]:
            file_path, _ = self.asset_path(project_id, asset["id"])
            entries["assets/" + asset["path"]] = file_path.read_bytes()
        with tempfile.TemporaryDirectory(prefix="alder-save-") as scratch:
            # Construct a project-scoped SQLite snapshot, then use the backup API.
            # Other open projects and historical deleted writing stay private.
            with closing(sqlite3.connect(":memory:")) as source:
                source.execute("CREATE TABLE project (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL)")
                source.execute("INSERT INTO project VALUES (?,?)", (p["id"], entries["project.json"].decode("utf-8")))
                source.commit()
                database = Path(scratch) / "snapshot.sqlite3"
                with closing(sqlite3.connect(database)) as backup:
                    source.backup(backup)
            entries["snapshot.sqlite3"] = database.read_bytes()
            manifest = {"format": "alder-project", "schemaVersion": 1, "createdAt": now(), "projectId": p["id"], "voices": saved_voices,
                        "revision": p["revision"], "files": {n: {"sha256": hashlib.sha256(b).hexdigest(), "size": len(b)} for n, b in entries.items()}}
            archive = Path(scratch) / "project.alder"
            with ZipFile(archive, "w", ZIP_DEFLATED) as out:
                out.writestr("manifest.json", json.dumps(manifest, indent=2))
                for name, content in entries.items():
                    out.writestr(name, content)
            with ZipFile(archive) as check:
                if check.testzip():
                    raise ValidationError("Archive verification failed; original file was preserved.")
            if destination.exists():
                shutil.copy2(destination, destination.with_suffix(".alder.bak"))
            self._atomic_bytes(destination, archive.read_bytes())
        with self.connection() as conn:
            conn.execute("INSERT OR REPLACE INTO archives VALUES (?,?,?)", (str(destination), project_id, hashlib.sha256(destination.read_bytes()).hexdigest()))
            conn.commit()
        return destination

    def open_archive(self, path: str) -> dict:
        source = Path(path).expanduser().resolve()
        if not source.is_file() or source.suffix.lower() != ".alder":
            raise ValidationError("Select an existing .alder project file.")
        if source.stat().st_size > 512 * 1024 * 1024:
            raise ValidationError("Project archive exceeds 512 MB.")
        try:
            with ZipFile(source) as archive:
                members = archive.infolist()
                if len(members) > 10_000 or sum(m.file_size for m in members) > 1024 * 1024 * 1024:
                    raise ValidationError("Project archive expands beyond the supported limit.")
                names: set[str] = set()
                for member in members:
                    path_bits = PurePosixPath(member.filename)
                    if member.filename in names or path_bits.is_absolute() or ".." in path_bits.parts or "\\" in member.filename or ":" in member.filename:
                        raise ValidationError("Project archive contains unsafe or duplicate paths.")
                    names.add(member.filename)
                manifest = json.loads(archive.read("manifest.json"))
                if not isinstance(manifest, dict) or manifest.get("format") != "alder-project" or manifest.get("schemaVersion") != 1:
                    raise ValidationError("Unsupported project archive version.")
                if not isinstance(manifest.get("files"), dict) or not isinstance(manifest.get("voices", []), list):
                    raise ValidationError("Invalid project archive manifest.")
                payloads = {}
                for name, info in manifest.get("files", {}).items():
                    if not isinstance(info, dict):
                        raise ValidationError("Invalid project archive component metadata.")
                    if name not in names:
                        raise ValidationError("An archive component is missing.")
                    payload = archive.read(name)
                    if len(payload) != info.get("size") or hashlib.sha256(payload).hexdigest() != info.get("sha256"):
                        raise ValidationError("A project component failed its integrity check.")
                    payloads[name] = payload
                p = validate_project(json.loads(payloads["project.json"]))
        except (BadZipFile, KeyError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValidationError("This is not a complete, readable Alder project archive.") from exc
        original_id = p["id"]
        for voice_id in manifest.get("voices", []):
            if not isinstance(voice_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", voice_id):
                raise ValidationError("Archive contains an invalid voice identity.")
            metadata_key = f"voices/{voice_id}/voice.json"
            reference_key = f"voices/{voice_id}/reference.wav"
            if metadata_key not in payloads or reference_key not in payloads:
                raise ValidationError("Archive is missing a reference voice component.")
            try:
                voice = json.loads(payloads[metadata_key])
            except (ValueError, UnicodeDecodeError) as exc:
                raise ValidationError("Archive contains invalid voice metadata.") from exc
            if not isinstance(voice, dict) or voice.get("id") != voice_id or voice.get("hash") != hashlib.sha256(payloads[reference_key]).hexdigest():
                raise ValidationError("Archive reference voice failed its integrity check.")
            destination = self.data_dir / "speech" / "voices" / voice_id
            if (destination / "reference.wav").is_file() and hashlib.sha256((destination / "reference.wav").read_bytes()).hexdigest() != voice["hash"]:
                replacement = uid()
                for entry in p["tracks"] + p["clips"] + p.get("pronunciation", []):
                    if entry.get("voiceId") == voice_id:
                        entry["voiceId"] = replacement
                voice["id"] = replacement
                destination = self.data_dir / "speech" / "voices" / replacement
            self._atomic_bytes(destination / "reference.wav", payloads[reference_key])
            self._atomic_bytes(destination / "voice.json", json.dumps(voice).encode("utf-8"))
        try:
            existing = self.get(p["id"])
        except KeyError:
            existing = None
        same_snapshot = existing is not None and existing == p
        if existing and not same_snapshot:
            # Reopening an older saved file must never erase newer autosaved work.
            p["id"] = uid("project_")
            p["name"] = p["name"][:289] + " (imported)"
            p["restoredFrom"] = original_id
        for asset in p["assets"]:
            relative = "assets/" + asset.get("path", "")
            if relative not in payloads:
                raise ValidationError(f"Archive is missing asset: {asset.get('name', asset['id'])}")
            content = payloads[relative]
            expected_name = hashlib.sha256(content).hexdigest()
            if not asset["path"].startswith(expected_name):
                raise ValidationError("Archive asset name does not match its content.")
            self._atomic_bytes(self.asset_dir(p["id"]) / asset["path"], content)
        # Opening a collected archive also repairs missing authored assets when
        # the working snapshot itself is unchanged. Do not skip the collection.
        result = existing if same_snapshot else self.insert(p)
        with self.connection() as conn:
            conn.execute("INSERT OR REPLACE INTO archives VALUES (?,?,?)", (str(source), result["id"], hashlib.sha256(source.read_bytes()).hexdigest()))
            conn.commit()
        return result
