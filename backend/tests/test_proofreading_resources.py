import hashlib
import importlib.util
import json
from pathlib import Path
import zipfile

import pytest


@pytest.fixture
def builder(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location('proofreading_builder', Path(__file__).resolve().parents[2] / 'scripts/prepare-proofreading-resources.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    source = tmp_path / 'source'; (source / 'resources/manifests').mkdir(parents=True)
    cache = tmp_path / 'cache'; cache.mkdir()
    archive = cache / 'rules.zip'
    with zipfile.ZipFile(archive, 'w') as package:
        package.writestr('LanguageTool-6.6/languagetool-server.jar', b'fixture jar')
        package.writestr('LanguageTool-6.6/COPYING.txt', b'fixture licence')
    manifest = {'rulesVersion': '6.6', 'rules': {'name': archive.name, 'url': 'https://example.invalid/rules.zip',
                 'sha256': module.digest(archive), 'sourceUrl': 'https://example.invalid/source'},
                'model': {'url': 'https://example.invalid/model'}, 'notices': []}
    (source / 'resources/manifests/proofreading.json').write_text(json.dumps(manifest))
    monkeypatch.setattr(module, 'ROOT', source)
    def no_network(*args, **kwargs):
        pytest.fail('Offline provisioning must not request network access')
    monkeypatch.setattr(module.urllib.request, 'urlopen', no_network)
    return module, tmp_path / 'output', cache, manifest


def test_verified_offline_provision_and_repair_preserve_previous(builder):
    module, output, cache, _ = builder
    result = module.prepare(output, cache, offline=True, rules_only=True)
    assert result['inferenceVerified'] is False
    jar = output / 'languagetool/languagetool-server.jar'
    assert jar.read_bytes() == b'fixture jar'
    jar.write_bytes(b'damaged')
    module.prepare(output, cache, offline=True, rules_only=True)
    assert jar.read_bytes() == b'fixture jar'
    previous = next(output.glob('languagetool-previous-*'))
    assert (previous / 'languagetool-server.jar').read_bytes() == b'damaged'
    (output / 'rules-inventory.json').write_text('{broken')
    module.prepare(output, cache, offline=True, rules_only=True)
    assert json.loads((output / 'rules-inventory.json').read_text())['files']
    (output / 'rules-inventory.json').unlink()
    module.prepare(output, cache, offline=True, rules_only=True)
    assert jar.read_bytes() == b'fixture jar'


def test_missing_cache_is_explicit_and_never_downloads(builder):
    module, output, cache, _ = builder
    (cache / 'rules.zip').unlink()
    with pytest.raises(RuntimeError, match='offline resource missing'):
        module.prepare(output, cache, offline=True, rules_only=True)


def test_unowned_resource_directory_is_not_replaced(builder):
    module, output, cache, _ = builder
    (output / 'languagetool').mkdir(parents=True)
    (output / 'languagetool/keep.txt').write_text('user file')
    with pytest.raises(ValueError, match='unowned'):
        module.prepare(output, cache, offline=True, rules_only=True)
    assert (output / 'languagetool/keep.txt').read_text() == 'user file'


def test_zip_path_escape_is_rejected(builder):
    module, output, cache, manifest = builder
    archive = cache / 'rules.zip'
    with zipfile.ZipFile(archive, 'a') as package:
        package.writestr('../escape.txt', b'bad')
    manifest['rules']['sha256'] = module.digest(archive)
    (module.ROOT / 'resources/manifests/proofreading.json').write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match='Unsafe'):
        module.prepare(output, cache, offline=True, rules_only=True)
    assert not (output.parent / 'escape.txt').exists()
