from pathlib import Path
import pytest
from alder.models import create_project,validate_project,document_text,ValidationError
from alder.publishing import build_export,import_document

APPEARANCE=dict(paragraphBackground='#eeddcc',paragraphBorderColor='#123456',paragraphBorderWidth=1.5,paragraphPadding=6)

def fixture():
    p=create_project(template='blank');p['settings'].update(documentKind='docx',includeTitle=False,footer=False)
    style=p['styles'][0];style.update(APPEARANCE)
    doc={'type':'doc','content':[{'type':'paragraph','attrs':{'styleId':style['id']},'content':[{'type':'text','text':'Shaded paragraph.','marks':[{'type':'em'}]}]}, {'type':'paragraph','attrs':{'styleId':style['id'],'paragraphBackground':'transparent','paragraphBorderWidth':0},'content':[{'type':'text','text':'Explicit removal.'}]}]}
    p['book']={'version':1,'chapters':[{'id':'appearance','title':'Document','include':True,'document':doc,'text':document_text(doc)}]}
    return validate_project(p)

@pytest.mark.parametrize('format',['docx','html','epub'])
def test_appearance_round_trip_preserves_style_and_explicit_removal(tmp_path,format):
    p=fixture();export=build_export(p,format,tmp_path);opened=import_document(Path(export['path']))
    blocks=opened['document']['content'];first=next(n for n in blocks if document_text(n)=='Shaded paragraph.')
    for key,value in APPEARANCE.items(): assert first['attrs'][key]==value
    second=next(n for n in blocks if document_text(n)=='Explicit removal.')
    assert second['attrs']['paragraphBackground']=='transparent'
    assert second['attrs']['paragraphBorderWidth']==0

def test_pdf_keeps_text_and_reports_separate_layout(tmp_path):
    from pypdf import PdfReader
    p=fixture();export=build_export(p,'pdf',tmp_path)
    text=''.join(page.extract_text() for page in PdfReader(export['path']).pages)
    assert 'Shaded paragraph.' in text and 'Explicit removal.' in text

@pytest.mark.parametrize('values',[{'paragraphPadding':32},{'paragraphBackground':'red;display:none'},{'paragraphBorderWidth':True},{'paragraphBorderWidth':float('nan')}])
def test_invalid_appearance_rejected_in_blocks_and_styles(values):
    for location in ('styles','block'):
        p=fixture()
        target=p['styles'][0] if location=='styles' else p['book']['chapters'][0]['document']['content'][0]['attrs']
        target.update(values)
        with pytest.raises(ValidationError):validate_project(p)

def test_docx_import_reports_nonuniform_and_patterned_borders(tmp_path):
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    doc=Document();p=doc.add_paragraph('Keep this text.')
    borders=OxmlElement('w:pBdr');edge=OxmlElement('w:top');edge.set(qn('w:val'),'double');edge.set(qn('w:color'),'AABBCC');borders.append(edge);p._p.get_or_add_pPr().append(borders)
    path=tmp_path/'pattern.docx';doc.save(path)
    result=import_document(path)
    assert any('uniform solid border' in warning for warning in result['warnings'])
    assert document_text(result['document'])=='Keep this text.'

def test_docx_export_reports_rounding(tmp_path):
    p=fixture();p['styles'][0].update(paragraphBorderWidth=.1,paragraphPadding=2.5)
    result=build_export(p,'docx',tmp_path)
    assert any('rounds paragraph border' in warning for warning in result['warnings'])
