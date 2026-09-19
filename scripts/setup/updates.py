"""Discover and validate managed installations before an update does expensive work."""
import os
from pathlib import Path
import re
import shlex
import sys

from common import SetupError, inside, read_json
from install import default_install, executable


def launcher_install():
    """Read only the known per-user launcher; never search arbitrary user folders."""
    if sys.platform == 'win32':
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                    r'Software\Microsoft\Windows\CurrentVersion\Uninstall\AlderRepository') as key:
                try:
                    return Path(winreg.QueryValueEx(key, 'InstallLocation')[0])
                except FileNotFoundError:
                    # Installations before 0.11 recorded the versioned executable.
                    icon = Path(winreg.QueryValueEx(key, 'DisplayIcon')[0])
                    return icon.parent.parent.parent
        except OSError:
            return None
    if sys.platform == 'darwin':
        launcher = Path.home() / 'Applications/Alder.app'
        if launcher.is_symlink():
            return launcher.resolve().parent.parent.parent
    else:
        launcher = Path.home() / '.local/bin/alder'
        if launcher.is_file():
            for line in launcher.read_text(encoding='utf-8').splitlines():
                if line.startswith('exec '):
                    try:
                        parts = shlex.split(line)
                    except ValueError:
                        return None
                    if len(parts) > 1 and Path(parts[1]).is_absolute():
                        return Path(parts[1]).parent.parent.parent
    return None


def discover_install(state, explicit=None):
    if explicit is not None:
        return Path(explicit).expanduser().resolve()
    candidates = [default_install(), launcher_install()]
    for name in ('installation.json', 'report.json'):
        receipt = Path(state) / name
        if receipt.is_file():
            try:
                location = read_json(receipt).get('installation')
                if location and Path(location).is_absolute():
                    candidates.append(Path(location))
            except (OSError, ValueError, AttributeError):
                pass  # A report is only a location hint, never installation authority.
    found = sorted({p.resolve() for p in candidates if p is not None and (p/'active.json').is_file()})
    if len(found) > 1:
        raise SetupError('ALDER_AMBIGUOUS', 'Multiple Alder installations found: '+
                         ', '.join(str(p) for p in found)+'. Select one with --install-dir.')
    return found[0] if found else default_install().resolve()


def version_tuple(version):
    if not isinstance(version, str) or not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise SetupError('ALDER_METADATA', f'Expected a released major.minor.patch version, received {version!r}.')
    return tuple(int(part) for part in version.split('.'))


def release_label(version):
    return version[:-2] if version.endswith('.0') else version


def user_data_directory():
    # Matches electron/platform.ts; an existing custom launcher may override this.
    if os.environ.get('ALDER_DATA_DIR'):
        return Path(os.environ['ALDER_DATA_DIR']).expanduser().resolve()
    if sys.platform == 'win32':
        return Path(os.environ.get('LOCALAPPDATA',str(Path.home()/'AppData/Local'))) / 'Alder'
    if sys.platform == 'darwin':
        return Path.home() / 'Library/Application Support/Alder'
    return Path(os.environ.get('XDG_DATA_HOME',str(Path.home()/'.local/share'))) / 'Alder'


def update_plan(source, root, target, fingerprint, expected_version=None):
    root = Path(root)
    if not (root/'active.json').is_file():
        raise SetupError('ALDER_UPDATE', f'No managed Alder installation found at {root}. '
                         'Use --install-dir for a custom installation. Older installer/portable copies '
                         'need the transition in docs/setup/updating.md; update never creates a fresh installation.')
    if not (root/'.alder-owned.json').is_file() or read_json(root/'.alder-owned.json').get('owner') != 'Alder repository installation':
        raise SetupError('ALDER_UPDATE', 'This directory is not an Alder repository-managed installation; it has not been changed.')
    active = read_json(root/'active.json')
    if active.get('target') != target:
        raise SetupError('ALDER_TARGET', f'Installed target {active.get("target")} does not match {target}.')
    if not all(isinstance(active.get(key), str) and active[key] for key in ('directory','inventory','version','fingerprint')):
        raise SetupError('ALDER_UPDATE', 'The existing installation record is incomplete. Restore its records; do not invent metadata.')
    app = inside(root/active['directory'], root)
    manifest = inside(root/active['inventory'], root)
    if not app.is_relative_to((root/'versions').resolve()) or not manifest.is_file() or not executable(app,target).is_file():
        raise SetupError('ALDER_UPDATE', 'The existing managed payload or inventory is missing. Repair the existing version first.')
    package = read_json(Path(source)/'package.json')
    version = package['version']
    expected_package_version = (expected_version+'.0' if expected_version is not None and
                                re.fullmatch(r'\d+\.\d+',expected_version) else expected_version)
    if expected_version is not None and version != expected_package_version:
        raise SetupError('ALDER_VERSION', f'This repository contains {release_label(version)}, not requested version {expected_version}. Obtain the correct repository; do not edit its version.')
    if version_tuple(version) < version_tuple(active['version']):
        raise SetupError('ALDER_DOWNGRADE', f'Installed Alder {release_label(active["version"])} is newer than repository {release_label(version)}. Use a newer repository or the explicit rollback command.')
    if active.get('dataCompatibility') != package['alderSetup']['dataCompatibility']:
        raise SetupError('ALDER_MIGRATION', 'This update requires a data migration that is not supplied. The current installation and user data remain unchanged.')
    status = ('current' if active['fingerprint'] == fingerprint else
              'rebuild-available' if active['version'] == version else 'update-available')
    return {'status':status,'installedVersion':active['version'],'repositoryVersion':version,
            'installedRelease':release_label(active['version']),'repositoryRelease':release_label(version),
            'installation':str(root),'launcher':active.get('launcher'),
            'dataCompatibility':active['dataCompatibility'],'sourceFingerprint':fingerprint,
            'userDataDirectory':str(user_data_directory()),
            'verification':active.get('verification','unknown'),
            'next':'Close Alder, back up your projects, then run the same update command without --check.'}
