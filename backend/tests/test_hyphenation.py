from copy import deepcopy
from pathlib import Path
import pytest
from alder.hyphenation import break_words,valid_language,validate_typography
from alder.models import create_project,validate_project,document_text
from alder.publishing import build_export,import_document


def fixture():
    p=create_project(template='blank');p['name']='Hyphenation';p['language']='en-GB'
    p['settings'].update(documentKind='docx',includeTitle=False,includeToc=False,footer=False,pageSize='Custom',pageWidthMm=90,pageHeightMm=130,marginMm=15,fontSize=14)
    p['book']={'version':1,'chapters':[{'id':'c','title':'Text','include':True,'document':{'type':'doc','content':[
        {'type':'paragraph','attrs':{'hyphenation':True,'textLanguage':'en-GB'},'content':[{'type':'text','text':'extraordinary representation internationalisation characteristically '*20}]},
        {'type':'paragraph','attrs':{'hyphenation':False,'textLanguage':'de'},'content':[{'type':'text','text':'Silbentrennung bleibt erhalten.'}]}
    ]}}]}
    return validate_project(p)


def test_local_dictionaries_and_validation():
    result=break_words({'language':'en-GB','words':['extraordinary','representation']})
    assert all(result['breaks'])
    assert break_words({'language':'de','words':['Silbentrennung']})['breaks'][0]
    for tag in ('en-GB','zh-Hant-TW','de'):assert valid_language(tag)
    for tag in ('en<script>','en GB','',4):assert not valid_language(tag)
    for payload in ({'language':'qqq','words':['extraordinary']},{'language':'en','words':['too long '*100]},{'language':'en','words':['a']*513}):
        with pytest.raises(ValueError):break_words(payload)
    with pytest.raises(ValueError):validate_typography({'hyphenation':'true'})


@pytest.mark.parametrize('format',['html','epub','docx'])
def test_hyphenation_and_language_round_trip(tmp_path,format):
    p=fixture();before=deepcopy(p);out=build_export(p,format,tmp_path)
    imported=import_document(Path(out['path']))['document']
    assert p==before
    paras=[n for n in imported['content'] if n['type']=='paragraph']
    assert [(n['attrs'].get('hyphenation'),n['attrs'].get('textLanguage')) for n in paras]==[(True,'en-GB'),(False,'de')]
    assert document_text(imported)==document_text(p['book']['chapters'][0]['document'])


def test_direct_pdf_hyphenates_without_mutating_text(tmp_path):
    from pypdf import PdfReader
    p=fixture();before=deepcopy(p);out=build_export(p,'pdf',tmp_path)
    text='\n'.join(page.extract_text() for page in PdfReader(out['path']).pages)
    assert '-' in text
    assert p==before


def test_style_language_without_paragraph_properties():
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from alder.hyphenation import read_properties
    style=Document().styles['Normal']
    if style._element.pPr is not None:style._element.remove(style._element.pPr)
    lang=OxmlElement('w:lang');lang.set(qn('w:val'),'de')
    style._element.get_or_add_rPr().append(lang)
    assert read_properties(style.paragraph_format)['textLanguage']=='de'


def test_language_invalidates_publication_snapshot_identity():
    from alder.publication_layout import prepare_layout
    p=fixture();first=prepare_layout(p)
    p['language']='de';second=prepare_layout(p)
    assert first['sourceIdentity']!=second['sourceIdentity']
