import copy
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

import pytest

from alder.models import create_project, validate_project, validate_document, document_text
from alder.publishing import build_export, import_document
from alder.odt_styles import NS, q
from alder.odt_writer import MIME


def p(text, attrs=None, marks=None):
    return {'type':'paragraph','attrs':attrs or {},'content':[{'type':'text','text':text,**({'marks':marks} if marks else {})}]}


def fixture():
    project=create_project(template='blank')
    project['name']='OpenDocument fixture'
    project['settings'].update(documentKind='docx',includeTitle=False,footer=False,pageSize='A5',orientation='landscape',marginMm=18,author='Alder test')
    listing={'type':'ordered_list','attrs':{'order':3,'listStyle':'upper-roman'},'content':[
        {'type':'list_item','content':[p('ITEM_ONE'),{'type':'bullet_list','attrs':{'listStyle':'square'},'content':[{'type':'list_item','content':[p('NESTED_ITEM')]}]}]},
        {'type':'list_item','content':[p('ITEM_TWO')]}]}
    table={'type':'table','attrs':{'align':'center'},'content':[
        {'type':'table_row','content':[{'type':'table_header','attrs':{'colspan':2,'colwidth':[120,180],'background':'#ddeeff'},'content':[p('HEADER')]}]},
        {'type':'table_row','attrs':{'allowSplit':True,'minHeight':30},'content':[
            {'type':'table_cell','attrs':{'rowspan':2,'colwidth':[120],'verticalAlign':'middle','paddingLeft':8},'content':[p('MERGED')]},
            {'type':'table_cell','attrs':{'colwidth':[180]},'content':[p('RIGHT_ONE')]}]},
        {'type':'table_row','content':[{'type':'table_cell','attrs':{'colwidth':[180]},'content':[p('RIGHT_TWO')]}]}]}
    content=[{'type':'heading','attrs':{'level':2},'content':[{'type':'text','text':'ODT_HEADING'}]},
        p('  Exact  wording\twith emoji \U0001f600 and trailing  ',{'align':'justify','spaceAfter':13,'leftIndent':8,'firstLineIndent':-4,'lineSpacingMode':'exact','lineSpacing':18,'keepTogether':True,'textLanguage':'en-GB','tabStops':[{'position':144,'align':'right','leader':'dot'}]},[{'type':'strong'},{'type':'em'},{'type':'highlight','attrs':{'color':'#ffff00'}},{'type':'text_style','attrs':{'fontFamily':'Cambria','fontSize':13,'color':'#224466'}}]),
        listing,table,p('NOTE_ANCHOR')]
    content[-1]['content'].append({'type':'document_note','attrs':{'blockId':'odt_note','kind':'footnote','body':{'type':'doc','content':[p('NOTE_TEXT'),copy.deepcopy(listing)]}}})
    project['book']={'version':1,'chapters':[{'id':'main','title':'Document','include':True,'document':{'type':'doc','content':content}}]}
    return validate_project(project)


def test_odt_native_package_and_editable_roundtrip(tmp_path):
    project=fixture();before=copy.deepcopy(project)
    result=build_export(project,'odt',tmp_path)
    assert project==before
    with zipfile.ZipFile(result['path']) as archive:
        assert archive.infolist()[0].filename=='mimetype'
        assert archive.infolist()[0].compress_type==zipfile.ZIP_STORED
        assert archive.read('mimetype').decode()==MIME
        xml=ET.fromstring(archive.read('content.xml'))
        assert xml.find('.//'+q('text:note')) is not None
        assert len(xml.findall('.//'+q('table:covered-table-cell')))==2
        assert b'alder' not in archive.read('content.xml').lower()
        manifest=ET.fromstring(archive.read('META-INF/manifest.xml'))
        paths={n.get(q('manifest:full-path')) for n in manifest}
        assert paths=={'/','content.xml','styles.xml','meta.xml'}
    restored=import_document(Path(result['path']))
    validate_document(restored['document'])
    doc=restored['document']['content']
    assert document_text(restored['document'])==document_text(project['book']['chapters'][0]['document'])
    assert doc[0]['type']=='heading' and doc[0]['attrs']['level']==2
    assert doc[1]['attrs']['align']=='justify'
    assert doc[1]['attrs']['textLanguage']=='en-GB'
    assert doc[1]['attrs']['tabStops']==[{'position':144,'align':'right','leader':'dot'}]
    assert doc[1]['attrs']['lineSpacingMode']=='exact' and doc[1]['attrs']['lineSpacing']==18
    assert {'strong','em','highlight','text_style'}=={mark['type'] for mark in doc[1]['content'][0]['marks']}
    assert doc[2]['attrs']['order']==3 and doc[2]['attrs']['listStyle']=='upper-roman'
    assert doc[2]['content'][0]['content'][1]['attrs']['listStyle']=='square'
    assert doc[3]['content'][0]['content'][0]['attrs']['colspan']==2
    assert doc[3]['content'][1]['content'][0]['attrs']['rowspan']==2
    assert doc[3]['content'][1]['content'][0]['attrs']['colwidth']==[120]
    note=doc[4]['content'][1]
    assert note['type']=='document_note' and note['attrs']['body']['content'][1]['type']=='ordered_list'
    assert restored['settings']['pageWidthMm']==pytest.approx(210)
    assert restored['settings']['pageHeightMm']==pytest.approx(148)
    assert restored['settings']['author']=='Alder test'


def external_odt(tmp_path, body, styles='', extras=None):
    path=tmp_path/'external.odt'
    namespaces=' '.join(f'xmlns:{key}="{uri}"' for key,uri in NS.items())
    content=f'<office:document-content {namespaces} office:version="1.3"><office:automatic-styles>{styles}</office:automatic-styles><office:body><office:text>{body}</office:text></office:body></office:document-content>'
    with zipfile.ZipFile(path,'w') as archive:
        archive.writestr('mimetype',MIME)
        archive.writestr('content.xml',content)
        archive.writestr('META-INF/manifest.xml',f'<manifest:manifest xmlns:manifest="{NS["manifest"]}" manifest:version="1.3"/>')
        for name,data in (extras or {}).items(): archive.writestr(name,data)
    return path


def test_external_style_inheritance_whitespace_links_and_bookmarks(tmp_path):
    styles='<style:style style:name="Parent" style:family="paragraph"><style:text-properties fo:font-weight="bold" fo:font-size="14pt"/></style:style><style:style style:name="Child" style:family="paragraph" style:parent-style-name="Parent"><style:paragraph-properties fo:margin-left="1cm"/></style:style><style:style style:name="Plain" style:family="text"><style:text-properties fo:font-weight="normal"/></style:style>'
    body='<text:p text:style-name="Child"><text:bookmark-start text:name="A bookmark"/>Bold<text:s text:c="2"/><text:span text:style-name="Plain">plain</text:span><text:bookmark-end text:name="A bookmark"/><text:tab/><text:a xlink:href="#A%20bookmark">Back</text:a><text:line-break/>End</text:p>'
    result=import_document(external_odt(tmp_path,body,styles));validate_document(result['document'])
    p=result['document']['content'][0]
    assert document_text(p)=='Bold  plain\tBack\nEnd'
    assert p['attrs']['leftIndent']==pytest.approx(72/2.54)
    plain=next(n for n in p['content'] if n.get('text')=='plain')
    assert not any(mark['type']=='strong' for mark in plain['marks'])
    bookmark=p['content'][0]
    link=next(n for n in p['content'] if n.get('text')=='Back')
    assert next(m for m in link['marks'] if m['type']=='link')['attrs']['href']=='#'+bookmark['attrs']['blockId']


@pytest.mark.parametrize('body,match',[
    ('<text:p><text:s text:c="1000000000"/></text:p>','excessive count'),
    ('<text:tracked-changes><text:changed-region/></text:tracked-changes><text:p>Body</text:p>','tracked changes'),
    ('<text:p>Body<office:annotation><text:p>Review</text:p></office:annotation></text:p>','review comments'),
    ('<text:p><draw:frame><draw:object xlink:href="Object1"/></draw:frame></text:p>','embedded object'),
    ('<table:table><table:table-row table:number-rows-repeated="1000000000"/></table:table>','excessive count'),
    ('<text:p><draw:frame><draw:image xlink:href="https://example.com/picture.png"/></draw:frame></text:p>','external'),
    ('<table:table><table:table-row><table:covered-table-cell/></table:table-row></table:table>','unanchored'),
])
def test_unsupported_or_expansive_input_is_not_silently_discarded(tmp_path,body,match):
    with pytest.raises(ValueError,match=match): import_document(external_odt(tmp_path,body))


def test_odt_conversions_are_explicit(tmp_path):
    project=fixture()
    project['book']['chapters'][0]['document']['content'].insert(1,{'type':'section_break','attrs':{'breakType':'nextPage','page':{'pageSize':'A4'}}})
    project['settings']['firstPageNumber']=7
    result=build_export(project,'odt',tmp_path)
    assert any('section and column breaks' in warning for warning in result['warnings'])
    assert any('starting numbers' in warning for warning in result['warnings'])


def test_word_nested_style_scaffold_is_not_an_empty_bullet(tmp_path):
    styles='<text:list-style style:name="Num"><text:list-level-style-number text:level="1" style:num-format="I"/></text:list-style><text:list-style style:name="Bullet"><text:list-level-style-bullet text:level="2" text:bullet-char="&#x25aa;"/></text:list-style>'
    body='<text:list text:style-name="Num"><text:list-item text:start-value="3"><text:p>First</text:p></text:list-item></text:list><text:list text:style-name="Bullet"><text:list-item><text:list><text:list-item><text:p>Nested</text:p></text:list-item></text:list></text:list-item></text:list><text:list text:style-name="Num" text:continue-numbering="true"><text:list-item><text:p>Second</text:p></text:list-item></text:list>'
    result=import_document(external_odt(tmp_path,body,styles))
    blocks=result['document']['content']
    assert len(blocks)==1 and len(blocks[0]['content'])==2
    assert blocks[0]['content'][0]['content'][1]['type']=='bullet_list'
    assert document_text(result['document'])=='First\nNested\nSecond'


def test_raster_picture_uses_editor_width_and_keeps_alternative_text(tmp_path):
    import io
    from PIL import Image
    data=io.BytesIO();Image.new('RGB',(40,20),'blue').save(data,format='PNG')
    body='<text:p>Anchor<draw:frame text:anchor-type="as-char" svg:width="40pt" svg:height="40pt"><draw:image xlink:href="Pictures/p.png"/><svg:desc>Blue picture</svg:desc></draw:frame></text:p>'
    result=import_document(external_odt(tmp_path,body,extras={'Pictures/p.png':data.getvalue()}))
    picture=result['document']['content'][0]['content'][1]
    assert picture['type']=='inline_image'
    assert set(picture['attrs'])=={'assetId','alt','width'}
    assert picture['attrs']['width']==pytest.approx(40*96/72)
    assert picture['attrs']['alt']=='Blue picture' and result['assets']
    assert any('aspect ratio' in warning for warning in result['warnings'])


def test_shading_and_highlight_are_distinct_and_notes_keep_highlight(tmp_path):
    project=fixture()
    paragraph=project['book']['chapters'][0]['document']['content'][1]
    paragraph['attrs'].update(paragraphBackground='#ddeeff',paragraphPadding=4,paragraphBorderWidth=.5,paragraphBorderColor='#224466')
    note=project['book']['chapters'][0]['document']['content'][-1]['content'][-1]
    note['attrs']['body']['content'][0]['content'][0]['marks']=[{'type':'highlight','attrs':{'color':'#ffff00'}}]
    imported=import_document(Path(build_export(project,'odt',tmp_path)['path']))
    validate_document(imported['document'])
    paragraph=imported['document']['content'][1]
    assert paragraph['attrs']['paragraphBackground']=='#ddeeff'
    assert paragraph['attrs']['paragraphPadding']==4 and paragraph['attrs']['paragraphBorderWidth']==.5
    assert next(mark for mark in paragraph['content'][0]['marks'] if mark['type']=='highlight')['attrs']['color']=='#ffff00'
    assert any(mark['type']=='highlight' for mark in imported['document']['content'][-1]['content'][-1]['attrs']['body']['content'][0]['content'][0]['marks'])
