"""0.12 resource and platform boundaries; no user installation is touched."""
from contextlib import ExitStack
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/setup'))
from common import SetupError, read_json, write_json
from cli import environment, own_state, source_fingerprint, workspace_copy
from doctor import inspect_host, validate_metadata
from features import feature_plan
from install import resource_dir
from resources import Resources
from verify import desktop
from windows_tools import find_sdk


class Release012Tests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        self.root=Path(temp.name).resolve()

    def test_platform_feature_matrix_and_required_model_binding(self):
        for target in ('win32-x64','linux-x64','darwin-arm64','darwin-x64'):
            with self.subTest(target=target):
                plan=feature_plan(ROOT,target)
                self.assertEqual(plan['windowsNativeMenu']['required'],target=='win32-x64')
                self.assertEqual(plan['proofreading']['advanced'],
                                 'unavailable' if target=='darwin-x64' else 'experimental')
                self.assertEqual(plan['proofreading']['rulesVersion'],'6.6')
        manifest=read_json(ROOT/'resources/manifests/proofreading.json')
        manifest['pythonBindings'].pop('linux-x64')
        write_json(self.root/'resources/manifests/proofreading.json',manifest)
        with self.assertRaisesRegex(SetupError,'Missing required'):feature_plan(self.root,'linux-x64')

    def test_metadata_rejects_missing_binding_and_mismatched_lock(self):
        source=self.root/'source';state=self.root/'state';own_state(state)
        source=workspace_copy(ROOT,state,source_fingerprint(ROOT))
        manifest_path=source/'resources/manifests/proofreading.json'
        original=read_json(manifest_path);changed=json.loads(json.dumps(original))
        changed['pythonBindings'].pop('darwin-arm64');write_json(manifest_path,changed)
        with self.assertRaisesRegex(SetupError,'bindings must cover'):validate_metadata(source)
        write_json(manifest_path,original)
        lock=source/'resources/locks/proofreading-linux-x64.txt'
        lock.write_text(lock.read_text().replace(original['pythonBindings']['linux-x64']['sha256'],'0'*64))
        with self.assertRaisesRegex(SetupError,'binding disagree'):validate_metadata(source)

    def test_compiler_output_does_not_break_workspace_retry(self):
        source=self.root/'source';native=source/'electron/native/windows-menu'
        native.mkdir(parents=True);(native/'menu.cc').write_text('source')
        (source/'build').mkdir();(source/'build/alder.ico').write_bytes(b'icon')
        fingerprint=source_fingerprint(source)
        state=self.root/'state';own_state(state)
        workspace=workspace_copy(source,state,fingerprint)
        generated=workspace/'electron/native/windows-menu/build/Release'
        generated.mkdir(parents=True);(generated/'alder_windows_menu.node').write_bytes(b'binary')
        self.assertEqual(source_fingerprint(workspace),fingerprint)
        self.assertEqual(workspace_copy(source,state,fingerprint),workspace)
        (workspace/'electron/native/windows-menu/menu.cc').write_text('changed')
        with self.assertRaisesRegex(SetupError,'workspace changed'):workspace_copy(source,state,fingerprint)

    def test_private_build_environment_drops_foreign_python(self):
        with patch.dict(os.environ,{'PYTHON':'foreign','NODE_GYP_FORCE_PYTHON':'foreign',
                                   'ALDER_PROOFREADING_RESOURCES':'foreign'}):
            env=environment(self.root)
        for key in ('PYTHON','NODE_GYP_FORCE_PYTHON','ALDER_PROOFREADING_RESOURCES'):
            self.assertNotIn(key,env)
        self.assertEqual(env['ALDER_NODE_GYP_CACHE'],str(self.root/'cache/node-gyp'))

    def test_windows_sdk_must_include_headers_libraries_and_resource_compiler(self):
        version='10.0.26100.0'
        parts=[f'Include/{version}/um/Windows.h',f'Include/{version}/ucrt/stdio.h',
               f'Lib/{version}/um/x64/kernel32.lib',f'Lib/{version}/ucrt/x64/ucrt.lib',
               f'bin/{version}/x64/rc.exe']
        for part in parts:
            self.assertIsNone(find_sdk([self.root]))
            file=self.root/part;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(b'fixture')
        self.assertEqual(find_sdk([self.root])['version'],version)

    def test_only_windows_build_operations_require_windows_tools(self):
        # Mock host APIs separately from target to exercise all target policies on either host.
        with ExitStack() as stack:
            stack.enter_context(patch('doctor.validate_metadata',return_value={}))
            stack.enter_context(patch('doctor.sys.platform','linux'))
            stack.enter_context(patch('doctor.os.geteuid',return_value=1000,create=True))
            stack.enter_context(patch('doctor.platform.libc_ver',return_value=('glibc','2.35')))
            stack.enter_context(patch('doctor.ctypes.util.find_library',return_value='library'))
            stack.enter_context(patch('doctor.memory_bytes',return_value=16*2**30))
            compiler=stack.enter_context(patch('doctor.windows_build_tools',return_value={'sdk':'fixture'}))
            for target in ('linux-x64','darwin-arm64','darwin-x64','win32-x64'):
                for need_build in (True,False):
                    compiler.reset_mock()
                    report=inspect_host(ROOT,self.root/'state',self.root/'app',target,
                                        need_space=False,need_build=need_build,allow_experimental=True)
                    self.assertEqual(compiler.call_count,int(target=='win32-x64' and need_build))
                    self.assertIn('proofreading',report['features'])

    def test_resource_provisioner_dispatches_rules_and_native_runtime(self):
        for target in ('win32-x64','linux-x64','darwin-arm64','darwin-x64'):
            advanced=target!='darwin-x64'
            builder=Resources.__new__(Resources)
            builder.source=ROOT;builder.state=self.root;builder.target=target
            builder.output=self.root/'resources';builder.offline=True
            builder.runtime=Mock();builder.component=lambda name,inputs,make:make()
            module=SimpleNamespace(prepare=Mock())
            spec=SimpleNamespace(loader=SimpleNamespace(exec_module=Mock()))
            with patch('resources.importlib.util.spec_from_file_location',return_value=spec), \
                 patch('resources.importlib.util.module_from_spec',return_value=module):
                builder.proofreading()
            self.assertEqual(builder.runtime.call_count,int(advanced))
            module.prepare.assert_called_once_with(builder.output/'proofreading',self.root/'cache/proofreading',True,not advanced)

    def test_installed_native_module_required_on_windows_and_forbidden_on_unix(self):
        app=self.root/'app'
        with self.assertRaisesRegex(SetupError,'module is missing'):
            desktop(ROOT,app,'win32-x64','node',{},self.root)
        for target in ('win32-x64','linux-x64','darwin-arm64','darwin-x64'):
            module=resource_dir(app,target)/'app.asar.unpacked/dist-electron/alder_windows_menu.node'
            module.parent.mkdir(parents=True,exist_ok=True);module.write_bytes(b'fixture')
            with patch('verify.run') as run:
                if target=='win32-x64':
                    self.assertEqual(desktop(ROOT,app,target,'node',{},self.root)['status'],'passed')
                    self.assertEqual(run.call_count,3)
                else:
                    with self.assertRaisesRegex(SetupError,'incorrectly included'):
                        desktop(ROOT,app,target,'node',{},self.root)
                    run.assert_not_called()

    @unittest.skipUnless(shutil.which('node'),'Node needed for native build dispatch check')
    def test_unix_build_never_resolves_windows_build_dependencies(self):
        helper=self.root/'build-windows-menu.mjs'
        shutil.copy2(ROOT/'scripts/build-windows-menu.mjs',helper)
        for platform in ('linux','darwin'):
            output=self.root/'dist-electron/alder_windows_menu.node'
            output.parent.mkdir(exist_ok=True);output.write_bytes(b'stale')
            code=f'Object.defineProperty(process,"platform",{{value:{json.dumps(platform)}}}); (await import({json.dumps(helper.as_uri())})).buildWindowsMenu();'
            subprocess.run(['node','--input-type=module','-e',code],cwd=self.root,check=True,capture_output=True)
            self.assertFalse(output.exists())


if __name__=='__main__':unittest.main()
