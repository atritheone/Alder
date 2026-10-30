"""Authored multi-page vertical merge, with independently flowing side cells."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import create_project,validate_project
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
counts={'MERGED':90,'UPPER_B':40,'UPPER_C':35,'LOWER_B':10,'LOWER_C':40}
if '--short-merge' in sys.argv: counts['MERGED']=4
if '--minimum' in sys.argv: counts={name:1 for name in counts}
if '--check' not in sys.argv:
    def para(text):return {'type':'paragraph','attrs':{'fontSize':9,'lineHeight':1,'spaceBefore':0,'spaceAfter':0,'widowOrphan':False,**({'lineSpacingMode':'exact','lineSpacing':12} if '--exact' in sys.argv else {})},'content':[{'type':'text','text':text}]}
    def cell(name,span=1,header=False):return {'type':'table_header' if header else 'table_cell','attrs':{'rowspan':span,'colspan':1,'colwidth':[136],'verticalAlign':('middle' if '--middle' in sys.argv else 'bottom' if '--bottom' in sys.argv else 'top') if name=='MERGED' else 'top','paddingTop':2,'paddingBottom':2,'paddingLeft':2,'paddingRight':2,'borderWidth':.75},'content':[para(f'{name}_{i:03}') for i in range(counts.get(name,1))]}
    table={'type':'table','content':[{'type':'table_row','attrs':{'allowSplit':False},'content':[cell('HEADER_A',header=True),cell('HEADER_B',header=True),cell('HEADER_C',header=True)]},{'type':'table_row','attrs':{'allowSplit':True},'content':[cell('MERGED',2),cell('UPPER_B'),cell('UPPER_C')]},{'type':'table_row','attrs':{'allowSplit':True},'content':[cell('LOWER_B'),cell('LOWER_C')]},{'type':'table_row','attrs':{'allowSplit':False},'content':[cell('FINAL_A'),cell('FINAL_B'),cell('FINAL_C')]}]}
    if '--minimum' in sys.argv:
        for row in table['content'][1:3]:row['attrs']['minHeight']=72
    if '--unequal' in sys.argv:
        table['content'][1]['content'][1]['attrs'].update(paddingTop=10,paddingBottom=0)
        table['content'][1]['content'][2]['attrs'].update(paddingTop=0,paddingBottom=10)
    p=create_project(template='blank');p['name']='Merged cell flow';p['settings'].update(documentKind='docx',includeTitle=False,pageSize='A5',marginMm=20,fontSize=9,lineHeight=1)
    p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':{'type':'doc','content':[para('BEFORE TABLE'),table,para('AFTER TABLE')]}}]};p=validate_project(p)
    result=build_export(p,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'expectedText':['BEFORE TABLE','AFTER TABLE']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    pdf=PdfReader(root/'word-rendered.pdf');pages=[p.extract_text() for p in pdf.pages];text=' '.join(pages)
    for name,count in counts.items():
        for i in range(count):assert text.count(f'{name}_{i:03}')==1,(name,i)
    restored=import_document(root/'word-resaved.docx')
    assert any(cell.get('attrs',{}).get('rowspan')==2 for node in restored['document']['content'] if node['type']=='table' for row in node['content'] for cell in row['content'])
    if '--minimum' in sys.argv:
        rows=next(node['content'] for node in restored['document']['content'] if node['type']=='table')
        assert [row['attrs']['minHeight'] for row in rows[1:3]]==[72,72]
        positions={}
        pdf.pages[0].extract_text(visitor_text=lambda text,cm,tm,font,size:positions.update({key:tm[5] for key in ['MERGED_000','UPPER_B_000','LOWER_B_000'] if key in text}))
        if '--unequal' in sys.argv:assert abs(positions['UPPER_B_000']-positions['LOWER_B_000']-64)<.1
        else:assert abs(positions['UPPER_B_000']-positions['MERGED_000']-63.625)<.1
    ownership={name:[next(i for i,p in enumerate(pages) if f'{name}_{j:03}' in p) for j in range(count)] for name,count in counts.items()}
    (root/'word-ownership.json').write_text(json.dumps(ownership),encoding='utf-8')
    print(json.dumps({'status':'passed','pages':len(pages),'lineRanges':{name:[values[0]+1,values[-1]+1] for name,values in ownership.items()}}))
