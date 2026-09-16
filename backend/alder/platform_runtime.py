"""Platform paths shared with the Electron launcher through runtime-layout.json."""
import json
import os
from pathlib import Path
import sys

LAYOUTS = json.loads(Path(__file__).with_name('runtime-layout.json').read_text('utf-8'))


def resource_executable(root, name, platform=None):
    platform = platform or sys.platform
    if platform not in LAYOUTS:
        raise RuntimeError(f'Unsupported Alder platform: {platform}')
    return Path(root) / LAYOUTS[platform][name]


def default_data_dir(platform=None):
    if os.environ.get('ALDER_DATA_DIR'):
        return Path(os.environ['ALDER_DATA_DIR']).expanduser()
    platform = platform or sys.platform
    if platform == 'win32':
        return Path(os.environ.get('LOCALAPPDATA', str(Path.home() / 'AppData/Local'))) / 'Alder'
    if platform == 'darwin':
        return Path.home() / 'Library/Application Support/Alder'
    return Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local/share'))) / 'Alder'


def speech_device(torch, requested=None):
    """Prefer native acceleration; an explicit unavailable device fails clearly."""
    available = {'cpu': True, 'cuda': torch.cuda.is_available(),
                 'mps': bool(getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available())}
    if requested:
        if requested not in available:
            raise ValueError('ALDER_SPEECH_DEVICE must be cpu, cuda, or mps.')
        if not available[requested]:
            raise RuntimeError(f'The requested speech device {requested} is unavailable on this machine.')
        return requested
    return next(device for device in ('cuda', 'mps', 'cpu') if available[device])
