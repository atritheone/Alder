import copy
from pathlib import Path

import pytest

from alder.models import create_project, validate_project, validate_document, document_text
from alder.publishing import import_document, build_export
from alder.rtf_syntax import parse, escape


def p(text,attrs=None,marks=None):
    return {'type':'paragraph','attrs':attrs or {},'content':[{'type':'text','text':text,**({'marks':marks} if marks else {})}]}


def fixture():
    project=create_project(template='blank');project['name']='RTF exchange'
    project['settings'].update(documentKind='docx',includeTitle=False,footer=False,pageSize='A5',marginMm=18)
    content=[{'type':'heading','attrs':{'level':2},'content':[{'type':'text','text':'RTF_HEADING'}]},
        p('  Exact  {wording} \\ with \U0001f600 caf\u00e9\tand trailing  ',{'align':'justify','spaceAfter':12,'leftIndent':10,'firstLineIndent':-5,'lineSpacingMode':'exact','lineSpacing':18,'textLanguage':'en-GB','tabStops':[{'position':144,'align':'decimal','leader':'dot'}]},[{'type':'strong'},{'type':'em'},{'type':'text_style','attrs':{'fontFamily':'Cambria','fontSize':13,'color':'#224466'}},{'type':'highlight','attrs':{'color':'#ffff00'}}]),
        p('LINK',None,[{'type':'link','attrs':{'href':'https://example.com/'}}]),p('ANCHOR')]
    content[-1]['content'].append({'type':'document_note','attrs':{'blockId':'rtfnote','kind':'footnote','body':{'type':'doc','content':[p('NOTE_TEXT')]}}})
    project['book']={'version':1,'chapters':[{'id':'main','title':'Document','include':True,'document':{'type':'doc','content':content}}]}
    return validate_project(project)


def external(tmp_path,content):
    file=tmp_path/'input.rtf';file.write_bytes(content);return import_document(file)


def test_native_rtf_formatted_unicode_roundtrip(tmp_path):
    project=fixture();before=copy.deepcopy(project)
    result=build_export(project,'rtf',tmp_path)
    assert project==before
    raw=Path(result['path']).read_bytes();assert raw.isascii() and b'\\u-10179?' in raw
    imported=import_document(Path(result['path']));validate_document(imported['document'])
    assert document_text(imported['document'])==document_text(project['book']['chapters'][0]['document'])
    blocks=imported['document']['content']
    assert blocks[0]['type']=='heading' and blocks[0]['attrs']['level']==2
    assert blocks[1]['attrs']['align']=='justify' and blocks[1]['attrs']['lineSpacingMode']=='exact'
    assert blocks[1]['attrs']['tabStops']==[{'position':144,'align':'decimal','leader':'dot'}]
    assert blocks[1]['attrs']['textLanguage']=='en-GB'
    assert {'strong','em','text_style','highlight'}=={m['type'] for m in blocks[1]['content'][0]['marks']}
    assert any(m['type']=='link' for m in blocks[2]['content'][0]['marks'])
    note=blocks[3]['content'][1]
    assert note['type']=='document_note' and document_text(note['attrs']['body'])=='NOTE_TEXT'
    assert imported['settings']['pageWidthMm']==pytest.approx(148,abs=.02)


def test_final_paragraph_without_terminator_and_group_formatting(tmp_path):
    result=external(tmp_path,br'{\rtf1\ansi First {\b bold} normal.\par Last.}')
    assert document_text(result['document'])=='First bold normal.\nLast.'
    bold=next(n for n in result['document']['content'][0]['content'] if n['text']=='bold')
    assert any(m['type']=='strong' for m in bold['marks'])
    assert not any(m['type']=='strong' for m in result['document']['content'][0]['content'][-1]['marks'])


def test_codepage_and_unicode_fallback_are_decoded_once(tmp_path):
    result=external(tmp_path,br"{\rtf1\ansi\ansicpg1252\uc1 caf\'e9 \u-10179?\u-8704? \u233\'e9}")
    assert document_text(result['document'])=='caf\u00e9 \U0001f600 \u00e9'
    result=external(tmp_path,br"{\rtf1\ansi\ansicpg932\'82\'a0}")
    assert document_text(result['document'])=='\u3042'
    result=external(tmp_path,br'{\rtf1\uc1\u233eclair\b1Bold}')
    assert document_text(result['document'])=='\u00e9clairBold'


def test_unicode_alternate_and_ignorable_destinations_do_not_duplicate_text(tmp_path):
    result=external(tmp_path,br'{\rtf1{\*\generator Must not appear;}{\upr{ANSI fallback}{\*\ud Unicode \u233?}}}')
    assert document_text(result['document'])=='Unicode \u00e9'


def test_external_field_instructions_are_never_executed(tmp_path):
    result=external(tmp_path,br'{\rtf1 Before {\field{\*\fldinst INCLUDETEXT "https://example.com/secret"}{\fldrslt Cached wording}} after.}')
    assert document_text(result['document'])=='Before Cached wording after.'
    assert any('never executed' in warning for warning in result['warnings'])


def test_native_word_hyperlink_ignores_opaque_field_metadata(tmp_path):
    result=external(tmp_path,br'{\rtf1 {\field{\*\fldinst HYPERLINK "https://example.com/"{\*\datafield 00deadbeef}}{\fldrslt Link}}}')
    assert document_text(result['document'])=='Link'
    assert next(m for m in result['document']['content'][0]['content'][0]['marks'] if m['type']=='link')['attrs']['href']=='https://example.com/'


@pytest.mark.parametrize('raw,match',[
    (br'{\rtf1 Unclosed','complete'),
    (br'{\rtf1 {Unclosed}','unbalanced'),
    (br'{\rtf1 \bin9999999999 abc}','binary'),
    (br"{\rtf1 \'xx}",'hexadecimal'),
    (br'{\rtf1 \uc999\u233?}','fallback'),
    (br'{\rtf1 {\revised Inserted}}','tracked edits'),
    (br'{\rtf1 {\deleted Deleted}}','tracked edits'),
    (br'{\rtf1 {\*\oldcprops\b} Changed}','tracked edits'),
    (br'{\rtf1 {\*\annotation Review}}','review comments'),
    (br'{\rtf1 {\object{\*\objdata 0102}}}','embedded object'),
])
def test_unsafe_or_malformed_structures_fail_explicitly(tmp_path,raw,match):
    from alder.rtf_reader import Reader
    with pytest.raises(ValueError,match=match):Reader(parse(raw),[],[]).finish()


def test_list_and_table_conversion_is_explicit(tmp_path):
    result=external(tmp_path,br'{\rtf1 {\listtext 3.\tab}Item\par\trowd\cellx2000\cellx4000\pard\intbl Left\cell Right\cell\row}')
    assert document_text(result['document'])=='3. Item\nLeft\tRight'
    assert any('list labels' in w for w in result['warnings']) and any('tables' in w for w in result['warnings'])
