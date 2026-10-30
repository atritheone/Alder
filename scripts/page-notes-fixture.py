"""Authored fixture for native per-page note numbering and NOTEREF fields."""
import json,re,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import create_project,validate_project
from alder.note_options import note_options
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    p=create_project(template='blank');p['name']='Page note numbering'
    options=note_options();options['footnote'].update(restart='page',start=3)
    p['settings'].update(documentKind='docx',includeTitle=False,pageSize='A5',marginMm=20,noteOptions=options)
    def text(value):return {'type':'text','text':value}
    def para(value):return {'type':'paragraph','content':[text(value)]}
    def note(name):return {'type':'document_note','attrs':{'kind':'footnote','blockId':name,'body':{'type':'doc','content':[para('FOOT_'+name.upper())]}}}
    blocks=[]
    for index,group in enumerate((('a','b'),('c','d'),('e',))):
        if index:blocks.append({'type':'page_break'})
        for name in group:blocks.append({'type':'paragraph','content':[text('ANCHOR_'+name.upper()),note(name)]})
        if index==2:
            for name in 'abcde':blocks.append({'type':'paragraph','content':[text('REF_'+name.upper()+' '),{'type':'cross_reference','attrs':{'targetId':name,'referenceFormat':'number'},'content':[text('99')]}]})
    p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':{'type':'doc','content':blocks}}]};p=validate_project(p)
    result=build_export(p,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'footnotesExpected':5,'endnotesExpected':0,'skipListNumbers':True,'expectedText':['ANCHOR_A','ANCHOR_C','ANCHOR_E']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    restored=import_document(root/'word-resaved.docx')
    assert restored['settings']['noteOptions']['footnote']['restart']=='page'
    pdf=PdfReader(root/'word-rendered.pdf');assert len(pdf.pages)==3
    for page,expected in zip(pdf.pages,(['3 FOOT_A','4 FOOT_B'],['3 FOOT_C','4 FOOT_D'],['3 FOOT_E'])):
        words=re.sub(r'\s+',' ',page.extract_text())
        for marker in expected:assert marker in words,(marker,words)
    words=re.sub(r'\s+',' ',pdf.pages[-1].extract_text())
    for name,number in zip('ABCDE',[3,4,3,4,3]):assert f'REF_{name} {number}' in words,words
    print(json.dumps({'status':'passed','pages':3,'labels':[3,4,3,4,3],'warnings':restored['warnings']}))
