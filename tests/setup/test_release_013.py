"""Release metadata, complete source copies, and 0.12 update compatibility."""
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/setup'))
from cli import own_state, source_fingerprint, workspace_copy
from common import SetupError, inventory, read_json, write_json
from doctor import validate_metadata
from install import executable
from updates import update_plan


class Release013Tests(unittest.TestCase):
    def test_release_metadata_and_external_workspace_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory);own_state(state)
            workspace=workspace_copy(ROOT,state,source_fingerprint(ROOT))
            self.assertEqual(validate_metadata(workspace)['version'],'0.13.0')
            for name in ('THIRD-PARTY-NOTICES.md','docs/sitka-provenance.md',
                         'frontend/src/citationAssets/apa.csl',
                         'frontend/src/equationAssets/OFL.txt',
                         'backend/alder/stationery-presets.json',
                         'scripts/verify-installed-documents.py'):
                self.assertEqual((ROOT/name).read_bytes(),(workspace/name).read_bytes())
            (workspace/'backend/alder/__init__.py').write_text('__version__ = "0.12.0"')
            with self.assertRaisesRegex(SetupError,'Backend and desktop'):
                validate_metadata(workspace)

    def test_update_from_both_released_compatibility_levels_on_every_target(self):
        for target in ('win32-x64','linux-x64','darwin-arm64','darwin-x64'):
            for compatibility in (1,2):
                with self.subTest(target=target,compatibility=compatibility),tempfile.TemporaryDirectory() as directory:
                    root=Path(directory);app=root/'versions/old'
                    exe=executable(app,target);exe.parent.mkdir(parents=True);exe.write_bytes(b'fixture')
                    write_json(root/'.alder-owned.json',{'owner':'Alder repository installation'})
                    write_json(root/'files.json',inventory(app))
                    write_json(root/'active.json',{'directory':'versions/old','target':target,
                        'version':'0.12.0','dataCompatibility':compatibility,
                        'inventory':'files.json','fingerprint':'previous-source'})
                    before=inventory(root)
                    plan=update_plan(ROOT,root,target,'new-source','0.13')
                    self.assertEqual(plan['status'],'update-available')
                    self.assertEqual(plan['installedRelease'],'0.12')
                    self.assertEqual(plan['repositoryRelease'],'0.13')
                    self.assertEqual(plan['dataMigration'],compatibility==1)
                    self.assertEqual(plan['automaticRollbackCompatible'],compatibility==2)
                    self.assertEqual(inventory(root),before)


if __name__=='__main__':unittest.main()
