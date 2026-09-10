"""Prepare portable offline speech and content-check resources for Alder builds.

This is a developer build helper, not an end-user setup step. It copies an
already verified Chatterbox and Faster Whisper installation without upgrading
dependencies or accessing the network. Supply explicit paths for other builders.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time


PROJECT = Path(__file__).resolve().parents[1]
LOCAL = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local/share"))) / "chatterbox"


def base_python(runtime: Path):
    config = runtime / "pyvenv.cfg"
    if not config.is_file():
        raise ValueError(f"Expected a verified Python environment: {runtime}")
    settings = {key.strip(): value.strip() for line in config.read_text().splitlines() if "=" in line for key, value in [line.split("=", 1)]}
    source = Path(settings.get("home", ""))
    if not (source / "python.exe").is_file():
        raise ValueError("The source environment's standalone Windows Python base could not be located.")
    return source


def snapshot(repository: Path):
    reference = repository / "refs/main"
    if reference.is_file():
        candidate = repository / "snapshots" / reference.read_text().strip()
        if candidate.is_dir():
            return candidate
    candidate = next((p for p in sorted((repository / "snapshots").glob("*")) if p.is_dir()), None)
    if candidate is None:
        raise ValueError(f"A cached local model snapshot is required: {repository.name}")
    return candidate


def copy_runtime(source: Path, target: Path, output_root: Path):
    ignore = shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo", "direct_url.json", "*.egg-link")
    shutil.copytree(base_python(source), target, dirs_exist_ok=True, ignore=ignore)
    source_packages = source / "Lib/site-packages"
    packages = target / "Lib/site-packages"
    shutil.copytree(source_packages, packages, dirs_exist_ok=True, ignore=ignore)
    # Strip relocation-sensitive metadata and stale test bytecode from previous
    # builds. Every removal is a file inside the explicitly resolved output root.
    removable = list(target.rglob("*.pyc")) + list(target.rglob("*.pyo")) + list(target.rglob("direct_url.json")) + list(target.rglob("*.egg-link"))
    removable.append(packages / "_virtualenv.pth")
    for path in removable:
        if path.is_file():
            if not path.resolve().is_relative_to(output_root.resolve()):
                raise ValueError("A runtime cleanup target escaped the output directory.")
            path.unlink()
    return {dist.metadata["Name"]: dist.version for dist in importlib.metadata.distributions(path=[str(source_packages)]) if dist.metadata.get("Name")}


def copy_model(source: Path, target: Path, required):
    target.mkdir(parents=True, exist_ok=True)
    for name in required:
        if not (source / name).is_file():
            raise ValueError(f"The source model is incomplete: missing {name}")
        shutil.copyfile(source / name, target / name)
    revision_file = source / "revision.txt"
    revision = revision_file.read_text().strip() if revision_file.is_file() else source.name
    (target / "revision.txt").write_text(revision, encoding="utf-8")
    return revision


def inspect_portability(root: Path):
    for path in root.rglob("*.pth"):
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            if line.strip() and not line.startswith(("import ", "#")) and (re.match(r"^[A-Za-z]:[/\\]", line) or line.startswith(("/", "\\"))):
                raise ValueError(f"Nonportable package path in {path.relative_to(root)}")
    if (root / "python/pyvenv.cfg").exists() or (root / "qa/python/pyvenv.cfg").exists():
        raise ValueError("Packaged interpreters must be standalone, not virtualenv launchers.")


def verify_runtime(root: Path):
    environment = os.environ.copy()
    environment.update({"PYTHONPATH": "", "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1", "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"})
    checks = [(root / "python/python.exe", "import chatterbox,torch; modules=[chatterbox,torch]"), (root / "qa/python/python.exe", "import faster_whisper,ctranslate2; modules=[faster_whisper,ctranslate2]")]
    for executable, imports in checks:
        code = "import sys;from pathlib import Path;" + imports + ";root=Path(sys.argv[1]).resolve();assert Path(sys.base_prefix).resolve().is_relative_to(root);assert all(Path(m.__file__).resolve().is_relative_to(root) for m in modules);print('Portable runtime imports verified.')"
        subprocess.run([str(executable), "-c", code, str(root)], check=True, env=environment, timeout=120, **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=PROJECT / "work/bundle-resources/speech")
    parser.add_argument("--synthesis-runtime", type=Path, default=LOCAL / "venv")
    parser.add_argument("--qa-runtime", type=Path, default=LOCAL / "qa-venv")
    parser.add_argument("--chatterbox-source", type=Path, default=PROJECT / "chatterbox")
    parser.add_argument("--turbo-model", type=Path)
    parser.add_argument("--qa-model", type=Path)
    parser.add_argument("--ffmpeg-directory", type=Path)
    parser.add_argument("--verify", action="store_true", help="Verify bundled interpreter and import paths, without inference.")
    args = parser.parse_args()
    output = args.output.resolve()
    if output in (PROJECT.resolve(), Path(output.anchor)):
        raise ValueError("Choose a dedicated resource output directory.")
    for source in (args.synthesis_runtime.resolve(), args.qa_runtime.resolve(), args.chatterbox_source.resolve()):
        if output == source or source.is_relative_to(output) or output.is_relative_to(source):
            raise ValueError("The resource output must be separate from source installations.")
    turbo = args.turbo_model or snapshot(LOCAL / "huggingface/hub/models--ResembleAI--chatterbox-turbo")
    qa_model = args.qa_model or snapshot(LOCAL / "qa-models/models--Systran--faster-whisper-base.en")
    ffmpeg_dir = args.ffmpeg_directory or next((p.parent for p in sorted((LOCAL / "ffmpeg").glob("*/bin/ffmpeg.exe"))), None)
    if ffmpeg_dir is None or not all((ffmpeg_dir / name).is_file() for name in ("ffmpeg.exe", "ffprobe.exe")):
        raise ValueError("The verified FFmpeg and ffprobe build is required.")
    started = time.monotonic()
    output.mkdir(parents=True, exist_ok=True)
    synthesis_deps = copy_runtime(args.synthesis_runtime, output / "python", output)
    source_target = output / "chatterbox/src"
    shutil.copytree(args.chatterbox_source / "src", source_target, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"))
    for path in list(source_target.rglob("*.pyc")) + list(source_target.rglob("*.pyo")):
        if not path.resolve().is_relative_to(output):
            raise ValueError("A source bytecode cleanup target escaped the output directory.")
        path.unlink()
    shutil.copyfile(args.chatterbox_source / "LICENSE", output / "chatterbox/LICENSE")
    editable_paths = list((output / "python/Lib/site-packages").glob("__editable__.chatterbox_tts-*.pth"))
    if not editable_paths:
        editable_paths = [output / "python/Lib/site-packages/alder-chatterbox.pth"]
    for editable_path in editable_paths:
        editable_path.write_text("../../../chatterbox/src\n", encoding="utf-8")
    turbo_revision = copy_model(turbo, output / "models/turbo", ("ve.safetensors", "t3_turbo_v1.safetensors", "s3gen_meanflow.safetensors", "conds.pt", "added_tokens.json", "merges.txt", "special_tokens_map.json", "tokenizer_config.json", "vocab.json"))
    qa_deps = copy_runtime(args.qa_runtime, output / "qa/python", output)
    qa_revision = copy_model(qa_model, output / "qa/models/base.en", ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt"))
    (output / "ffmpeg").mkdir(exist_ok=True)
    for name in ("ffmpeg.exe", "ffprobe.exe"):
        shutil.copyfile(ffmpeg_dir / name, output / "ffmpeg" / name)
    for name in ("LICENSE", "README.txt"):
        if (ffmpeg_dir.parent / name).is_file():
            shutil.copyfile(ffmpeg_dir.parent / name, output / "ffmpeg" / name)
    # Source cache keys describe content, never developer installation paths.
    digest = hashlib.sha256()
    for path in sorted(source_target.rglob("*.py")):
        digest.update(path.relative_to(source_target).as_posix().encode())
        digest.update(path.read_bytes())
    inspect_portability(output)
    if args.verify:
        verify_runtime(output)
    manifest = {"schemaVersion": 1, "turboRevision": turbo_revision, "qaRevision": qa_revision, "sourceFingerprint": digest.hexdigest(), "synthesisDependencies": synthesis_deps, "qaDependencies": qa_deps, "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "sizeBytes": sum(path.stat().st_size for path in output.rglob("*") if path.is_file()), "buildSeconds": round(time.monotonic() - started, 2), "portableImportsVerified": args.verify}
    (output / "bundle-manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps({key: value for key, value in manifest.items() if key not in ("synthesisDependencies", "qaDependencies")}))


if __name__ == "__main__":
    main()
