"""Original native Word evidence for sections sharing a physical page."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import create_project,validate_project
from alder.publishing import build_export,import_document

def fixture(case='ordinary'):
    p=create_project('Continuous sections','blank')
    def paragraph(text):return {'type':'paragraph','content':[{'type':'text','text':text}]}
    def story(text):return {'type':'doc','content':[paragraph(text)]}
    footer={'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':'Page '},{'type':'document_field','attrs':{'fieldKind':'page'},'content':[{'type':'text','text':'?'}]}]}]}
    p['settings'].update(documentKind='docx',includeTitle=False,runningMatter={'header':{'default':story('PRE HEADER')},'footer':{'default':footer}})
    attrs={'kind':'continuous','page':{'pageSize':'A4','marginMm':22},'runningMatter':{'differentFirst':case=='first','header':{'default':story('POST HEADER'),'first':story('NEW FIRST HEADER')}}}
    if case.startswith('restart'):attrs['numberingStart']=9
    if case=='paper':attrs['page'].update(pageSize='A5',orientation='landscape')
    if case=='horizontal':attrs['page'].update(marginLeftMm=40,marginRightMm=40)
    if case.startswith('vertical'):attrs['page'].update(marginTopMm=40,marginBottomMm=40)
    p['book']={'version':1,'chapters':[{'id':'chapter','title':'Document','include':True,'document':{'type':'doc','content':[paragraph('BEFORE SECTION'),{'type':'section_break','attrs':attrs},paragraph('AFTER SECTION'),{'type':'page_break'},paragraph('LATER BODY')]}}]}
    if case.endswith('-long'):
        p['book']['chapters'][0]['document']['content'][3:3]=[paragraph(f'LINE {i:02d}') for i in range(55)]
    if case=='restart-field':
        p['book']['chapters'][0]['document']['content'][2]['content'].append({'type':'document_field','attrs':{'fieldKind':'page'},'content':[{'type':'text','text':'?'}]})
    return validate_project(p)

if __name__=='__main__':
    root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
    case=sys.argv[2] if len(sys.argv)>2 else 'ordinary'
    if '--check' not in sys.argv:
        p=fixture(case);result=build_export(p,'docx',root)
        (root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
        (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'runningMatterExpected':True,'skipListNumbers':True,'expectedText':['BEFORE SECTION','AFTER SECTION','LATER BODY']}),encoding='utf-8')
    else:
        from pypdf import PdfReader
        pages=PdfReader(root/'word-rendered.pdf').pages
        report=[]
        for page in pages:
            runs=[]
            page.extract_text(visitor_text=lambda text,cm,tm,font,size:runs.append({'text':text.strip(),'x':round(tm[4],1),'y':round(tm[5],1)}) if text.strip() else None)
            report.append({'width':float(page.mediabox.width),'height':float(page.mediabox.height),'text':page.extract_text(),'runs':runs})
        (root/'observed-layout.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        imported=import_document(root/'word-resaved.docx')
        assert next(n for n in imported['document']['content'] if n['type']=='section_break')['attrs']['kind']=='continuous'
        expected=3 if case=='paper' else 4 if case=='vertical-long' else 2
        assert len(pages)==expected
        assert 'PRE HEADER' in report[0]['text'] and 'POST HEADER' in report[-1]['text']
        assert ('AFTER SECTION' in report[0]['text'])==(case!='paper')
        if case.startswith('restart'):assert 'Page 10' in report[-1]['text']
        print(json.dumps({'case':case,'pages':report}))
