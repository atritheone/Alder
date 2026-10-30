"""Independent Word rendering of section-specific note number settings."""
import copy,json,re,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import create_project,validate_project
from alder.note_options import note_options
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
def text(value):return {'type':'text','text':value}
def para(value):return {'type':'paragraph','content':[text(value)]}
if '--check' not in sys.argv:
    p=create_project(template='blank');p['name']='Section note numbering'
    options=note_options();options['footnote']['start']=3;options['endnote']['start']=4
    p['settings'].update(documentKind='docx',includeTitle=False,pageSize='A5',marginMm=20,noteOptions=options)
    variants=[options]
    for fmt,start,restart,placement in [('upperRoman',7,'continuous','beneathText'),('lowerLetter',2,'section','pageBottom'),('lowerLetter',2,'section','pageBottom'),('decimal',8,'continuous','pageBottom'),('upperRoman',6,'page','pageBottom')]:
        row=copy.deepcopy(options);row['footnote'].update(format=fmt,start=start,restart=restart,placement=placement)
        row['endnote'].update(format=fmt,start=start,restart='section' if restart=='section' else 'continuous')
        variants.append(row)
    blocks=[]
    for index,variant in enumerate(variants):
        if index:blocks.append({'type':'section_break','attrs':{'kind':'nextPage','page':{'pageSize':'A5','marginMm':20},'noteOptions':None if index==3 else variant}})
        for offset in range(2):
            content=[text(f'ANCHOR_{index}_{offset} ')]
            for kind in ('footnote','endnote'):
                name=f'{kind}_{index}_{offset}'
                content.append({'type':'document_note','attrs':{'kind':kind,'blockId':name,'body':{'type':'doc','content':[para(name.upper())]}}})
                content.append(text(' '))
            blocks.append({'type':'paragraph','content':content})
    p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':{'type':'doc','content':blocks}}]};p=validate_project(p)
    result=build_export(p,'docx',root)
    if '--probe' in sys.argv:
        from docx import Document
        from docx.oxml.ns import qn
        from docx.oxml import OxmlElement
        doc=Document(result['path'])
        for section,variant in zip(doc.sections,variants):
            for kind,row in variant.items():
                props=section._sectPr.find(qn('w:'+kind+'Pr'))
                for key,value in [('numFmt',row['format']),('numStart',str(row['start'])),('numRestart',{'page':'eachPage','section':'eachSect'}.get(row['restart'],'continuous')),('pos',row.get('placement','docEnd'))]:
                    child=props.find(qn('w:'+key));child.set(qn('w:val'),value)
        doc.save(result['path'])
    (root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'footnotesExpected':12,'endnotesExpected':12,'skipListNumbers':True,'expectedText':['ANCHOR_0_0','ANCHOR_5_1']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    pdf=PdfReader(root/'word-rendered.pdf')
    pages=[re.sub(r'\s+',' ',page.extract_text()) for page in pdf.pages]
    restored=import_document(root/'word-resaved.docx')
    expected=[['3','4'],['IX','X'],['b','c'],['b','c'],['16','17'],['VI','VII']]
    assert len(pages)==6
    for index,numbers in enumerate(expected):
        for offset,number in enumerate(numbers):assert f'{number} FOOTNOTE_{index}_{offset}' in pages[index],pages[index]
    expected[-1]=['XVI','XVII'];expected[0]=['iv','v']
    for index,numbers in enumerate(expected):
        for offset,number in enumerate(numbers):assert f'{number} ENDNOTE_{index}_{offset}' in pages[-1],pages[-1]
    overrides=[n['attrs'].get('noteOptions') for n in restored['document']['content'] if n['type']=='section_break']
    assert overrides[0]['footnote']['format']=='upperRoman' and overrides[1]['footnote']['restart']=='section'
    assert overrides[2] is None and overrides[3]['footnote']['start']==8 and overrides[4]['footnote']['restart']=='page'
    assert not any('Section-specific' in warning for warning in restored['warnings'])
    print(json.dumps({'status':'passed','pages':len(pages),'warnings':restored['warnings']}))
