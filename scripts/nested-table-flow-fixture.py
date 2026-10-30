"""Authored nested tables with parallel cell stories and two header levels."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import create_project,validate_project
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
counts={'NEST_A':70,'NEST_B':40,'OUTER_B':110}
if '--check' in sys.argv:
    from pypdf import PdfReader
    pages=PdfReader(root/'word-rendered.pdf').pages;text=' '.join(p.extract_text() for p in pages)
    for name,count in counts.items():
        for i in range(count):assert text.count(f'{name}_{i:03}')==1,(name,i)
    p=import_document(root/'word-resaved.docx')['document']
    def tables(node):return int(node['type']=='table')+sum(tables(child) for child in node.get('content',[]))
    assert tables(p)==2
    print(json.dumps({'status':'passed','pages':len(pages),'tables':tables(p)}));sys.exit()
def para(text):return {'type':'paragraph','attrs':{'fontSize':9,'lineSpacingMode':'exact','lineSpacing':12,'spaceBefore':0,'spaceAfter':0,'widowOrphan':False},'content':[{'type':'text','text':text}]}
def cell(name,width,header=False):return {'type':'table_header' if header else 'table_cell','attrs':{'colwidth':[width],'verticalAlign':'top','paddingTop':2,'paddingBottom':2,'paddingLeft':2,'paddingRight':2,'borderWidth':.75},'content':[para(f'{name}_{i:03}') for i in range(counts.get(name,1))]}
def row(cells,split=True):return {'type':'table_row','attrs':{'allowSplit':split},'content':cells}
nested={'type':'table','content':[row([cell('INNER_HEAD_A',130,True),cell('INNER_HEAD_B',130,True)],False),row([cell('NEST_A',130),cell('NEST_B',130)]),row([cell('INNER_FINAL_A',130),cell('INNER_FINAL_B',130)],False)]}
left=cell('OUTER_A',270);left['content'].extend([nested,para('AFTER_NESTED')])
table={'type':'table','content':[row([cell('OUTER_HEAD_A',270,True),cell('OUTER_HEAD_B',138,True)],False),row([left,cell('OUTER_B',138)]),row([cell('OUTER_FINAL_A',270),cell('OUTER_FINAL_B',138)],False)]}
p=create_project('Nested table flow',template='blank');p['settings'].update(documentKind='docx',includeTitle=False,pageSize='A5',marginMm=20,fontSize=9,lineHeight=1)
p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':{'type':'doc','content':[para('BEFORE TABLE'),table,para('AFTER TABLE')]}}]};p=validate_project(p)
result=build_export(p,'docx',root)
(root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
(root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'expectedText':['BEFORE TABLE','AFTER TABLE','AFTER_NESTED']}),encoding='utf-8')
