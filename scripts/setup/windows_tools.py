"""Read-only Windows compiler/SDK preflight; never called for a Unix target."""
import os
from pathlib import Path
import subprocess
import sys

from common import SetupError


def sdk_roots():
    roots=[Path(os.environ.get('ProgramFiles(x86)','C:/Program Files (x86)'))/'Windows Kits/10']
    if sys.platform=='win32':
        import winreg
        for view in (winreg.KEY_WOW64_32KEY,winreg.KEY_WOW64_64KEY):
            try:
                with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,r'SOFTWARE\Microsoft\Windows Kits\Installed Roots',0,winreg.KEY_READ|view) as key:
                    roots.append(Path(winreg.QueryValueEx(key,'KitsRoot10')[0]))
            except OSError:pass
    return roots


def find_sdk(roots):
    for root in roots:
        for headers in sorted((root/'Include').glob('10.*'),reverse=True):
            version=headers.name
            required=[headers/'um/Windows.h',headers/'ucrt/stdio.h',
                      root/f'Lib/{version}/um/x64/kernel32.lib',root/f'Lib/{version}/ucrt/x64/ucrt.lib',
                      root/f'bin/{version}/x64/rc.exe']
            if all(p.is_file() for p in required):return {'root':str(root),'version':version}
    return None


def windows_build_tools():
    vswhere=Path(os.environ.get('ProgramFiles(x86)','C:/Program Files (x86)'))/'Microsoft Visual Studio/Installer/vswhere.exe'
    installations=[]
    if vswhere.is_file():
        try:
            installations=subprocess.check_output([str(vswhere),'-products','*','-version','[17.0,)',
                '-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],
                text=True,timeout=15,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)).splitlines()
        except (OSError,subprocess.SubprocessError):pass
    compiler=None
    for location in installations:
        root=Path(location.strip())
        if (root/'MSBuild/Current/Bin/MSBuild.exe').is_file():
            compiler=next((p for p in (root/'VC/Tools/MSVC').glob('*/bin/Hostx64/x64/cl.exe') if p.is_file()),None)
            if compiler:break
    if compiler is None:
        raise SetupError('ALDER_PREREQUISITE','Windows native menus require Visual Studio Build Tools 2022 or newer, MSBuild and the Desktop development with C++ workload. See docs/setup/windows.md. Only prerequisite installation may use elevation; rerun Alder update as the desktop user.')
    sdk=find_sdk(sdk_roots())
    if sdk is None:
        raise SetupError('ALDER_PREREQUISITE','The Windows C++ compiler is present but a complete Windows 10/11 SDK (x64 libraries, UCRT, headers and resource compiler) is missing. Add the Windows SDK through Visual Studio Installer, then retry. See docs/setup/windows.md.')
    return {'compiler':str(compiler),'sdk':sdk}
