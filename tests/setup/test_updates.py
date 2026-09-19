"""Update transactions and preflight; fixtures never touch the user's installation."""
from contextlib import ExitStack
import io
import json
import shutil
import subprocess
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/setup'))
import cli
import updates
from common import SetupError, inventory, read_json, write_json
from doctor import validate_metadata
from install import activate


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        # Match the updater's canonical paths: macOS /var aliases /private/var,
        # and Windows TEMP can contain an 8.3 name such as RUNNER~1.
        self.root=Path(self.temp.name).resolve()/'Alder update é'
        self.root.mkdir()
        self.state=self.root/'setup state';cli.own_state(self.state)
        self.install=self.root/'installed app'
        self.version=read_json(ROOT/'package.json')['version']
        self.fingerprint='fixture-source-fingerprint'
        self.app=self.install/'versions/old'
        self.app.mkdir(parents=True)
        (self.app/'alder').write_text('old executable')
        write_json(self.install/'.alder-owned.json',{'owner':'Alder repository installation','schemaVersion':1})
        write_json(self.install/'old-files.json',inventory(self.app))
        self.active={'schemaVersion':1,'directory':'versions/old','inventory':'old-files.json',
                     'target':'linux-x64','version':'0.1.0','fingerprint':'old-source',
                     'verification':'passed','dataCompatibility':1,'launcher':'old launcher',
                     'description':'Alder Organic Language Engine for Linux'}
        write_json(self.install/'active.json',self.active)
        self.retained={'directory':'versions/older','inventory':'older-files.json','version':'0.0.9','dataCompatibility':1}
        write_json(self.install/'previous.json',self.retained)
        self.userdata=self.root/'user data';self.userdata.mkdir()
        (self.userdata/'alder.sqlite3').write_bytes(b'untouched project data')

    def plan(self, **kwargs):
        return updates.update_plan(ROOT,self.install,'linux-x64',self.fingerprint,**kwargs)

    def test_preflight_identifies_upgrade_and_does_not_change_installation(self):
        before=inventory(self.install)
        plan=self.plan(expected_version=self.version)
        self.assertEqual(plan['status'],'update-available')
        self.assertEqual(plan['installedVersion'],'0.1.0')
        self.assertEqual(plan['repositoryVersion'],self.version)
        self.assertEqual(before,inventory(self.install))

    def test_same_version_distinguishes_current_source_from_rebuild(self):
        self.active['version']=self.version;write_json(self.install/'active.json',self.active)
        self.assertEqual(self.plan()['status'],'rebuild-available')
        self.active['fingerprint']=self.fingerprint;write_json(self.install/'active.json',self.active)
        self.assertEqual(self.plan()['status'],'current')

    def test_semantic_version_order_and_no_downgrades(self):
        self.assertLess(updates.version_tuple('0.9.0'),updates.version_tuple('0.11.0'))
        self.active['version']='999.0.0';write_json(self.install/'active.json',self.active)
        with self.assertRaisesRegex(SetupError,'newer'):self.plan()

    def test_wrong_requested_release_does_not_change_version(self):
        with self.assertRaisesRegex(SetupError,'not requested version'):self.plan(expected_version='999.0.0')
        self.assertEqual(read_json(self.install/'active.json'),self.active)

    def test_short_release_name_accepts_zero_patch_without_accepting_other_patches(self):
        source=self.root/'release source'
        package=read_json(ROOT/'package.json');package['version']='0.11.0'
        write_json(source/'package.json',package)
        plan=updates.update_plan(source,self.install,'linux-x64',self.fingerprint,'0.11')
        self.assertEqual(plan['repositoryRelease'],'0.11')
        package['version']='0.11.1';write_json(source/'package.json',package)
        with self.assertRaisesRegex(SetupError,'not requested version'):
            updates.update_plan(source,self.install,'linux-x64',self.fingerprint,'0.11')

    def test_missing_legacy_and_unowned_installations_are_not_adopted(self):
        for root in (self.root/'missing',self.root/'legacy'):
            root.mkdir();(root/'alder').write_text('legacy app')
            with self.assertRaisesRegex(SetupError,'No managed'):
                updates.update_plan(ROOT,root,'linux-x64',self.fingerprint)
            self.assertFalse((root/'.alder-owned.json').exists())
        (self.install/'.alder-owned.json').unlink()
        with self.assertRaisesRegex(SetupError,'not an Alder repository-managed'):self.plan()

    def test_target_migration_and_escaping_paths_stop_early(self):
        for change,pattern in [({'target':'darwin-arm64'},'does not match'),
                               ({'dataCompatibility':2},'data migration'),
                               ({'directory':'../../outside'},'escaped')]:
            with self.subTest(change=change):
                write_json(self.install/'active.json',{**self.active,**change})
                with self.assertRaisesRegex(SetupError,pattern):self.plan()

    def test_discovery_uses_receipts_but_requires_selection_for_multiple_apps(self):
        write_json(self.state/'installation.json',{'installation':str(self.install)})
        with patch('updates.default_install',return_value=self.root/'default'),patch('updates.launcher_install',return_value=None):
            self.assertEqual(updates.discover_install(self.state),self.install)
            other=self.root/'other';write_json(other/'active.json',self.active)
            write_json(self.state/'report.json',{'installation':str(other)})
            with self.assertRaisesRegex(SetupError,'Multiple'):updates.discover_install(self.state)
            self.assertEqual(updates.discover_install(self.state,self.install),self.install)

    def test_discovery_collapses_equivalent_installation_paths(self):
        alias=self.install/'versions'/'..'
        write_json(self.state/'installation.json',{'installation':str(self.install)})
        write_json(self.state/'report.json',{'installation':str(alias)})
        with patch('updates.default_install',return_value=alias),patch('updates.launcher_install',return_value=self.install):
            self.assertEqual(updates.discover_install(self.state),self.install)
            self.assertEqual(updates.discover_install(self.state,alias),self.install)

    def test_linux_custom_launcher_is_only_read_and_not_executed(self):
        home=self.root/'home';launcher=home/'.local/bin/alder';launcher.parent.mkdir(parents=True)
        import shlex
        launcher.write_text('#!/bin/sh\nexec '+shlex.quote(str(self.app/'alder'))+' "$@"\n',encoding='utf-8')
        with patch('updates.sys.platform','linux'),patch('updates.Path.home',return_value=home):
            self.assertEqual(updates.launcher_install(),self.install)

    def test_windows_discovery_accepts_old_icon_and_new_location_records(self):
        registry=SimpleNamespace(HKEY_CURRENT_USER=object(),OpenKey=MagicMock())
        for values in ({'DisplayIcon':str(self.app/'Alder.exe')},{'InstallLocation':str(self.install)}):
            def query(key,name):
                if name not in values:raise FileNotFoundError(name)
                return values[name],1
            registry.QueryValueEx=query
            with patch.dict(sys.modules,{'winreg':registry}),patch('updates.sys.platform','win32'):
                self.assertEqual(updates.launcher_install(),self.install)

    @unittest.skipIf(sys.platform=='win32','Native macOS/Linux symlink semantics')
    def test_mac_managed_app_link_discovers_custom_install_root(self):
        home=self.root/'home';applications=home/'Applications';applications.mkdir(parents=True)
        bundle=self.app/'Alder.app';bundle.mkdir()
        (applications/'Alder.app').symlink_to(bundle,target_is_directory=True)
        with patch('updates.sys.platform','darwin'),patch('updates.Path.home',return_value=home):
            self.assertEqual(updates.launcher_install(),self.install)

    def test_metadata_rejects_mismatched_package_lock_release(self):
        source=self.root/'bad source'
        write_json(source/'package.json',read_json(ROOT/'package.json'))
        write_json(source/'package-lock.json',{'version':'0.0.1','packages':{'':{'version':'0.0.1'}}})
        with self.assertRaisesRegex(SetupError,'release versions disagree'):validate_metadata(source)

    def test_native_update_wrapper_preserves_options_spaces_and_exit_status(self):
        folder=self.root/'wrapper';folder.mkdir()
        options=['--check','--install-dir',str(self.install),'--json']
        if sys.platform=='win32':
            shutil.copy2(ROOT/'update.ps1',folder/'update.ps1')
            (folder/'setup.ps1').write_text('[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding\nConvertTo-Json -InputObject @($args) -Compress\nexit 7\n')
            command=['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(folder/'update.ps1'),*options]
        else:
            shutil.copy2(ROOT/'update.sh',folder/'update.sh')
            (folder/'setup.sh').write_text('#!/bin/bash\nprintf "%s\\n" "$@"\nexit 7\n')
            command=['bash',str(folder/'update.sh'),*options]
        result=subprocess.run(command,cwd=self.root,capture_output=True,text=True,encoding='utf-8')
        self.assertEqual(result.returncode,7,result.stderr)
        received=json.loads(result.stdout) if sys.platform=='win32' else result.stdout.splitlines()
        self.assertEqual(received,['update',*options])

    def execution(self, desktops=None):
        workspace=self.root/'workspace';workspace.mkdir(exist_ok=True)
        (workspace/'node_modules').mkdir(exist_ok=True)
        built=self.root/'built';built.mkdir(exist_ok=True);(built/'alder').write_text('new executable')
        stack=ExitStack();self.addCleanup(stack.close)
        stack.enter_context(patch('cli.native_target',return_value='linux-x64'))
        stack.enter_context(patch('cli.source_fingerprint',return_value=self.fingerprint))
        stack.enter_context(patch('cli.inspect_host',return_value={'warnings':[]}))
        stack.enter_context(patch('cli.node_runtime',return_value=(self.root/'node',self.root/'npm')))
        stack.enter_context(patch('cli.build',return_value=(workspace,built)))
        stack.enter_context(patch('cli.check_space'))
        stack.enter_context(patch('cli.run'))
        stack.enter_context(patch('cli.require_closed'))
        stack.enter_context(patch('install.require_closed'))
        integrations=stack.enter_context(patch('install.integrations',side_effect=lambda root,active: 'launcher '+active['version']))
        resources=stack.enter_context(patch('cli.Resources'))
        resources.return_value.prepare.return_value=self.root/'resources'
        desktop=stack.enter_context(patch('cli.desktop',side_effect=desktops or [{'status':'passed'},{'status':'passed'}]))
        stack.enter_context(patch('cli.capabilities'))
        # setup's source fingerprint maps to this fixture's verification workspace.
        (self.state/'workspace'/self.fingerprint/'node_modules').mkdir(parents=True,exist_ok=True)
        return resources,desktop,integrations

    def invoke(self,*options):
        stdout=io.StringIO();stderr=io.StringIO()
        with patch('sys.stdout',stdout),patch('sys.stderr',stderr):
            status=cli.main(['update','--state-dir',str(self.state),'--install-dir',str(self.install),'--json',*options])
        output=stdout.getvalue() or stderr.getvalue()[stderr.getvalue().find('{'):]
        return status,json.loads(output)

    def test_check_never_provisions_or_writes_a_report(self):
        resources,desktop,_=self.execution()
        before=inventory(self.state)
        status,result=self.invoke('--check','--expect-version',self.version)
        self.assertEqual(status,0);self.assertEqual(result['status'],'update-available')
        resources.assert_not_called();desktop.assert_not_called()
        self.assertEqual(before,inventory(self.state))

    def test_migration_failure_precedes_native_dependencies(self):
        resources,desktop,_=self.execution()
        self.active['dataCompatibility']=2;write_json(self.install/'active.json',self.active)
        status,result=self.invoke()
        self.assertEqual(status,1);self.assertEqual(result['code'],'ALDER_MIGRATION')
        resources.assert_not_called();desktop.assert_not_called()

    def test_successful_update_retains_old_payload_and_data_and_reports_versions(self):
        self.execution()
        status,result=self.invoke('--expect-version',self.version)
        self.assertEqual(status,0);self.assertEqual(result['status'],'passed')
        self.assertEqual(result['version'],self.version);self.assertEqual(result['previousVersion'],'0.1.0')
        self.assertEqual(read_json(self.install/'previous.json'),self.active)
        self.assertEqual(read_json(self.install/'active.json')['verification'],'passed')
        self.assertEqual(read_json(self.state/'installation.json')['installation'],str(self.install))
        self.assertEqual((self.app/'alder').read_text(),'old executable')
        self.assertEqual((self.userdata/'alder.sqlite3').read_bytes(),b'untouched project data')

    def test_pending_stage_does_not_switch_launcher(self):
        _,_,integrations=self.execution([{'status':'pending'}])
        status,result=self.invoke()
        self.assertEqual(status,2);self.assertFalse(result['activated']);integrations.assert_not_called()
        self.assertEqual(read_json(self.install/'active.json'),self.active)
        self.assertEqual(read_json(self.install/'previous.json'),self.retained)

    def test_source_change_during_build_keeps_old_version_active(self):
        _,_,integrations=self.execution([{'status':'passed'}])
        with patch('cli.source_fingerprint',side_effect=[self.fingerprint,self.fingerprint,'changed']):
            status,result=self.invoke()
        self.assertEqual(status,1);self.assertEqual(result['code'],'ALDER_SOURCE')
        integrations.assert_not_called()
        self.assertEqual(read_json(self.install/'active.json'),self.active)

    def test_failed_installed_check_restores_both_version_records(self):
        _,_,integrations=self.execution([{'status':'passed'},SetupError('ALDER_CAPABILITY','installed failure')])
        status,result=self.invoke()
        self.assertEqual(status,1);self.assertEqual(result['code'],'ALDER_CAPABILITY')
        self.assertEqual(read_json(self.install/'active.json'),self.active)
        self.assertEqual(read_json(self.install/'previous.json'),self.retained)
        self.assertEqual(integrations.call_args.args[1],self.active)

    def test_pending_installed_check_restores_both_version_records(self):
        self.execution([{'status':'passed'},{'status':'pending'}])
        status,result=self.invoke()
        self.assertEqual(status,2);self.assertFalse(result['activated'])
        self.assertEqual(read_json(self.install/'active.json'),self.active)
        self.assertEqual(read_json(self.install/'previous.json'),self.retained)

    def test_current_offline_update_verifies_without_rebuilding(self):
        resources,desktop,_=self.execution([{'status':'passed'}])
        self.active.update(version=self.version,fingerprint=self.fingerprint)
        write_json(self.install/'active.json',self.active)
        status,result=self.invoke('--offline')
        self.assertEqual(status,0);self.assertTrue(result['reused'])
        resources.assert_not_called();desktop.assert_called_once()

    def test_activation_record_failure_restores_old_active_and_retained(self):
        built=self.root/'new app';built.mkdir();(built/'alder').write_text('new')
        real_write=write_json
        failed=False
        def fail_once(path,value):
            nonlocal failed
            if Path(path)==self.install/'previous.json' and not failed:
                failed=True;raise OSError('disk full during activation')
            real_write(path,value)
        with patch('install.require_closed'),patch('install.integrations',return_value='launcher'),patch('install.write_json',side_effect=fail_once):
            with self.assertRaisesRegex(OSError,'disk full'):
                activate(self.install,built,'linux-x64',self.version,'new',ROOT)
        self.assertEqual(read_json(self.install/'active.json'),self.active)
        self.assertEqual(read_json(self.install/'previous.json'),self.retained)


if __name__=='__main__':unittest.main()
