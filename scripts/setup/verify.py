"""Brief installed payload and launch checks; regression tests belong to developers."""
import os
from common import SetupError, run
from install import executable, resource_dir


def desktop(workspace,app,target,node,env,logs,full=True):
    native_menu=resource_dir(app,target)/'app.asar.unpacked/dist-electron/alder_windows_menu.node'
    if target=='win32-x64' and not native_menu.is_file():
        raise SetupError('ALDER_CAPABILITY','Installed Windows native menu module is missing from the unpacked application.')
    if target!='win32-x64' and native_menu.exists():
        raise SetupError('ALDER_CAPABILITY','A Windows native menu module was incorrectly included in a Unix application.')
    if target.startswith('linux') and not (os.environ.get('DISPLAY') or os.environ.get('WAYLAND_DISPLAY')):
        return {'status':'pending','reason':'Run verify from a graphical desktop session.'}
    environment={**env,'ALDER_DESKTOP_EXECUTABLE':str(executable(app,target)),
                 'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','PYTHONDONTWRITEBYTECODE':'1'}
    environment.pop('ALDER_RESOURCES_DIR',None)
    run([node,'scripts/setup/check-desktop.mjs','--packaged'],workspace,environment,logs,'installed-smoke',timeout=120)
    return {'status':'passed','scope':'installation integrity and launch'}
