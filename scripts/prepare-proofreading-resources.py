"""Provision pinned proofreading data outside the checkout, including offline cache reuse."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import urllib.request
import zipfile
import os
import uuid

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(4 * 1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def fetch(record, cache, offline):
    path = cache / record["name"]
    if path.is_file() and digest(path) == record["sha256"]:
        return path
    if offline:
        raise RuntimeError("Verified offline resource missing: " + record["name"])
    partial = path.with_suffix(path.suffix + ".part")
    if partial.is_file() and digest(partial) == record["sha256"]:
        partial.replace(path)
        return path
    offset = partial.stat().st_size if partial.exists() else 0
    headers = {"User-Agent": "Mozilla/5.0 Alder-resource-builder"}
    if offset:
        headers["Range"] = f"bytes={offset}-"
    request = urllib.request.Request(record["url"], headers=headers)
    with urllib.request.urlopen(request, timeout=120) as response:
        append = offset and response.status == 206 and response.headers.get("Content-Range", "").startswith(f"bytes {offset}-")
        with partial.open("ab" if append else "wb") as target:
            shutil.copyfileobj(response, target, 4 * 1024 * 1024)
    if digest(partial) != record["sha256"]:
        partial.unlink(missing_ok=True)
        raise RuntimeError("Resource checksum mismatch: " + record["name"])
    partial.replace(path)
    return path


def prepare(output, cache, offline=False, rules_only=False):
    output, cache = Path(output).resolve(), Path(cache).resolve()
    if output.is_relative_to(ROOT) or cache.is_relative_to(ROOT):
        raise ValueError("Generate proofreading data outside the source checkout.")
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / "resources/manifests/proofreading.json").read_text("utf-8"))
    archive = fetch(manifest["rules"], cache, offline)
    destination = output / "languagetool"
    receipt = output / "rules-inventory.json"
    ownership = output / "proofreading-owner.json"
    owned = False
    try:
        owned = json.loads(ownership.read_text("utf-8")) == {"owner": "Alder proofreading resources", "schemaVersion": 1}
    except (OSError, ValueError):
        pass
    if destination.exists() and not receipt.is_file() and not owned:
        raise ValueError("Refusing to replace an unowned grammar resource directory.")
    ownership.write_text(json.dumps({"owner": "Alder proofreading resources", "schemaVersion": 1}), "utf-8")
    valid = False
    if receipt.exists():
        try:
            previous = json.loads(receipt.read_text("utf-8"))
        except (OSError, ValueError):
            previous = {}
        if not isinstance(previous, dict):
            previous = {}
        valid = previous.get("archive") == manifest["rules"]["sha256"] and isinstance(previous.get("files"), dict) and bool(previous.get("files")) and all(
            (destination / path).resolve().is_relative_to(destination.resolve()) and
            (destination / path).is_file() and digest(destination / path) == checksum
            for path, checksum in previous.get("files", {}).items()) and (destination / "languagetool-server.jar").is_file()
    if not valid:
        with tempfile.TemporaryDirectory(prefix="proofreading-stage-", dir=output.parent) as temporary:
            stage = Path(temporary)
            with zipfile.ZipFile(archive) as package:
                for member in package.infolist():
                    target = (stage / member.filename).resolve()
                    if not target.is_relative_to(stage.resolve()) or (member.external_attr >> 16) & 0o170000 == 0o120000:
                        raise ValueError("Unsafe resource archive entry")
                package.extractall(stage)
            unpacked = stage / ("LanguageTool-" + manifest["rulesVersion"])
            if not (unpacked / "languagetool-server.jar").is_file():
                raise RuntimeError("The grammar archive is incomplete")
            # Keep the previous verified directory for rollback. Never remove arbitrary content.
            previous_directory = output / ("languagetool-previous-" + uuid.uuid4().hex)
            if destination.exists():
                resolved = destination.resolve()
                if resolved.parent != output or destination.is_symlink():
                    raise ValueError("Unexpected grammar resource destination")
                destination.rename(previous_directory)
            try:
                shutil.move(str(unpacked), str(destination))
            except BaseException:
                if previous_directory.exists() and not destination.exists():
                    previous_directory.rename(destination)
                raise
        inventory = {path.relative_to(destination).as_posix(): digest(path)
                     for path in destination.rglob("*") if path.is_file()}
        temporary_receipt = receipt.with_suffix(".tmp")
        temporary_receipt.write_text(json.dumps({"archive": manifest["rules"]["sha256"], "files": inventory}, indent=2), "utf-8")
        temporary_receipt.replace(receipt)
    if not rules_only:
        model = fetch(manifest["model"], cache, offline)
        target = output / manifest["model"]["file"]
        if not target.resolve().is_relative_to(output):
            raise ValueError("Unexpected grammar model destination")
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or digest(target) != manifest["model"]["sha256"]:
            temporary = target.with_suffix(".part")
            shutil.copyfile(model, temporary)
            temporary.replace(target)
    notices = output / "notices"
    if not notices.resolve().is_relative_to(output):
        raise ValueError("Unexpected grammar notices destination")
    notices.mkdir(exist_ok=True)
    for record in manifest.get("notices", []):
        shutil.copyfile(fetch(record, cache, offline), notices / record["name"])
    (notices / "COMPONENTS.txt").write_text(
        "LanguageTool 6.6: see ../languagetool/COPYING.txt and bundled component notices.\n"
        "Source: " + manifest["rules"]["sourceUrl"] + "\n"
        "Qwen3.5 model: Apache-2.0; see Qwen3.5-LICENSE.txt.\n"
        "Quantized artifact: " + manifest["model"]["url"] + "\n"
        "llama-cpp-python: MIT; installed distribution includes its licence.\n", "utf-8")
    temporary_manifest = output / "manifest.json.tmp"
    temporary_manifest.write_text(json.dumps(manifest, indent=2) + "\n", "utf-8")
    os.replace(temporary_manifest, output / "manifest.json")
    return {"status": "passed", "resources": str(output), "rulesVersion": manifest["rulesVersion"],
            "modelData": not rules_only, "pythonRuntime": "provision separately", "inferenceVerified": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--rules-only", action="store_true")
    options = parser.parse_args()
    print(json.dumps(prepare(options.output, options.cache, options.offline, options.rules_only)))
