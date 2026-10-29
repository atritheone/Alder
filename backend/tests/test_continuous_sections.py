from pathlib import Path
import runpy
import pytest
from alder.publishing import build_export,import_document
from alder.models import validate_project

source=runpy.run_path(str(Path(__file__).resolve().parents[2]/'scripts/continuous-sections-fixture.py'))

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_continuous_sections_preserve_flow_kind_and_numbering(tmp_path,format):
    p=source['fixture']('restart')
    result=build_export(p,format,tmp_path)
    opened=import_document(Path(result['path']))
    section=next(n for n in opened['document']['content'] if n['type']=='section_break')
    assert section['attrs']['kind']=='continuous'
    assert section['attrs']['numberingStart']==9
    if format=='docx':
        from docx import Document
        from docx.enum.section import WD_SECTION_START
        assert Document(result['path']).sections[1].start_type==WD_SECTION_START.CONTINUOUS
    p['book']['chapters'][0]['document']=opened['document'];p['settings'].update(opened.get('settings',{}));validate_project(p)


def test_backend_pdf_reports_continuous_section_conversion(tmp_path):
    result=build_export(source['fixture'](),'pdf',tmp_path)
    assert any('converts continuous sections' in warning for warning in result['warnings'])
