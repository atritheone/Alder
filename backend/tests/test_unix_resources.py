"""The Unix extraction/cache boundary must fail closed before native code runs."""
import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import pytest

spec = importlib.util.spec_from_file_location('unix_resources', Path(__file__).resolve().parents[2] / 'scripts/prepare-unix-resources.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def test_cached_native_archive_is_verified_before_use(tmp_path):
    archive = tmp_path / 'native.tar.gz'
    archive.write_bytes(b'verified payload')
    source = {'name': archive.name, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'url': 'https://invalid.example/never-used'}
    assert builder.download(source, tmp_path) == archive
    archive.write_bytes(b'altered payload')
    with pytest.raises(ValueError, match='checksum mismatch'):
        builder.download(source, tmp_path)


def test_extraction_rejects_path_escape_after_stripping(tmp_path):
    archive = tmp_path / 'unsafe.tar'
    with tarfile.open(archive, 'w') as package:
        entry = tarfile.TarInfo('python/../../escaped')
        entry.size = 1
        package.addfile(entry, io.BytesIO(b'x'))
    with pytest.raises((tarfile.FilterError, ValueError)):
        builder.extract(archive, tmp_path / 'output', strip=1)
    assert not (tmp_path / 'escaped').exists()


def test_native_layout_preserves_nested_payload(tmp_path):
    archive = tmp_path / 'native.tar'
    with tarfile.open(archive, 'w') as package:
        entry = tarfile.TarInfo('python/bin/python3')
        entry.mode = 0o755
        entry.size = 6
        package.addfile(entry, io.BytesIO(b'native'))
    builder.extract(archive, tmp_path / 'runtime', strip=1)
    assert (tmp_path / 'runtime/bin/python3').read_bytes() == b'native'
