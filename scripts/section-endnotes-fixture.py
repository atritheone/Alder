"""Section-end note placement in independently rendered Word and Alder."""
import copy,json,re,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import create_project,validate_project
from alder.note_options import note_options
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
variant='columns' if '--columns' in sys.argv else 'continuous' if '--continuous' in sys.argv else 'pages'
def paragraph(text):return {'type':'paragraph','content':[{'type':'text','text':text}]}
def fixture():
    p=create_project(template='blank');p['name']='Section endnotes '+variant
    options=note_options();options['endnote'].update(placement='sectEnd',restart='section')
    page={'pageSize':'A5','marginMm':18}
    if variant=='columns':page['columns']={'count':2,'gapMm':8}
    p['settings'].update(documentKind='docx',includeTitle=False,**page,noteOptions=options)
    blocks=[]
    for section in range(3):
        if section:
            attrs={'kind':'continuous' if variant in ('columns','continuous') else 'nextPage','page':page}
            blocks.append({'type':'section_break','attrs':attrs})
        anchor=paragraph(f'BODY_{section} This section has a note.')
        body={'type':'doc','content':[paragraph(f'NOTE_{section}_{index:03d} Additional explanation.') for index in range(90 if section==0 else 2)]}
        anchor['content'].append({'type':'document_note','attrs':{'kind':'endnote','blockId':f'note{section}','body':body}})
        if section==0:
            anchor['content'].append({'type':'document_note','attrs':{'kind':'footnote','blockId':'foot0','body':{'type':'doc','content':[paragraph('FOOT_0 Companion footnote.')]}}})
        blocks.extend([anchor,paragraph(f'FINAL_{section} Last body paragraph.')])
    p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':{'type':'doc','content':blocks}}]}
    return validate_project(p)
if '--check' not in sys.argv:
    p=fixture();result=build_export(p,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'footnotesExpected':1,'endnotesExpected':3,'skipListNumbers':True,'expectedText':['BODY_0','FINAL_2']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    pages=[page.extract_text() for page in PdfReader(root/'word-rendered.pdf').pages]
    text='\n'.join(pages)
    for section,count in [(0,90),(1,2),(2,2)]:
        for index in range(count):assert text.count(f'NOTE_{section}_{index:03d}')==1,(section,index)
        assert text.index(f'FINAL_{section}')<text.index(f'NOTE_{section}_000')
        if section<2:assert text.index(f'NOTE_{section}_{count-1:03d}')<text.index(f'BODY_{section+1}')
    restored=import_document(root/'word-resaved.docx')
    assert restored['settings']['noteOptions']['endnote']['placement']=='sectEnd'
    assert not any('converted' in warning for warning in restored['warnings']),restored['warnings']
    print(json.dumps({'status':'passed','pages':len(pages),'warnings':restored['warnings']}))
