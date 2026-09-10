"""Fast builder checks using small fixtures; no network or installed tools."""
import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile

import pytest


spec = importlib.util.spec_from_file_location("alder_core_builder", Path(__file__).resolve().parents[2] / "scripts/prepare-core-resources.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def test_locked_versions_reject_drift_and_unreviewed_packages():
    builder.validate_versions({"Python_Docx":"1.2.0","pip":"26.0"},{"python-docx":"1.2.0"})
    with pytest.raises(ValueError,match="expected 1.2.0"):
        builder.validate_versions({"python-docx":"1.1.0"},{"python-docx":"1.2.0"})
    with pytest.raises(ValueError,match="Unpinned packages"):
        builder.validate_versions({"python-docx":"1.2.0","unreviewed":"1"},{"python-docx":"1.2.0"})


@pytest.mark.parametrize("name", ["../escape", "/absolute", "C:/absolute", "folder\\escape"])
def test_resource_targets_stay_inside_output(tmp_path, name):
    with pytest.raises(ValueError,match="Unsafe resource path"):
        builder.safe_target(tmp_path,name)


def test_incremental_copy_does_not_rewrite_unchanged_files(tmp_path):
    source, target = tmp_path / "source", tmp_path / "target"
    source.write_bytes(b"Verified content")
    assert builder.copy_if_changed(source,target)
    original = target.stat().st_mtime_ns
    assert not builder.copy_if_changed(source,target)
    assert target.stat().st_mtime_ns == original
    source.write_bytes(b"Changed content")
    assert builder.copy_if_changed(source,target)


def test_cached_resource_hash_is_checked_offline(tmp_path):
    cached = tmp_path / "resource.zip"
    cached.write_bytes(b"Pinned archive")
    resource = {"name":cached.name,"sha256":hashlib.sha256(cached.read_bytes()).hexdigest()}
    assert builder.download_resource(resource,tmp_path,offline=True) == cached
    cached.write_bytes(b"Altered archive")
    with pytest.raises(ValueError,match="checksum mismatch"):
        builder.download_resource(resource,tmp_path,offline=True)


def test_nonportable_path_files_fail_audit(tmp_path):
    packages = tmp_path / "Lib/site-packages"
    packages.mkdir(parents=True)
    path = packages / "external.pth"
    path.write_text("C:/developer/library\n")
    with pytest.raises(ValueError,match="Nonportable"):
        builder.inspect_path_files(tmp_path)
    path.write_text("import arbitrary_code\n")
    with pytest.raises(ValueError,match="Unreviewed"):
        builder.inspect_path_files(tmp_path)


def test_pinned_base_and_locked_packages_define_exact_payload(tmp_path):
    archive = tmp_path / "python.tar.gz"
    with tarfile.open(archive,"w:gz") as output:
        for name,content in (("python/python.exe",b"executable"),("python/Lib/ssl.py",b"standard library"),("python/Lib/site-packages/unwanted.py",b"not the locked environment")):
            info=tarfile.TarInfo(name)
            info.size=len(content)
            output.addfile(info,io.BytesIO(content))
    packages = tmp_path / "environment/Lib/site-packages"
    packages.mkdir(parents=True)
    (packages / "application.py").write_text("runtime package")
    (packages / "direct_url.json").write_text("private build path")
    target = tmp_path / "resources/python"
    target.mkdir(parents=True)
    (target / "stale.py").write_text("removed package")
    records,counts = builder.prepare_python(None,packages,archive,target)
    assert set(records) == {"python.exe","Lib/ssl.py","Lib/site-packages/application.py"}
    assert not (target / "stale.py").exists()
    assert counts["removedStale"] == 1
    _,again = builder.prepare_python(None,packages,archive,target)
    assert again["copied"] == 0 and again["unchanged"] == 3


def test_local_base_mismatch_is_never_silently_accepted(tmp_path):
    archive = tmp_path / "base.tar.gz"
    with tarfile.open(archive,"w:gz") as output:
        info=tarfile.TarInfo("python/python.exe")
        info.size=6
        output.addfile(info,io.BytesIO(b"pinned"))
    base = tmp_path / "source"
    base.mkdir()
    (base / "python.exe").write_bytes(b"different")
    packages = tmp_path / "packages"
    packages.mkdir()
    with pytest.raises(ValueError,match="differs from the pinned"):
        builder.prepare_python(base,packages,archive,tmp_path / "target")
