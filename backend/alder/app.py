"""Loopback API for Alder's desktop shell and browser development client."""
from __future__ import annotations

import base64
import asyncio
from contextlib import asynccontextmanager
import hmac
import importlib
import json
import mimetypes
import os
from pathlib import Path
import re
import tempfile
from zipfile import BadZipFile
from xml.etree.ElementTree import ParseError

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from . import __version__, language
from .models import ValidationError, now, text_document, uid
from .store import ConflictError, Store


ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173", "alder://app"}


def default_data_dir() -> Path:
    if os.environ.get("ALDER_DATA_DIR"):
        return Path(os.environ["ALDER_DATA_DIR"])
    return Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local" / "share"))) / "Alder"


def create_app(data_dir: Path | str | None = None, project_root: Path | str | None = None, session_token: str | None = None) -> FastAPI:
    store = Store(data_dir or default_data_dir())
    root = Path(project_root or os.environ.get("ALDER_PROJECT_ROOT") or Path(__file__).resolve().parents[2])
    token = session_token if session_token is not None else os.environ.get("ALDER_SESSION_TOKEN", "")
    speech = None
    speech_error = None
    try:
        from .speech import SpeechService
        speech = SpeechService(store.data_dir, root)
    except (ImportError, RuntimeError, OSError) as exc:
        speech_error = str(exc)
    shutdown_lock = asyncio.Lock()
    speech_stopped = False

    async def stop_speech():
        nonlocal speech_stopped
        async with shutdown_lock:
            already_stopped = speech_stopped
            if not speech_stopped:
                if speech:
                    try:
                        await run_in_threadpool(speech.shutdown)
                    except (ProcessLookupError, BrokenPipeError):
                        # A worker that has already exited cannot survive the parent.
                        pass
                speech_stopped = True
            return already_stopped

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        await stop_speech()

    app = FastAPI(title="Alder", version=__version__, lifespan=lifespan)
    app.state.store = store
    app.state.speech = speech
    app.add_middleware(CORSMiddleware, allow_origins=sorted(ALLOWED_ORIGINS), allow_credentials=False,
                       allow_methods=["GET", "POST", "PUT", "OPTIONS"], allow_headers=["Authorization", "Content-Type", "X-Request-ID"])

    @app.middleware("http")
    async def protect_loopback(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin and origin not in ALLOWED_ORIGINS and not (origin == "null" and token):
            return JSONResponse({"detail": "This origin is not allowed to access Alder."}, status_code=403)
        host = request.url.hostname
        if host not in {"127.0.0.1", "localhost", "::1", "testserver"}:
            return JSONResponse({"detail": "Alder accepts loopback connections only."}, status_code=403)
        if token and request.method != "OPTIONS":
            supplied = request.headers.get("authorization", "")
            supplied = supplied[7:] if supplied.startswith("Bearer ") else ""
            # Media elements cannot set Authorization. Restrict token URLs to GET.
            if not supplied and request.method == "GET":
                supplied = request.query_params.get("token", "")
            if not hmac.compare_digest(supplied, token):
                return JSONResponse({"detail": "An Alder desktop session is required."}, status_code=401)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(ValidationError)
    async def invalid(_: Request, exc: ValidationError):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(ConflictError)
    async def conflict(_: Request, exc: ConflictError):
        return JSONResponse({"detail": str(exc), "current": exc.current}, status_code=409)

    @app.exception_handler(KeyError)
    async def missing(_: Request, exc: KeyError):
        return JSONResponse({"detail": str(exc).strip("'")}, status_code=404)

    def publication():
        try:
            return importlib.import_module("alder.publishing")
        except ImportError as exc:
            raise HTTPException(503, "The publishing component is unavailable in this build.") from exc

    def speech_service():
        if speech is None:
            raise HTTPException(503, "Speech resources are unavailable in this build. " + (speech_error or ""))
        return speech

    async def body(request: Request) -> dict:
        if request.headers.get("content-length") and int(request.headers["content-length"]) > 45_000_000:
            raise HTTPException(413, "Request body exceeds 45 MB.")
        try:
            result = await request.json()
        except (ValueError, UnicodeDecodeError) as exc:
            raise HTTPException(400, "A JSON request body is required.") from exc
        if not isinstance(result, dict):
            raise HTTPException(422, "The request body must be a JSON object.")
        return result

    async def uploaded(upload: UploadFile, limit: int = 64 * 1024 * 1024) -> bytes:
        content = await upload.read(limit + 1)
        if len(content) > limit:
            raise HTTPException(413, "This file exceeds the supported size limit.")
        return content

    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": __version__, "dataDir": str(store.data_dir),
                "capabilities": {"projects": True, "autosave": True, "history": True,
                                 "language": language.capabilities(),
                                 "speech": speech.capabilities() if speech else {"available": False, "message": speech_error},
                                 "publishing": publication().capabilities() if importlib.util.find_spec("alder.publishing") else {"available": False}}}

    @app.post("/api/lifecycle/shutdown")
    async def shutdown(request: Request):
        # This operation is available only to a token-authenticated desktop
        # session. An unauthenticated browser-development server cannot stop it.
        if not token:
            raise HTTPException(403, "Shutdown requires an authenticated Alder desktop session.")
        supplied = request.headers.get("authorization", "")
        if not hmac.compare_digest(supplied, "Bearer " + token):
            raise HTTPException(401, "An Alder desktop session is required.")
        already_stopped = await stop_speech()
        # The desktop awaits this response, then terminates its captured service
        # process. SQLite remains available throughout worker cleanup.
        return {"status": "stopping", "alreadyStopped": already_stopped}

    @app.get("/api/projects")
    def projects():
        return {"projects": store.list_projects()}

    @app.post("/api/projects")
    async def new_project(request: Request):
        data = await body(request)
        return await run_in_threadpool(store.create, data.get("name"), data.get("template", "demo"))

    @app.post("/api/projects/open")
    async def open_project(request: Request):
        data = await body(request)
        if not isinstance(data.get("path"), str) or not data["path"].strip():
            raise ValidationError("Select an Alder project file to open.")
        return await run_in_threadpool(store.open_archive, data["path"])

    @app.post("/api/projects/open-file")
    async def open_project_file(file: UploadFile = File(...)):
        content = await uploaded(file)
        scratch = store.data_dir / "imports"
        scratch.mkdir(exist_ok=True)
        fd, temporary = tempfile.mkstemp(suffix=".alder", dir=scratch)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(content)
            return await run_in_threadpool(store.open_archive, temporary)
        finally:
            Path(temporary).unlink(missing_ok=True)

    @app.get("/api/projects/{project_id}")
    def project(project_id: str):
        return store.get(project_id)

    @app.put("/api/projects/{project_id}")
    async def update(project_id: str, request: Request):
        data = await body(request)
        revision = data.get("expectedRevision")
        if not isinstance(revision, int) or isinstance(revision, bool):
            raise ValidationError("Every edit must include its expectedRevision integer.")
        return await run_in_threadpool(store.update, project_id, data.get("project"), revision)

    @app.get("/api/projects/{project_id}/history")
    def history(project_id: str):
        return store.history_status(project_id)

    @app.post("/api/projects/{project_id}/undo")
    def undo(project_id: str):
        return store.history_step(project_id, -1)

    @app.post("/api/projects/{project_id}/redo")
    def redo(project_id: str):
        return store.history_step(project_id, 1)

    @app.post("/api/projects/{project_id}/save")
    async def save(project_id: str, request: Request):
        data = await body(request)
        return {"path": str(await run_in_threadpool(store.save_archive, project_id, data.get("path")))}

    @app.get("/api/ideas")
    def ideas(q: str = "", category: str = "", projectId: str | None = None):
        extras = store.get(projectId)["ideas"] if projectId else []
        return {"ideas": language.search_ideas(q, category, extras)}

    @app.get("/api/lexicon")
    def lexicon(word: str = "", projectId: str | None = None):
        return language.lexicon(word, store.get(projectId) if projectId else None)

    @app.get("/api/complete")
    @app.get("/api/autocomplete")
    def complete(prefix: str = "", projectId: str | None = None, limit: int = 20):
        return {"suggestions": language.autocomplete(prefix, store.get(projectId) if projectId else None, limit)}

    @app.get("/api/language/capabilities")
    def language_capabilities():
        return language.capabilities()

    @app.get("/api/publishing/capabilities")
    def publishing_capabilities():
        return publication().capabilities()

    @app.post("/api/analyze")
    async def analyze(request: Request):
        data = await body(request)
        p = store.get(data["projectId"]) if data.get("projectId") else None
        result = await run_in_threadpool(language.analyze, data.get("text", ""), p, data.get("rules"), data.get("ruleIds"))
        if p:
            result["sourceRevision"] = p["revision"]
        if "clipId" in data and p:
            c = next((c for c in p["clips"] if c["id"] == data["clipId"]), None)
            if c:
                result["clipRevision"] = c["revision"]
        return result

    @app.post("/api/transform")
    async def transform(request: Request):
        data = await body(request)
        return await run_in_threadpool(language.transform, data.get("text", ""), data.get("type", ""), data.get("settings"))

    @app.post("/api/projects/{project_id}/assets")
    async def upload_asset(project_id: str, file: UploadFile = File(...)):
        p = store.get(project_id)
        data = await uploaded(file)
        asset = await run_in_threadpool(store.store_asset, project_id, file.filename or "asset", data, file.content_type)
        p["assets"].append(asset)
        updated = await run_in_threadpool(store.update, project_id, p, p["revision"])
        asset["url"] = f"/api/projects/{project_id}/assets/{asset['id']}"
        asset["projectRevision"] = updated["revision"]
        return asset

    @app.get("/api/projects/{project_id}/assets/{asset_id}")
    def get_asset(project_id: str, asset_id: str):
        path, asset = store.asset_path(project_id, asset_id)
        trusted_image = asset.get("mime") in {"image/png", "image/jpeg", "image/webp", "image/gif"}
        return FileResponse(path, media_type=asset.get("mime", "application/octet-stream"), filename=asset["name"],
                            content_disposition_type="inline" if trusted_image else "attachment",
                            headers={"Content-Security-Policy": "sandbox; default-src 'none'"})

    @app.post("/api/projects/{project_id}/import")
    async def import_file(project_id: str, file: UploadFile = File(...)):
        p = store.get(project_id)
        content = await uploaded(file)
        suffix = Path(file.filename or "document.txt").suffix.lower()
        scratch = store.data_dir / "imports"
        scratch.mkdir(exist_ok=True)
        fd, file_path = tempfile.mkstemp(prefix="import-", suffix=suffix, dir=scratch)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(content)
            imported = await run_in_threadpool(publication().import_document, Path(file_path))
        except (ValueError, RuntimeError, BadZipFile, ParseError, KeyError) as exc:
            raise HTTPException(422, str(exc)) from exc
        finally:
            Path(file_path).unlink(missing_ok=True)
        for asset in imported.get("assets", []):
            raw = base64.b64decode(asset["data"], validate=True)
            saved = await run_in_threadpool(store.store_asset, project_id, asset["name"], raw, asset.get("mime"), asset.get("id"))
            p["assets"].append(saved)
        if not p["tracks"]:
            p["tracks"].append({"id": uid("track_"), "name": "Imported", "role": "source", "color": "#96a5ff"})
        track = next((t for t in p["tracks"] if t.get("role") in {"reference", "source"}), p["tracks"][0])
        slot = max((c["slot"] for c in p["clips"] if c["trackId"] == track["id"]), default=-1) + 1
        clip_id = uid("clip_")
        p["clips"].append({"id": clip_id, "trackId": track["id"], "slot": slot,
                           "title": imported.get("title") or Path(file.filename).stem,
                           "document": imported.get("document") or text_document(imported.get("text", "")), "variants": [], "tags": ["imported"]})
        if not p["sections"]:
            p["sections"].append({"id": uid("section_"), "title": "Imported text", "role": "chapter", "order": 0})
        section = p["sections"][-1]
        p["placements"].append({"id": uid("placement_"), "clipId": clip_id, "sectionId": section["id"],
                                "order": max((x["order"] for x in p["placements"] if x["sectionId"] == section["id"]), default=-1) + 1})
        p["lastImport"] = {"name": file.filename, "warnings": imported.get("warnings", []), "clipId": clip_id, "createdAt": now()}
        if p.get("book"):
            p["book"]["chapters"].append({"id": uid("chapter_"), "title": imported.get("title") or Path(file.filename).stem,
                "document": p["clips"][-1]["document"], "text": "", "include": True, "role": "chapter", "voiceId": None})
        return await run_in_threadpool(store.update, project_id, p, p["revision"])

    @app.get("/api/projects/{project_id}/preview", response_class=HTMLResponse)
    async def preview(project_id: str):
        p = store.get(project_id)
        html = await run_in_threadpool(publication().render_html, p, {"assetRoot": store.asset_dir(project_id)})
        return HTMLResponse(html, headers={"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data: 'self'; font-src data: 'self'; base-uri 'none'; frame-ancestors 'self' http://localhost:5173 http://127.0.0.1:5173 http://localhost:4173 http://127.0.0.1:4173 alder:"})

    @app.get("/api/speech/jobs/{job_id}/subtitles")
    async def reading_subtitles(job_id: str, format: str = "srt"):
        from .reading import subtitles
        job = speech.get_job(job_id)
        if job["status"] != "ready":
            raise ValidationError("Complete the narration before exporting timed text.")
        text = subtitles(job, format)
        return Response(text, media_type="text/plain; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="narration.{format}"'})

    @app.post("/api/projects/{project_id}/export")
    async def export(project_id: str, request: Request):
        data = await body(request)
        p = store.get(project_id)
        export_id = uid("export_")
        directory = store.data_dir / "exports" / export_id
        directory.mkdir(parents=True)
        options = dict(data.get("options") or {})
        options["assetRoot"] = store.asset_dir(project_id)
        try:
            result = await run_in_threadpool(publication().build_export, p, str(data.get("format", "txt")).lower(), directory, options)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc
        path = Path(result["path"]).resolve()
        if not path.is_relative_to(directory.resolve()) or not path.is_file():
            raise HTTPException(500, "The export component returned an invalid file reference.")
        result.update({"id": export_id, "projectId": project_id, "sourceRevision": p["revision"], "downloadUrl": f"/api/exports/{export_id}"})
        store._atomic_bytes(directory / "result.json", json.dumps(result, default=str).encode("utf-8"))
        return result

    @app.post("/api/projects/{project_id}/definition-export")
    async def definition_export(project_id: str, request: Request):
        data = await body(request)
        p = store.get(project_id)
        entry = data.get("entry")
        if not isinstance(entry, dict):
            raise ValidationError("A definition card requires a dictionary entry.")
        export_id = uid("export_")
        directory = store.data_dir / "exports" / export_id
        directory.mkdir(parents=True)
        try:
            from .definition_cards import build_definition_export
            result = await run_in_threadpool(build_definition_export, entry, str(data.get("format", "png")).lower(), directory, data.get("options"))
        except ImportError as exc:
            raise HTTPException(503, "The definition-card component is unavailable in this build.") from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc
        path = Path(result["path"]).resolve()
        if not path.is_relative_to(directory.resolve()) or not path.is_file():
            raise HTTPException(500, "The definition-card component returned an invalid file reference.")
        result.update({"id": export_id, "projectId": project_id, "sourceRevision": p["revision"], "downloadUrl": f"/api/exports/{export_id}"})
        store._atomic_bytes(directory / "result.json", json.dumps(result, default=str).encode("utf-8"))
        return result

    @app.get("/api/exports/{export_id}")
    def exported_file(export_id: str):
        if not re.fullmatch(r"export_[a-f0-9]{32}", export_id):
            raise KeyError("Export does not exist.")
        directory = (store.data_dir / "exports" / export_id).resolve()
        manifest = directory / "result.json"
        if not manifest.is_file():
            raise KeyError("Export does not exist.")
        result = json.loads(manifest.read_text("utf-8"))
        path = Path(result["path"]).resolve()
        if not path.is_relative_to(directory) or not path.is_file():
            raise KeyError("Export file is missing.")
        return FileResponse(path, media_type=result["mime"], filename=result["filename"])

    @app.get("/api/speech/capabilities")
    def speech_capabilities():
        return speech.capabilities() if speech else {"available": False, "message": speech_error}

    @app.get("/api/speech/voices")
    def voices():
        return {"voices": speech_service().voices()}

    @app.post("/api/speech/voices")
    async def add_voice(file: UploadFile = File(...), name: str = Form("Reference voice")):
        content = await uploaded(file, 32 * 1024 * 1024)
        suffix = Path(file.filename or "reference.wav").suffix.lower()
        if suffix not in {".wav", ".mp3", ".flac", ".ogg", ".m4a"}:
            raise ValidationError("Choose a WAV, MP3, FLAC, OGG, or M4A voice reference.")
        fd, filename = tempfile.mkstemp(prefix="alder-voice-", suffix=suffix)
        try:
            with os.fdopen(fd, "wb") as out:
                out.write(content)
            return await run_in_threadpool(speech_service().add_voice, Path(filename), name)
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(422, str(exc)) from exc
        finally:
            Path(filename).unlink(missing_ok=True)

    @app.post("/api/projects/{project_id}/speech")
    async def submit_speech(project_id: str, request: Request):
        data = await body(request)
        try:
            return await run_in_threadpool(speech_service().submit, store.get(project_id), data)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc

    @app.get("/api/projects/{project_id}/speech")
    def speech_jobs(project_id: str):
        p = store.get(project_id)
        jobs = speech_service().list_jobs(project_id)
        for job in jobs:
            job["stale"] = job.get("sourceRevision") != p["revision"]
        return {"jobs": jobs}

    @app.get("/api/speech/jobs/{job_id}")
    def speech_job(job_id: str):
        return speech_service().get_job(job_id)

    @app.post("/api/speech/jobs/{job_id}/cancel")
    def cancel_speech(job_id: str):
        return speech_service().cancel(job_id)

    @app.post("/api/speech/jobs/{job_id}/resume")
    def resume_speech(job_id: str):
        try:
            return speech_service().resume(job_id)
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.post("/api/speech/jobs/{job_id}/review")
    def review_speech(job_id: str, body: dict):
        try:
            return speech_service().review(job_id, body)
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.get("/api/speech/jobs/{job_id}/audio")
    def speech_audio(job_id: str):
        path = speech_service().audio_path(job_id)
        return FileResponse(path, media_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream", filename=path.name, content_disposition_type="inline")

    @app.get("/api/speech/jobs/{job_id}/chunks/{chunk_id}")
    def speech_chunk(job_id: str, chunk_id: str):
        path = speech_service().audio_path(job_id, chunk_id)
        return FileResponse(path, media_type="audio/wav", filename=path.name, content_disposition_type="inline")

    return app


app = create_app()
