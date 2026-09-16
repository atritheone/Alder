from types import SimpleNamespace
import pytest
from alder.platform_runtime import default_data_dir, resource_executable, speech_device


def test_native_resource_layouts(tmp_path):
    assert resource_executable(tmp_path, 'python', 'linux') == tmp_path / 'python/bin/python3'
    assert resource_executable(tmp_path, 'python', 'win32') == tmp_path / 'python/python.exe'
    assert resource_executable(tmp_path, 'calibre', 'darwin') == tmp_path / 'tools/calibre/calibre.app/Contents/MacOS/ebook-convert'
    with pytest.raises(RuntimeError):
        resource_executable(tmp_path, 'python', 'unknown')


def test_data_locations_and_override(monkeypatch, tmp_path):
    monkeypatch.delenv('ALDER_DATA_DIR', raising=False)
    monkeypatch.setenv('XDG_DATA_HOME', str(tmp_path))
    assert default_data_dir('linux') == tmp_path / 'Alder'
    assert default_data_dir('darwin').as_posix().endswith('Library/Application Support/Alder')
    monkeypatch.setenv('ALDER_DATA_DIR', str(tmp_path / 'test'))
    assert default_data_dir('darwin') == tmp_path / 'test'


@pytest.mark.parametrize('cuda,mps,expected', [(True, False, 'cuda'), (False, True, 'mps'), (False, False, 'cpu')])
def test_speech_device_selection(cuda, mps, expected):
    torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: cuda), backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: mps)))
    assert speech_device(torch) == expected
    assert speech_device(torch, 'cpu') == 'cpu'
    with pytest.raises(ValueError):
        speech_device(torch, 'invalid')
    if not mps:
        with pytest.raises(RuntimeError):
            speech_device(torch, 'mps')
