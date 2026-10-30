from pathlib import Path
import pytest
from docx import Document
from docx.oxml.ns import qn
from pypdf import PdfReader
from alder.models import create_project, validate_project, ValidationError
from alder.publishing import build_export, import_document


def fixture(start=1):
    project = create_project(template='blank')
    project['settings'].update(documentKind='docx', includeTitle=False, footer=False,
        pageSize='Custom', pageWidthMm=150, pageHeightMm=170, marginTopMm=20,
        marginBottomMm=20, marginLeftMm=40, marginRightMm=20, gutterMm=5,
        mirrorMargins=True, firstPageNumber=start, header='RUNNING_HEADER')
    document = {'type':'doc','content':[
        {'type':'paragraph','attrs':{'pageBreakBefore':i>0},'content':[{'type':'text','text':f'MIRROR{i+1} Inside and outside margins.'}]}
        for i in range(4)]}
    project['book']={'version':1,'chapters':[{'id':'mirror','title':'Document','document':document,'text':'','include':True}]}
    return validate_project(project)


@pytest.mark.parametrize('start',[1,2])
def test_mirror_geometry_survives_word_html_epub_and_pdf(tmp_path,start):
    project=fixture(start)
    for format in ('docx','html','epub'):
        exported=build_export(project,format,tmp_path)
        restored=import_document(Path(exported['path']))
        assert restored['settings']['mirrorMargins'] is True
        assert restored['settings']['firstPageNumber']==start
        for name,value in [('marginLeftMm',40),('marginRightMm',20),('gutterMm',5)]:
            assert restored['settings'][name]==pytest.approx(value,abs=.04)
        assert not any('mirrored margins' in warning for warning in restored['warnings'])
        if format=='docx':
            word=Document(exported['path'])
            assert word.settings.element.find(qn('w:mirrorMargins')) is not None
    pdf=PdfReader(build_export(project,'pdf',tmp_path)['path'])
    assert len(pdf.pages)==4
    for index,page in enumerate(pdf.pages):
        positions={}
        def visit(text,cm,tm,font,size):
            if 'MIRROR' in text:positions['body']=cm[4]+tm[4]
            if 'RUNNING_HEADER' in text:positions['header']=cm[4]+tm[4]
        page.extract_text(visitor_text=visit)
        expected=(20 if (index+start)%2==0 else 45)*72/25.4
        assert positions==pytest.approx({'body':expected,'header':expected},abs=.04)


def test_mirror_setting_is_strict_and_legacy_default_is_off():
    project=fixture()
    project['settings']['mirrorMargins']='false'
    with pytest.raises(ValidationError,match='Mirrored margins'):validate_project(project)
    project['settings'].pop('mirrorMargins')
    assert not validate_project(project)['settings'].get('mirrorMargins',False)


def test_import_explicitly_disabled_native_margins(tmp_path):
    project=fixture()
    exported=build_export(project,'docx',tmp_path)
    word=Document(exported['path'])
    word.settings.element.find(qn('w:mirrorMargins')).set(qn('w:val'),'false')
    word.save(exported['path'])
    assert import_document(Path(exported['path']))['settings']['mirrorMargins'] is False


def test_mirror_is_document_wide_across_section_restart(tmp_path):
    project=fixture()
    project['book']['chapters'][0]['document']['content'].insert(2,{
        'type':'section_break','attrs':{'kind':'nextPage','numberingStart':2,
            'page':{'pageSize':'A5','marginLeftMm':30,'marginRightMm':15,'gutterMm':5}}})
    result=build_export(validate_project(project),'docx',tmp_path)
    imported=import_document(Path(result['path']))
    assert imported['settings']['mirrorMargins'] is True
    section=next(node for node in imported['document']['content'] if node['type']=='section_break')
    assert section['attrs']['numberingStart']==2
    assert section['attrs']['page']['marginLeftMm']==pytest.approx(30,abs=.04)
    assert 'mirrorMargins' not in section['attrs']['page']
