"""Prepare the pinned portable core Python and offline WordNet for Alder builds.

Build-time helper only. The finished app never invokes pip or downloads data.
An existing verified venv supplies application packages. CPython is copied from
its verified standalone base or the checksum-pinned official archive. File
content hashes avoid recopying unchanged resources and detect stale payloads.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import time
import urllib.request
import zipfile


PROJECT = Path(__file__).resolve().parents[1]
PYTHON_SOURCE = {
    "id": "cpython", "version": "3.11.16", "build": "20260901", "platform": "windows-x64",
    "name": "cpython-3.11.16-20260901-windows-x64-stripped.tar.gz",
    "url": "https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.11.16%2B20260901-x86_64-pc-windows-msvc-install_only_stripped.tar.gz",
    "sha256": "06cbe479e039f5b9cb5640c286d790074d63f549f92a32d599a3748293bd4510",
    "checksumSource": "https://api.github.com/repos/astral-sh/python-build-standalone/releases/tags/20260901",
    "buildSource": "https://github.com/astral-sh/python-build-standalone/tree/20260901",
    "pythonSource": "https://www.python.org/downloads/release/python-31116/",
    "licensePath": "python/LICENSE.txt",
}
NLTK_REVISION = "550b6625bcef1f2abff2ff770a5a0d272c9c6b2a"
DATA_SOURCES = [
    {"id": "wordnet", "version": "3.0", "name": "wordnet.zip", "sha256": "cbda5ea6eef7f36a97a43d4a75f85e07fccbb4f23657d27b4ccbc93e2646ab59",
     "license": "Princeton WordNet licence; retained inside wordnet/LICENSE"},
    {"id": "omw-1.4", "version": "1.4", "name": "omw-1.4.zip", "sha256": "3b941e664852f3297b6040236626065796a2aaf7d7f9eec8779a3beaa1096c2d",
     "license": "Open Multilingual Wordnet component licences; retained inside the original archive"},
    {"id": "omw-2.0", "version": "2.0", "name": "omw-2.0.zip", "sha256": "049c0de0a2d097f6d4d1c97394ea8422bba1faaa30f92e054f18efdb534423ed",
     "license": "Open Multilingual Wordnet component licences; retained inside the original archive"},
]
for _dataset in DATA_SOURCES:
    _dataset.update({"repositoryRevision": NLTK_REVISION,
                     "url": f"https://raw.githubusercontent.com/nltk/nltk_data/{NLTK_REVISION}/packages/corpora/{_dataset['name']}",
                     "checksumSource": f"https://raw.githubusercontent.com/nltk/nltk_data/{NLTK_REVISION}/index.xml"})


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def read_lock(path):
    result = {}
    for line in Path(path).read_text("utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(r"([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+!-]+)", line)
        if not match:
            raise ValueError("The core lock must contain exact name==version requirements only.")
        name, version = match.groups()
        if canonical(name) in result:
            raise ValueError("Duplicate package in the core lock: " + name)
        result[canonical(name)] = version
    if not result:
        raise ValueError("The core dependency lock is empty.")
    return result


def subprocess_options():
    return {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}


def source_environment(runtime, requirements=None):
    executable = runtime / "Scripts/python.exe" if (runtime / "pyvenv.cfg").exists() else runtime / "python.exe"
    if not executable.is_file() or not (runtime / "Lib/site-packages").is_dir():
        raise ValueError("Provide a verified Windows Python environment with Lib/site-packages.")
    code = """import importlib.metadata,json,sys
from pathlib import Path
from packaging.requirements import Requirement
errors=[]
if len(sys.argv)>1:
    for line in Path(sys.argv[1]).read_text('utf-8-sig').splitlines():
        line=line.strip()
        if not line or line.startswith('#'): continue
        requirement=Requirement(line)
        if requirement.marker and not requirement.marker.evaluate(): continue
        try: version=importlib.metadata.version(requirement.name)
        except importlib.metadata.PackageNotFoundError: errors.append(requirement.name+' is missing'); continue
        if not requirement.specifier.contains(version,prereleases=True): errors.append(str(requirement)+' excludes '+version)
print(json.dumps({'python':sys.version.split()[0],'base':sys.base_prefix,'packages':{d.metadata['Name']:d.version for d in importlib.metadata.distributions() if d.metadata.get('Name')},'requirementsErrors':errors}))"""
    process = subprocess.run([str(executable), "-I", "-B", "-c", code] + ([str(requirements)] if requirements else []), capture_output=True, text=True, check=True, timeout=60, **subprocess_options())
    return json.loads(process.stdout)


def validate_versions(actual, lock):
    packages = {canonical(name): version for name, version in actual.items()}
    differences = [f"{name}: expected {version}, found {packages.get(name, 'missing')}" for name, version in lock.items() if packages.get(name) != version]
    unpinned = sorted(set(packages) - set(lock) - {"pip", "setuptools", "wheel"})
    if differences or unpinned:
        raise ValueError("Core environment does not match requirements-core.lock.txt. " + "; ".join(differences + (["Unpinned packages: " + ", ".join(unpinned)] if unpinned else [])))


def safe_target(root, relative):
    path = PurePosixPath(relative)
    if path.is_absolute() or ".." in path.parts or "\\" in str(relative) or re.match(r"^[A-Za-z]:", str(relative)):
        raise ValueError("Unsafe resource path: " + str(relative))
    destination = root / Path(*path.parts)
    if not destination.resolve().is_relative_to(root.resolve()):
        raise ValueError("A resource path escaped its output root.")
    return destination


def download_resource(item, cache, offline=False, existing=None):
    destination = cache / item["name"]
    if destination.is_file():
        if sha256(destination) != item["sha256"]:
            raise ValueError("Cached resource checksum mismatch: " + item["name"])
        return destination
    if existing and existing.is_file() and sha256(existing) == item["sha256"]:
        # A previously verified bundle already contains this exact corpus. Do
        # not create a duplicate cache copy solely to prepare it again.
        return existing
    if offline:
        raise ValueError("Offline build is missing the pinned resource: " + item["name"])
    cache.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".partial")
    request = urllib.request.Request(item["url"], headers={"User-Agent": "Alder-resource-builder/0.1"})
    with urllib.request.urlopen(request, timeout=180) as response, partial.open("wb") as target:
        shutil.copyfileobj(response, target, length=1024 * 1024)
    if sha256(partial) != item["sha256"]:
        partial.unlink(missing_ok=True)
        raise ValueError("Downloaded resource checksum mismatch: " + item["name"])
    partial.replace(destination)
    return destination


def ignore_file(relative):
    path = PurePosixPath(relative)
    return ("__pycache__" in path.parts or path.suffix.lower() in (".pyc", ".pyo", ".pdb", ".egg-link") or
            path.name in ("direct_url.json", "_virtualenv.pth", "_virtualenv.py", "pyvenv.cfg") or path.name.startswith("__editable__"))


def copy_if_changed(source, destination, digest=None):
    digest = digest or sha256(source)
    if destination.is_file() and destination.stat().st_size == source.stat().st_size and sha256(destination) == digest:
        return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return True


def prepare_python(base, packages, archive_path, target):
    """Only materialise pinned base files and the locked package environment."""
    records, copied, skipped = {}, 0, 0
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            if not member.isfile() or not member.name.startswith("python/"):
                continue
            relative = member.name[7:]
            if relative.startswith(("Lib/site-packages/", "Scripts/")) or ignore_file(relative):
                continue
            destination = safe_target(target, relative)
            payload = archive.extractfile(member).read()
            digest = hashlib.sha256(payload).hexdigest()
            source = base / Path(*PurePosixPath(relative).parts) if base else None
            if source and source.is_file() and sha256(source) != digest:
                raise ValueError(f"The local standalone Python differs from the pinned official build: {relative}")
            if destination.is_file() and destination.stat().st_size == len(payload) and sha256(destination) == digest:
                skipped += 1
            elif source and source.is_file():
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
                copied += 1
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(payload)
                copied += 1
            records[relative] = {"sha256": digest, "bytes": len(payload), "source": "cpython-standalone"}
    for source in sorted(packages.rglob("*")):
        if not source.is_file():
            continue
        relative = "Lib/site-packages/" + source.relative_to(packages).as_posix()
        if ignore_file(relative):
            continue
        if source.is_symlink():
            raise ValueError("Core packages must be materialised files, not links to external installations.")
        destination = safe_target(target, relative)
        digest = sha256(source)
        if copy_if_changed(source, destination, digest):
            copied += 1
        else:
            skipped += 1
        records[relative] = {"sha256": digest, "bytes": source.stat().st_size, "source": "locked-core-environment"}
    removed = 0
    for existing in target.rglob("*"):
        if existing.is_file() and existing.relative_to(target).as_posix() not in records:
            # This is a generated payload; delete only checked individual files
            # inside its resolved runtime directory. Never touch the sources.
            if not existing.resolve().is_relative_to(target.resolve()):
                raise ValueError("A stale payload path escaped the generated runtime.")
            existing.unlink()
            removed += 1
    return records, {"copied": copied, "unchanged": skipped, "removedStale": removed}


def inspect_path_files(runtime):
    for path in runtime.rglob("*.pth"):
        for line in path.read_text("utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("import "):
                if path.name != "distutils-precedence.pth" or "_distutils_hack" not in line:
                    raise ValueError("Unreviewed executable .pth file in the runtime: " + path.name)
            else:
                candidate = (path.parent / line).resolve()
                if not candidate.is_relative_to(runtime.resolve()) or re.match(r"^[A-Za-z]:[/\\]", line) or line.startswith(("/", "\\")):
                    raise ValueError("Nonportable import path in " + path.name)
    if (runtime / "pyvenv.cfg").exists():
        raise ValueError("The packaged interpreter must be standalone, not a virtualenv launcher.")


def verify_runtime(output):
    environment = os.environ.copy()
    for key in ("PYTHONHOME", "PYTHONPATH", "PYTHONUSERBASE", "VIRTUAL_ENV", "CONDA_PREFIX"):
        environment.pop(key, None)
    environment.update({"PATH": "", "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1", "NLTK_DATA": str(output / "nltk_data")})
    code = r'''
import importlib, json, site, socket, sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
runtime = root / 'python'
assert Path(sys.base_prefix).resolve() == runtime, 'Python base escaped the bundle'
paths = []
for entry in sys.path:
    if entry:
        resolved = Path(entry).resolve()
        assert resolved.is_relative_to(runtime), 'Import path escaped the bundle: ' + entry
        paths.append(resolved.relative_to(root).as_posix())
assert not site.ENABLE_USER_SITE, 'User packages remain enabled'
def blocked_network(*args, **kwargs):
    raise AssertionError('The offline core audit attempted a network connection')
socket.socket.connect = blocked_network
socket.socket.connect_ex = blocked_network
socket.create_connection = blocked_network
names = ['fastapi','uvicorn','httpx','multipart','docx','bs4','markdown_it','reportlab','pypdf','PIL','pyphen','nltk','spellchecker','cmudict','lxml','sqlite3','ssl']
modules = {}
for name in names:
    module = importlib.import_module(name)
    location = Path(module.__file__).resolve()
    assert location.is_relative_to(runtime), name + ' escaped the bundle'
    modules[name] = location.relative_to(root).as_posix()
import nltk
nltk.data.path[:] = [str(root / 'nltk_data')]
from nltk.corpus import wordnet
wordnet.ensure_loaded()
assert wordnet.synsets('language'), 'Bundled WordNet lookup failed'
assert next(wordnet.all_lemma_names(lang='spa'), None), 'Bundled multilingual WordNet is unavailable'
import sqlite3
db = sqlite3.connect(':memory:')
assert db.execute('select 1').fetchone() == (1,)
print(json.dumps({'status':'passed','python':sys.version.split()[0],'sysPath':paths,'modules':modules,'wordnet':wordnet.get_version(),'omw':'2.0','additionalLemmaLanguage':'spa','userSiteEnabled':site.ENABLE_USER_SITE,'externalPath':'','networkConnections':'blocked during audit'}))
'''
    result = subprocess.run([str(output / "python/python.exe"), "-I", "-B", "-c", code, str(output)], capture_output=True, text=True, encoding="utf-8", errors="replace", env=environment, timeout=120, **subprocess_options())
    if result.returncode:
        raise RuntimeError("Portable core runtime audit failed:\n" + result.stdout + result.stderr)
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-runtime", type=Path, default=PROJECT / "work/venv")
    parser.add_argument("--base-python", type=Path, help="Existing matching standalone base; inferred from the source environment when omitted.")
    parser.add_argument("--archive-base", action="store_true", help="Use the official standalone archive instead of validating/copying a local base.")
    parser.add_argument("--output", type=Path, default=PROJECT / "work/bundle-resources")
    parser.add_argument("--cache", type=Path, default=PROJECT / "work/core-downloads")
    parser.add_argument("--lock", type=Path, default=PROJECT / "requirements-core.lock.txt")
    parser.add_argument("--requirements", type=Path, default=PROJECT / "requirements.txt")
    parser.add_argument("--offline", action="store_true", help="Use verified cached archives and existing corpora without network access.")
    parser.add_argument("--verify-only", action="store_true", help="Audit the existing generated runtime without changing its files.")
    args = parser.parse_args()
    output, source, cache = args.output.resolve(), args.source_runtime.resolve(), args.cache.resolve()
    if output in (PROJECT.resolve(), Path(output.anchor)) or source == output or source.is_relative_to(output) or output.is_relative_to(source):
        raise ValueError("Choose a dedicated resource output directory separate from source installations.")
    if args.verify_only:
        inspect_path_files(output / "python")
        print(json.dumps(verify_runtime(output), indent=2))
        return
    details = source_environment(source, args.requirements)
    if details["requirementsErrors"]:
        raise ValueError("The environment conflicts with requirements.txt: " + "; ".join(details["requirementsErrors"]))
    if details["python"] != PYTHON_SOURCE["version"]:
        raise ValueError("Use CPython " + PYTHON_SOURCE["version"] + " for this pinned resource build.")
    lock = read_lock(args.lock)
    validate_versions(details["packages"], lock)
    base = None if args.archive_base else (args.base_python or Path(details["base"])).resolve()
    if base and (base == output or base.is_relative_to(output) or output.is_relative_to(base)):
        raise ValueError("The resource output and source Python base must not overlap.")
    started = time.monotonic()
    output.mkdir(parents=True, exist_ok=True)
    archive = download_resource(PYTHON_SOURCE, cache, args.offline)
    records, counts = prepare_python(base, source / "Lib/site-packages", archive, output / "python")
    data_manifest = []
    for dataset in DATA_SOURCES:
        destination = output / "nltk_data/corpora" / dataset["name"]
        resource = download_resource(dataset, cache, args.offline, destination)
        with zipfile.ZipFile(resource) as package:
            if package.testzip() is not None or not any(name.startswith(dataset["id"]+"/") for name in package.namelist()):
                raise ValueError("The pinned corpus archive is invalid: " + dataset["id"])
        copied = copy_if_changed(resource, destination) if resource.resolve() != destination.resolve() else False
        data_manifest.append({**dataset, "path":destination.relative_to(output).as_posix(), "copied":copied})
    inspect_path_files(output / "python")
    audit = verify_runtime(output)
    manifest = {"schemaVersion":1,"preparedAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"python":PYTHON_SOURCE,
                "lock":{"name":args.lock.name,"sha256":sha256(args.lock),"packages":lock},
                "requirements":{"name":args.requirements.name,"sha256":sha256(args.requirements),"compatible":True},
                "packageSources":{name:{"version":version,"index":"https://pypi.org/project/"+name+"/"+version+"/"} for name,version in lock.items()},
                "bootstrapPackages":{name:version for name,version in details["packages"].items() if canonical(name) in ("pip","setuptools","wheel")},
                "datasets":data_manifest,"files":records,"copyCounts":counts,"verification":audit,"buildSeconds":round(time.monotonic()-started,2)}
    (output / "core-resource-manifest.json").write_text(json.dumps(manifest,indent=2,sort_keys=True),"utf-8")
    (output / "core-runtime-audit.json").write_text(json.dumps(audit,indent=2),"utf-8")
    print(json.dumps({"status":"passed","python":details["python"],"packages":len(lock),"files":len(records),"copyCounts":counts,"buildSeconds":manifest["buildSeconds"],"manifest":"core-resource-manifest.json"},indent=2))


if __name__ == "__main__":
    main()
