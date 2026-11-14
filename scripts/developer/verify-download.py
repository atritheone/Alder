"""Audit an end-user source ZIP before publishing; never run during installation."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys
import tempfile
import zipfile


def verify(archive):
    archive = archive.resolve()
    expected = archive.with_name(archive.name + '.sha256').read_text().split()[0]
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected, 'ZIP checksum mismatch'
    with tempfile.TemporaryDirectory(prefix='alder-download-audit-') as temporary:
        destination = Path(temporary)
        with zipfile.ZipFile(archive) as bundle:
            names = bundle.namelist()
            assert names and len(names) == len(set(names)), 'Empty or duplicate ZIP entries'
            roots = set()
            for name in names:
                path = PurePosixPath(name)
                assert not path.is_absolute() and '..' not in path.parts and '\\' not in name and ':' not in name, name
                roots.add(path.parts[0])
                assert not {'tests', 'test', 'fixtures', 'developer', 'node_modules', '.git', '__pycache__'} & set(path.parts), name
                assert not any(part.lower().endswith('.egg-info') for part in path.parts), name
                assert not path.name.startswith(('test_', 'test-', 'conftest.')), name
                assert '.test.' not in path.name and '.spec.' not in path.name, name
            assert len(roots) == 1, 'Expected one source root'
            bundle.extractall(destination)
        root = destination / roots.pop()
        manifest = json.loads((root / 'download-manifest.json').read_text())
        actual = {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in root.rglob('*') if path.is_file() and path != root / 'download-manifest.json'}
        assert actual == manifest['files'], 'Source manifest mismatch'
        package = json.loads((root / 'package.json').read_text())
        assert manifest['version'] == package['version'], 'Release metadata mismatch'
        assert set(package['scripts']) == {'build', 'typecheck'}, 'Unexpected npm entry points'
        assert '!**/*.map' in package['build']['files'], 'Application debug maps must be excluded'
        lock = json.loads((root / 'package-lock.json').read_text())
        assert not any(any(part in name for part in ('vitest', 'playwright', 'jsdom', 'prettier'))
                       for name in lock['packages']), 'Test-only npm dependency'
        for path in (root / 'resources/locks').glob('core-*.txt'):
            assert not any(line.lower().startswith(('pytest==', 'pluggy==', 'iniconfig=='))
                           for line in path.read_text().splitlines()), path.name
        sys.path.insert(0, str(root / 'scripts/setup'))
        from doctor import validate_metadata
        metadata = validate_metadata(root)
        print(json.dumps({'status': 'passed', 'archive': str(archive), 'sha256': expected,
                          'files': len(actual), 'metadata': metadata}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    verify(parser.parse_args().archive)
