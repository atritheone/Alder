"""Continuation paragraphs must retain membership in every supported story."""
from pathlib import Path
import pytest
from alder.models import create_project,validate_project,document_text
from alder.publishing import build_export,import_document
from alder.document_notes import notes


def fixture(story,intro='text'):
    p=create_project(template='blank');p['settings'].update(documentKind='docx',includeTitle=False)
    p['styles'].append({'id':'continuation','name':'Continuation','kind':'paragraph','fontFamily':'Cambria','fontSize':15,'color':'#123456'})
    text=lambda value:{'type':'paragraph','content':[{'type':'text','text':value}]}
    continuation=text('Continued wording');continuation['attrs']={'styleId':'continuation','leftIndent':9,'firstLineIndent':3}
    listing={'type':'ordered_list','attrs':{'order':3},'content':[{'type':'list_item','content':[text('Item'),continuation]},{'type':'list_item','content':[text('Next item')]}]}
    lead=[] if story=='body' or intro=='none' else [text('Note introduction') if intro=='text' else {'type':'paragraph'}]
    document={'type':'doc','content':lead+[listing]}
    body=document if story=='body' else {'type':'doc','content':[text('Body')]}
    if story in ('footnote','endnote'):body['content'][0]['content'].append({'type':'document_note','attrs':{'kind':story,'body':document}})
    p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':body}]};p=validate_project(p)
    return p,document


@pytest.mark.parametrize('story,intro',[('body','text'),('footnote','text'),('endnote','text'),('footnote','none'),('endnote','none'),('footnote','empty'),('endnote','empty')])
def test_word_continuations_keep_authored_style_and_indents_in_each_story(tmp_path,story,intro):
    p,document=fixture(story,intro)
    result=import_document(Path(build_export(p,'docx',tmp_path)['path']))
    restored=result['document'] if story=='body' else notes([result['document']])[0]['attrs']['body']
    assert document_text(restored)==document_text(document)
    actual=restored['content'][-1];assert actual['type']=='ordered_list' and len(actual['content'])==2
    paragraphs=actual['content'][0]['content'];assert len(paragraphs)==2
    attrs=paragraphs[1]['attrs']
    assert attrs['fontSize']==15 and attrs['fontFamily']=='Cambria' and attrs['color'].lower()=='#123456'
    assert attrs['leftIndent']==pytest.approx(9,abs=.051) and attrs['firstLineIndent']==3


@pytest.mark.parametrize('story',['footnote','endnote'])
@pytest.mark.parametrize('mutation',['text','format','space'])
def test_word_authored_note_prefix_additions_are_preserved(tmp_path,story,mutation):
    from zipfile import ZipFile
    from lxml import etree
    from docx.oxml.ns import qn
    project,_=fixture(story,'none');path=Path(build_export(project,'docx',tmp_path)['path'])
    with ZipFile(path) as archive:parts={name:archive.read(name) for name in archive.namelist()}
    name=f'word/{story}s.xml';root=etree.fromstring(parts[name])
    prefix=next(p for p in root.iter(qn('w:p')) if p.find(qn('w:pPr')+'/'+qn('w:pStyle')) is not None)
    if mutation=='format':
        spacing=etree.SubElement(prefix.find(qn('w:pPr')),qn('w:spacing'));spacing.set(qn('w:before'),'360')
    else:
        run=etree.SubElement(prefix,qn('w:r'));text=etree.SubElement(run,qn('w:t'));text.text='Authored in Word' if mutation=='text' else ' '
    parts[name]=etree.tostring(root)
    with ZipFile(path,'w') as archive:
        for name,data in parts.items():archive.writestr(name,data)
    actual=notes([import_document(path)['document']])[0]['attrs']['body']
    assert actual['content'][0]['type']=='paragraph' and actual['content'][1]['type']=='ordered_list'
    first=actual['content'][0]
    if mutation=='text':assert document_text(first)=='Authored in Word'
    elif mutation=='space':assert document_text(first)==' '
    else:assert first['attrs']['spaceBefore']==18
