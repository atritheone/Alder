"""Per-user activation and reversible integrations. User data is never removed."""
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import time
from common import SetupError, read_json, write_json, inventory, verify_inventory, remove_owned, inside, unlink_file, remove_empty_directory


def default_install():
    if sys.platform=='win32':return Path(os.environ['LOCALAPPDATA'])/'Programs/AlderLocal'
    if sys.platform=='darwin':return Path.home()/'Library/Application Support/AlderInstall'
    return Path(os.environ.get('XDG_DATA_HOME',Path.home()/'.local/share'))/'alder/app'


def executable(app,target):
    return Path(app)/('Alder.exe' if target.startswith('win32') else 'Alder.app/Contents/MacOS/Alder' if target.startswith('darwin') else 'alder')


def resource_dir(app,target):
    return Path(app)/('Alder.app/Contents/Resources' if target.startswith('darwin') else 'resources')


def require_closed(root):
    """Detect installed processes by path, never kill the user's running application."""
    root=Path(root).resolve()
    if sys.platform=='win32':
        command='Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | Select-Object -ExpandProperty ExecutablePath'
        output=subprocess.check_output(['powershell.exe','-NoProfile','-Command',command],text=True,creationflags=subprocess.CREATE_NO_WINDOW)
        lines=output.splitlines()
    elif sys.platform=='linux':
        lines=[]
        for entry in Path('/proc').glob('[0-9]*/exe'):
            if entry.parent.name==str(os.getpid()):continue
            try:lines.append(str(entry.resolve(strict=True)))
            except OSError:pass
    else:
        process_lines=subprocess.check_output(['ps','-axo','pid=,comm='],text=True).splitlines()
        lines=[line.strip().split(None,1)[1] for line in process_lines if len(line.strip().split(None,1))==2 and line.strip().split(None,1)[0]!=str(os.getpid())]
    for line in lines:
        if line.strip() and Path(line.strip()).is_absolute() and Path(line.strip()).resolve().is_relative_to(root):
            raise SetupError('ALDER_RUNNING','Close Alder before update, rollback or uninstall; no user process was stopped.')


def integrations(root,active):
    root=Path(root); target=active['target']; app=root/active['directory']
    exe=executable(app,target); paths=[]
    if target.startswith('linux'):
        data=Path(os.environ.get('XDG_DATA_HOME',Path.home()/'.local/share'))
        desktop=data/'applications/org.alder.language.local.desktop'
        launcher=Path.home()/'.local/bin/alder'
        icons=[(p,data/f'icons/hicolor/{p.stem}/apps/alder-local.png') for p in (app/'resources/setup-icons').glob('*.png')]
        mime=data/'mime/packages/alder-local.xml'
        paths=[desktop,launcher,mime]+[p for _,p in icons]
    elif target.startswith('darwin'):
        paths=[Path.home()/'Applications/Alder.app']
    else:
        paths=[Path(os.environ['APPDATA'])/'Microsoft/Windows/Start Menu/Programs/Alder (local).lnk']
    existing=read_json(root/'integrations.json') if (root/'integrations.json').exists() else []
    owned={x['path']:x for x in existing}
    for p in paths:
        if (p.exists() or p.is_symlink()) and str(p) not in owned:
            raise SetupError('ALDER_INTEGRATION',f'An existing unowned launcher would be replaced: {p}. Move or rename your existing launcher before retrying; do not edit the repository.')
        if str(p) in owned and (p.exists() or p.is_symlink()):
            from common import digest
            record=owned[str(p)]
            unchanged=(p.is_symlink() and record.get('link')==os.readlink(p)) if 'link' in record else (p.is_file() and not p.is_symlink() and record.get('sha256')==digest(p))
            if not unchanged:raise SetupError('ALDER_INTEGRATION',f'The existing launcher was modified outside setup; it was preserved: {p}')
    for p in paths:p.parent.mkdir(parents=True,exist_ok=True)
    if target.startswith('linux'):
        # Desktop Exec follows desktop-entry escaping, not shell escaping.
        escaped=str(exe).replace('\\','\\\\').replace('"','\\"').replace('`','\\`').replace('$','\\$').replace('%','%%')
        desktop.write_text('[Desktop Entry]\nType=Application\nName=Alder\nComment='+active['description']+'\nExec="'+escaped+'" %F\nIcon=alder-local\nTerminal=false\nCategories=Office;\nMimeType=application/x-alder;\n',encoding='utf-8')
        launcher.write_text('#!/bin/sh\nexec '+shlex.quote(str(exe))+' "$@"\n',encoding='utf-8');launcher.chmod(0o755)
        for icon_source,icon_destination in icons:shutil.copy2(icon_source,icon_destination)
        mime.write_text('<?xml version="1.0"?><mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info"><mime-type type="application/x-alder"><comment>Alder project</comment><glob pattern="*.alder"/></mime-type></mime-info>',encoding='utf-8')
        for program,arg in [('update-desktop-database',desktop.parent),('update-mime-database',data/'mime')]:
            if shutil.which(program):
                result=subprocess.run([program,str(arg)])
                if result.returncode:print(f'Launcher created; {program} cache refresh returned {result.returncode}.',file=sys.stderr)
    elif target.startswith('darwin'):
        p=paths[0]
        temporary=p.with_name('Alder.setup-next.app')
        if temporary.is_symlink():temporary.unlink()
        elif temporary.exists():raise SetupError('ALDER_INTEGRATION',f'Unowned staging launcher exists: {temporary}')
        temporary.symlink_to(app/'Alder.app',target_is_directory=True)
        os.replace(temporary,p)
    else:
        # Pass strings as JSON through an environment variable, never interpolate shell code.
        import json
        payload={'shortcut':str(paths[0]),'exe':str(exe),'working':str(app),'description':active['description']}
        env={**os.environ,'ALDER_SHORTCUT_JSON':json.dumps(payload)}
        script='$p=$env:ALDER_SHORTCUT_JSON|ConvertFrom-Json; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($p.shortcut); $s.TargetPath=$p.exe; $s.WorkingDirectory=$p.working; $s.IconLocation=$p.exe; $s.Description=$p.description; $s.Save()'
        subprocess.run(['powershell.exe','-NoProfile','-Command',script],env=env,check=True,creationflags=subprocess.CREATE_NO_WINDOW)
        from common import digest
        write_json(root/'integrations.json',[{'path':str(paths[0]),'sha256':digest(paths[0])}])
        import winreg
        # The external bootstrap interpreter can remove the app's Python on Windows.
        python=Path(sys.executable)
        command=subprocess.list2cmdline([str(python),'-B',str(root/'management/maintenance.py'),'uninstall','--install-dir',str(root)])
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Uninstall\AlderRepository') as key:
            for n,v in [('DisplayName','Alder (local)'),('DisplayVersion',active['version']),('Publisher','Alder'),('Comments',active['description']),('DisplayIcon',str(exe)),('InstallLocation',str(root)),('UninstallString',command)]:winreg.SetValueEx(key,n,0,winreg.REG_SZ,v)
    from common import digest
    records=[{'path':str(p),**({'link':os.readlink(p)} if p.is_symlink() else {'sha256':digest(p)})} for p in paths]
    write_json(root/'integrations.json',records)
    return str(paths[0])


def restore_activation(root, active, previous):
    """Restore launcher and both records after failed activation/verification."""
    root=Path(root)
    integrations(root,active)
    write_json(root/'active.json',active)
    if previous is None:(root/'previous.json').unlink(missing_ok=True)
    else:write_json(root/'previous.json',previous)


def activate(root,built,target,version,fingerprint,source):
    root=Path(root)
    if root.exists() and any(root.iterdir()) and not (root/'.alder-owned.json').exists():
        raise SetupError('ALDER_PATH',f'Installation directory is not owned by repository setup: {root}')
    root.mkdir(parents=True,exist_ok=True)
    write_json(root/'.alder-owned.json',{'owner':'Alder repository installation','schemaVersion':1})
    require_closed(root)
    previous=read_json(root/'active.json') if (root/'active.json').exists() else None
    retained=read_json(root/'previous.json') if (root/'previous.json').exists() else None
    metadata=read_json(Path(source)/'package.json')['alderSetup']
    compatibility=metadata['dataCompatibility']
    if previous and previous.get('dataCompatibility')!=compatibility:
        raise SetupError('ALDER_MIGRATION','This update changes the data compatibility level. A maintainer-supplied migration is required; the current installation and user data remain unchanged.')
    name=f'{version}-{fingerprint[:12]}-{time.time_ns()}'
    stage=root/'versions'/name
    stage.parent.mkdir(exist_ok=True)
    # One copy at the install boundary; no symlink back to the development checkout.
    shutil.copytree(built,stage,symlinks=True)
    write_json(root/(name+'-files.json'),inventory(stage))
    management=root/'management';management.mkdir(exist_ok=True)
    for file in ('common.py','install.py','maintenance.py'):
        shutil.copy2(Path(source)/'scripts/setup'/file,management/file)
    active={'schemaVersion':1,'directory':'versions/'+name,'target':target,'version':version,'fingerprint':fingerprint,'inventory':name+'-files.json','verification':'pending','dataCompatibility':compatibility,'description':metadata['descriptions'][target.rsplit('-',1)[0]]}
    try:
        active['launcher']=integrations(root,active)
        write_json(root/'active.json',active)
        if previous:write_json(root/'previous.json',previous)
    except BaseException:
        if previous:restore_activation(root,previous,retained)
        raise
    return active


def rollback(root):
    root=Path(root);require_closed(root)
    if not (root/'previous.json').exists():raise SetupError('ALDER_ROLLBACK','No previous installation is available.')
    previous=read_json(root/'previous.json');current=read_json(root/'active.json')
    if previous.get('dataCompatibility')!=current.get('dataCompatibility'):
        raise SetupError('ALDER_MIGRATION','Automatic rollback across application versions is disabled: database compatibility must be established by the maintainer. Your data has not been changed.')
    if not verify_inventory(root/previous['directory'],read_json(root/previous['inventory'])):
        raise SetupError('ALDER_HASH','Previous installation failed integrity verification.')
    integrations(root,previous);write_json(root/'active.json',previous);write_json(root/'previous.json',current)
    return previous


def prune_versions(root):
    """Keep active and previous payloads; never remove an unmanifested user file."""
    root=Path(root)
    keep={read_json(root/name)['inventory'] for name in ('active.json','previous.json') if (root/name).exists()}
    for manifest in root.glob('*-files.json'):
        if manifest.name in keep:continue
        version=root/'versions'/manifest.name.removesuffix('-files.json')
        for relative,record in read_json(manifest).items():
            p=version/relative
            if not p.parent.resolve().is_relative_to(root.resolve()):raise SetupError('ALDER_PATH','Unsafe retained version path.')
            if p.is_symlink():
                if record.get('link')==os.readlink(p):p.unlink()
            elif p.is_file():
                from common import digest
                if record.get('sha256')==digest(p):unlink_file(p)
        if version.exists():
            for p in sorted((p for p in version.rglob('*') if p.is_dir() and not p.is_symlink()),key=lambda p:len(p.parts),reverse=True):
                try:remove_empty_directory(p)
                except OSError:pass
            try:remove_empty_directory(version)
            except OSError:pass
        # Keep the inventory if modified/user-added files prevented full cleanup.
        if not version.exists():manifest.unlink()


def uninstall(root):
    root=Path(root);require_closed(root)
    if not (root/'.alder-owned.json').exists():raise SetupError('ALDER_PATH','No managed installation at this path.')
    from common import digest
    for item in read_json(root/'integrations.json') if (root/'integrations.json').exists() else []:
        p=Path(item['path'])
        if 'link' in item and p.is_symlink() and os.readlink(p)==item['link']:p.unlink()
        elif 'sha256' in item and p.is_file() and not p.is_symlink() and digest(p)==item['sha256']:p.unlink()
    # Only manifest-owned payloads are removed; preserve files the user added.
    for manifest in root.glob('*-files.json'):
        name=manifest.name.removesuffix('-files.json');version=root/'versions'/name
        for relative in sorted(read_json(manifest),reverse=True):
            p=version/relative
            if p.is_symlink():
                if not p.parent.resolve().is_relative_to(root.resolve()):raise SetupError('ALDER_PATH','Unsafe install link parent.')
                p.unlink()
            else:
                inside(p,root)
                if p.is_file():unlink_file(p)
        if version.exists():
            for directory in sorted((p for p in version.rglob('*') if p.is_dir() and not p.is_symlink()),key=lambda p:len(p.parts),reverse=True):
                try:remove_empty_directory(directory)
                except OSError:pass
            try:remove_empty_directory(version)
            except OSError:pass
        manifest.unlink()
    for name in ('active.json','previous.json','integrations.json'):(root/name).unlink(missing_ok=True)
    if sys.platform=='win32':
        import winreg
        try:winreg.DeleteKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Uninstall\AlderRepository')
        except FileNotFoundError:pass
    return {'status':'uninstalled','userData':'preserved','remainingDirectory':str(root)}
