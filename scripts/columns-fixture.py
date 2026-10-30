import json,runpy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
source=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_columns.py'))
if '--check' not in sys.argv:
    project=source['fixture']()
    if '--continuous' in sys.argv:
        nodes=[]
        for i in range(15):
            if i:nodes.append({'type':'hard_break'})
            nodes.append({'type':'text','text':f'CONTINUOUS{i:03} A short line.'})
        project['book']['chapters'][0]['document']['content']=[{'type':'paragraph','attrs':{'lineSpacingMode':'exact','lineSpacing':15,'spaceAfter':0,'spaceBefore':0},'content':nodes},{'type':'section_break','attrs':{'kind':'continuous','page':{'pageSize':'A5','marginMm':15,'columns':{'count':1,'gapMm':8}}}},{'type':'paragraph','content':[{'type':'text','text':'AFTER COLUMNS'}]}]
    result=build_export(project,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'expectedText':['AFTER COLUMNS'] if '--continuous' in sys.argv else ['LEFT COLUMN','RIGHT COLUMN','NEXT PAGE','THREE COLUMN SECTION','SECOND OF THREE']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    restored=import_document(root/'word-resaved.docx')
    assert restored['settings']['columns']['count']==2
    report=[]
    for page in PdfReader(root/'word-rendered.pdf').pages:
        points=[]
        def visit(text,cm,tm,font,size):
            if text.strip():points.append({'text':text,'x':cm[4]+tm[4],'y':cm[5]+tm[5]})
        page.extract_text(visitor_text=visit);report.append(points)
    (root/'positions.json').write_text(json.dumps(report),encoding='utf-8')
    print(json.dumps({'status':'passed','pages':len(report),'columns':restored['settings']['columns']}))
