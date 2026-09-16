"""Fault-boundary tests run without downloads, GUI, models or installed dependencies."""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import struct

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/setup'))
from common import SetupError, inventory, verify_inventory, write_json, remove_owned, operation_lock
from downloads import extract, fetch
from doctor import validate_metadata
from cli import source_fingerprint, workspace_copy, own_state, node_runtime, main
from install import activate, uninstall, rollback, prune_versions


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def owned(self,name='state'):
        p=self.root/name;p.mkdir();write_json(p/'.alder-owned.json',{'owner':'test'});return p

    def test_metadata_covers_every_target_and_native_icon(self):
        self.assertEqual(len(validate_metadata(ROOT)['targets']),4)
        self.assertNotIn(b'\r',(ROOT/'resources/manifests/bootstrap.tsv').read_bytes())

    def test_linux_icon_sizes_and_mac_icon_directory(self):
        for size in (16,24,32,48,64,128,256,512,1024):
            data=(ROOT/f'build/icons/{size}x{size}.png').read_bytes()
            self.assertEqual(data[:8],b'\x89PNG\r\n\x1a\n')
            self.assertEqual(struct.unpack('>II',data[16:24]),(size,size))
        data=(ROOT/'build/alder.icns').read_bytes();cursor=8;kinds=[]
        while cursor<len(data):
            kind,length=struct.unpack('>4sI',data[cursor:cursor+8]);self.assertGreater(length,8)
            kinds.append(kind);cursor+=length
        self.assertEqual(cursor,len(data));self.assertIn(b'ic10',kinds)

    def test_missing_homepage_is_a_release_error(self):
        pkg=json.loads((ROOT/'package.json').read_text());pkg.pop('homepage')
        write_json(self.root/'package.json',pkg)
        with self.assertRaisesRegex(SetupError,'homepage'):validate_metadata(self.root)

    def test_cache_verifies_bytes_even_if_file_already_exists(self):
        payload=b'original';h=hashlib.sha256(payload).hexdigest()
        cache=self.root/'cache';cache.mkdir();file=cache/(h+'-test.bin');file.write_bytes(payload)
        item={'name':'test.bin','url':'https://invalid.example/test.bin','sha256':h}
        self.assertEqual(fetch(item,cache,True),file)
        file.write_bytes(b'changed!')
        with self.assertRaisesRegex(SetupError,'Corrupt offline'):fetch(item,cache,True)

    def test_offline_missing_artifact_never_requests_network(self):
        with patch('urllib.request.urlopen') as network:
            with self.assertRaises(SetupError):fetch({'name':'missing','sha256':'0'*64,'url':'https://invalid.example'},self.root,True)
            network.assert_not_called()

    def test_tar_traversal_is_rejected_before_strip(self):
        archive=self.root/'bad.tar'
        with tarfile.open(archive,'w') as t:
            e=tarfile.TarInfo('payload/../../escaped');e.size=1;t.addfile(e,io.BytesIO(b'x'))
        with self.assertRaises(SetupError):extract(archive,self.root/'out',strip=1)
        self.assertFalse((self.root/'escaped').exists())

    def test_zip_windows_traversal_is_rejected(self):
        archive=self.root/'bad.zip'
        with zipfile.ZipFile(archive,'w') as z:z.writestr('..\\escaped','x')
        with self.assertRaises(SetupError):extract(archive,self.root/'out')

    @unittest.skipIf(sys.platform=='win32','Windows symlink privilege is not required for setup tests')
    def test_internal_java_style_symlink_survives_extraction(self):
        archive=self.root/'java.tar'
        with tarfile.open(archive,'w') as t:
            e=tarfile.TarInfo('jdk/legal/java.base/LICENSE');e.size=1;t.addfile(e,io.BytesIO(b'x'))
            link=tarfile.TarInfo('jdk/legal/jdk.zipfs/LICENSE');link.type=tarfile.SYMTYPE;link.linkname='../java.base/LICENSE';t.addfile(link)
        extract(archive,self.root/'out',strip=1)
        self.assertEqual((self.root/'out/legal/jdk.zipfs/LICENSE').read_bytes(),b'x')

    @unittest.skipIf(sys.platform=='win32','Windows symlink privilege is not required for setup tests')
    def test_escaping_archive_symlink_is_rejected(self):
        archive=self.root/'link.tar'
        with tarfile.open(archive,'w') as t:
            link=tarfile.TarInfo('payload/link');link.type=tarfile.SYMTYPE;link.linkname='../../outside';t.addfile(link)
        with self.assertRaises(tarfile.FilterError):extract(archive,self.root/'out',strip=1)

    def test_same_size_corruption_invalidates_inventory(self):
        p=self.root/'file';p.write_bytes(b'abc');records=inventory(self.root)
        self.assertTrue(verify_inventory(self.root,records));p.write_bytes(b'xyz')
        self.assertFalse(verify_inventory(self.root,records))

    def test_cleanup_cannot_escape_owned_root(self):
        owned=self.owned();outside=self.root/'user-project';outside.write_text('keep')
        with self.assertRaises(SetupError):remove_owned(outside,owned)
        with self.assertRaises(SetupError):remove_owned(owned,owned)
        self.assertEqual(outside.read_text(),'keep')

    def test_cleanup_requires_ownership_marker(self):
        p=self.root/'data';p.mkdir();file=p/'file';file.write_text('keep')
        with self.assertRaises(SetupError):remove_owned(file,p)

    @unittest.skipUnless(sys.platform=='win32','Windows read-only attributes differ from Unix directory permissions')
    def test_retry_cleanup_of_readonly_copied_directories(self):
        owned=self.owned();payload=owned/'copied';payload.mkdir()
        nested=payload/'readonly';nested.mkdir();(nested/'file').write_text('copy')
        nested.chmod(0o555)
        remove_owned(payload,owned)
        self.assertFalse(payload.exists())

    @unittest.skipUnless(sys.platform=='win32','Windows read-only archive attributes')
    def test_pruning_readonly_java_file_keeps_active_and_previous_versions(self):
        root=self.owned();old=root/'versions/old';old.mkdir(parents=True)
        archive=old/'classes.jsa';archive.write_bytes(b'java archive')
        write_json(root/'old-files.json',inventory(old));archive.chmod(0o444);old.chmod(0o555)
        write_json(root/'active.json',{'inventory':'current-files.json'})
        write_json(root/'previous.json',{'inventory':'previous-files.json'})
        prune_versions(root)
        self.assertFalse(old.exists());self.assertFalse((root/'old-files.json').exists())

    def test_operation_lock_excludes_parallel_setup_and_releases(self):
        with operation_lock(self.root):
            with self.assertRaises(SetupError):
                with operation_lock(self.root):pass
        with operation_lock(self.root):pass

    def test_retry_accepts_owned_state_and_rejects_unowned_files(self):
        state=self.root/'fresh'
        own_state(state);(state/'cached').write_text('download')
        own_state(state)
        self.assertEqual((state/'cached').read_text(),'download')
        unowned=self.root/'unowned';unowned.mkdir();(unowned/'project').write_text('user data')
        with self.assertRaises(SetupError):own_state(unowned)

    def test_failure_report_replaces_stale_result(self):
        state=self.owned()
        for error,code in [(OSError('disk full'),'ALDER_IO'),(SetupError('ALDER_HASH','bad download'),'ALDER_HASH')]:
            with self.subTest(code=code):
                write_json(state/'report.json',{'status':'passed'})
                stderr=io.StringIO()
                with patch('cli.execute',side_effect=error),patch('sys.stderr',stderr):
                    self.assertEqual(main(['install','--state-dir',str(state),'--json']),1)
                result=json.loads((state/'report.json').read_text())
                self.assertEqual(result,json.loads(stderr.getvalue()))
                self.assertEqual(result['code'],code)
                self.assertEqual(result['command'],'install')
                self.assertEqual(result['schemaVersion'],1)

    def test_unwritable_failure_report_preserves_original_error(self):
        state=self.owned();stderr=io.StringIO()
        with patch('cli.execute',side_effect=SetupError('ALDER_HASH','original failure')),patch('cli.write_json',side_effect=OSError('disk full')),patch('sys.stderr',stderr):
            self.assertEqual(main(['install','--state-dir',str(state),'--json']),1)
        result=json.loads(stderr.getvalue())
        self.assertEqual(result['code'],'ALDER_HASH')
        self.assertEqual(result['message'],'original failure')
        self.assertIn('disk full',result['reportWarning'])

    def test_corrupt_private_node_is_restored_from_verified_offline_cache(self):
        source=self.root/'source';state=self.owned()
        archive=self.root/'node.zip'
        with zipfile.ZipFile(archive,'w') as z:
            z.writestr('node-test/node.exe',b'original')
            z.writestr('node-test/node_modules/npm/bin/npm-cli.js',b'cli')
        content=archive.read_bytes();checksum=hashlib.sha256(content).hexdigest()
        write_json(source/'scripts/node-sources.json',{'win32-x64':{'name':'node.zip','url':'https://invalid.example/node.zip','sha256':checksum}})
        cache=state/'cache/artifacts';cache.mkdir(parents=True)
        (cache/(checksum+'-node.zip')).write_bytes(content)
        node,_=node_runtime(source,state,'win32-x64',True)
        self.assertEqual(node.read_bytes(),b'original')
        node.write_bytes(b'changed!')
        with patch('urllib.request.urlopen') as network:
            restored,_=node_runtime(source,state,'win32-x64',True)
            self.assertEqual(restored.read_bytes(),b'original')
            network.assert_not_called()

    def test_source_copy_preserves_source_and_excludes_local_work(self):
        source=self.root/'source';source.mkdir();(source/'backend').mkdir();(source/'backend/file.py').write_text('x=1')
        (source/'work').mkdir();(source/'work/private').write_text('private')
        before=inventory(source);fingerprint=source_fingerprint(source)
        state=self.owned();workspace=workspace_copy(source,state,fingerprint)
        self.assertEqual(inventory(source),before)
        self.assertFalse((workspace/'work/private').exists())
        (workspace/'backend/file.py').write_text('changed')
        with self.assertRaisesRegex(SetupError,'workspace changed'):workspace_copy(source,state,fingerprint)

    def test_uninstall_preserves_added_files_and_user_data(self):
        install=self.owned();version=install/'versions/v1';version.mkdir(parents=True)
        (version/'owned.txt').write_text('app');write_json(install/'v1-files.json',inventory(version))
        (version/'user-added.txt').write_text('keep')
        data=self.root/'Alder';data.mkdir();(data/'project.db').write_text('keep')
        with patch('install.require_closed'),patch('install.sys.platform','linux'):
            result=uninstall(install)
        self.assertFalse((version/'owned.txt').exists())
        self.assertEqual((version/'user-added.txt').read_text(),'keep')
        self.assertEqual((data/'project.db').read_text(),'keep')
        self.assertEqual(result['userData'],'preserved')

    def test_rollback_refuses_incompatible_database_version(self):
        install=self.owned()
        write_json(install/'active.json',{'dataCompatibility':2})
        write_json(install/'previous.json',{'dataCompatibility':1})
        with patch('install.require_closed'),self.assertRaisesRegex(SetupError,'compatibility'):
            rollback(install)

    def test_linux_activation_rollback_and_uninstall_preserve_user_data(self):
        built=self.root/'built';built.mkdir();(built/'alder').write_text('version one')
        icons=built/'resources/setup-icons';icons.mkdir(parents=True)
        (icons/'256x256.png').write_bytes((ROOT/'build/icons/256x256.png').read_bytes())
        install=self.root/'application';data=self.root/'desktop-data';home=self.root/'home'
        home.mkdir();data.mkdir();projects=data/'Alder';projects.mkdir();(projects/'book.db').write_text('authored')
        with patch('install.require_closed'),patch('install.sys.platform','linux'),patch('install.Path.home',return_value=home),patch.dict(os.environ,{'XDG_DATA_HOME':str(data)}),patch('install.shutil.which',return_value=None):
            first=activate(install,built,'linux-x64','0.1.0','first',ROOT)
            desktop=data/'applications/org.alder.language.local.desktop'
            self.assertIn('Comment=Alder Organic Language Engine for Linux',desktop.read_text())
            self.assertTrue((data/'icons/hicolor/256x256/apps/alder-local.png').is_file())
            (built/'alder').write_text('version two')
            second=activate(install,built,'linux-x64','0.1.0','second',ROOT)
            self.assertIn(str(install/second['directory']),(home/'.local/bin/alder').read_text())
            restored=rollback(install)
            self.assertEqual(restored['directory'],first['directory'])
            self.assertIn(str(install/first['directory']),(home/'.local/bin/alder').read_text())
            # An externally customized shortcut is preserved by uninstall.
            desktop.write_text('user customization')
            uninstall(install)
            self.assertEqual(desktop.read_text(),'user customization')
            self.assertEqual((projects/'book.db').read_text(),'authored')
            self.assertFalse((home/'.local/bin/alder').exists())


if __name__=='__main__':unittest.main()
