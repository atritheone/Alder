from pathlib import Path
import pytest
from docx import Document
from docx.shared import Pt
from docx.enum.text import WD_TAB_ALIGNMENT, WD_TAB_LEADER
from alder.models import create_project, validate_project, document_text, ValidationError
from alder.publishing import build_export, import_document
from alder.tab_stops import read_tabs, validate_tab_stops


def fixture():
    p = create_project(template='blank')
    p['settings'].update(documentKind='docx', includeTitle=False, footer=False)
    stops = [{'position':72,'align':'left','leader':'dot'}, {'position':216,'align':'decimal','leader':'line'}]
    style = p['styles'][0]
    style['tabStops'] = stops
    content = [{'type':'paragraph','attrs':{'styleId':style['id']},'content':[{'type':'text','text':'First\tMiddle\t12.34'}]},
               {'type':'paragraph','attrs':{'styleId':style['id'],'tabStops':[]},'content':[{'type':'text','text':'Default\tTabs'}]}]
    doc = {'type':'doc','content':content}
    p['book'] = {'version':1,'chapters':[{'id':'tabs','title':'Document','include':True,'document':doc,'text':document_text(doc)}]}
    return validate_project(p)


def test_docx_and_html_preserve_tabs_styles_and_explicit_clears(tmp_path):
    p=fixture()
    for format in ('docx','html'):
        result=build_export(p,format,tmp_path)
        imported=import_document(Path(result['path']))
        blocks=imported['document']['content']
        assert blocks[0]['attrs']['tabStops']==p['styles'][0]['tabStops']
        assert blocks[1]['attrs']['tabStops']==[]
        assert document_text(imported['document'])==document_text(p['book']['chapters'][0]['document'])


def test_docx_resolves_additive_style_stops_and_clear():
    doc=Document()
    doc.styles['Normal'].paragraph_format.tab_stops.add_tab_stop(Pt(72))
    paragraph=doc.add_paragraph('One\tTwo')
    paragraph.paragraph_format.tab_stops.add_tab_stop(Pt(144), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
    inherited=read_tabs(doc.styles['Normal'].paragraph_format,None)
    assert [s['position'] for s in read_tabs(paragraph.paragraph_format,inherited)]==[72,144]


@pytest.mark.parametrize('stops',[None,{},[{'position':False,'align':'left','leader':'none'}],[{'position':float('inf'),'align':'left','leader':'none'}],[{'position':72,'align':'bar','leader':'dot'}]])
def test_invalid_tab_definitions(stops):
    with pytest.raises(ValueError): validate_tab_stops(stops)


def test_invalid_style_tab_rejected():
    p=fixture()
    p['styles'][0]['tabStops']=[{'position':1,'align':'left','leader':'bad'}]
    with pytest.raises(ValidationError): validate_project(p)
