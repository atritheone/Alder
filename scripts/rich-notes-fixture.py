"""Authored lists, merged/split table cells and continuing note stories."""
import copy,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import create_project,validate_project,document_text
from alder.publishing import build_export,import_document
from alder.document_notes import notes
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
def para(value):return {'type':'paragraph','content':[{'type':'text','text':value}] if value else []}
def cell(value,**attrs):return {'type':'table_cell','attrs':{'colwidth':[160],**attrs},'content':[para(value)]}
if '--check' not in sys.argv:
    p=create_project(template='blank');p['name']='Rich note stories'
    p['settings'].update(documentKind='docx',includeTitle=False,pageSize='A5',marginMm=20)
    listing={'type':'ordered_list','attrs':{'order':3,'listStyle':'upper-roman'},'content':[
        {'type':'list_item','content':[para('LIST FIRST'),{'type':'bullet_list','attrs':{'listStyle':'square'},'content':[{'type':'list_item','content':[para('LIST NESTED')]}]}]},
        {'type':'list_item','content':[para('LIST SECOND')]},
    ]}
    rows=[]
    for i in range(24):
        rows.append({'type':'table_row','attrs':{'allowSplit':True},'content':[cell(f'LEFT{i:02d}'),cell(f'RIGHT{i:02d}',background='#e8eef5' if i%2==0 else None)]})
    rows[0]['content']=[{**c,'type':'table_header'} for c in rows[0]['content']]
    rows[2]['content'][0]['attrs']['rowspan']=2;rows[3]['content'].pop(0)
    rows[6]['content'][0]['content']=[para(f'LONG{i:02d} explanation') for i in range(45)]
    rows[6]['content'][1]['attrs']['verticalAlign']='bottom'
    note={'type':'doc','content':[para('NOTE OPEN'),listing,{'type':'table','content':rows},para('NOTE CLOSE')]}
    end=copy.deepcopy(listing);end['content'][0]['content'][0]=para('END FIRST');end['content'][0]['content'][1]['content'][0]['content'][0]=para('END NESTED');end['content'][1]['content'][0]=para('END SECOND')
    blocks=[{'type':'paragraph','content':[{'type':'text','text':'BODY ANCHOR '},{'type':'document_note','attrs':{'kind':'footnote','blockId':'rich-foot','body':note}}]}]
    blocks += [para(f'BODY{i:02d} A short paragraph keeps the reference and its note together.') for i in range(18)]
    blocks.append({'type':'paragraph','content':[{'type':'text','text':'BODY END '},{'type':'document_note','attrs':{'kind':'endnote','blockId':'rich-end','body':{'type':'doc','content':[end]}}}]})
    p['book']={'version':1,'chapters':[{'id':'main','title':'Document','include':True,'document':{'type':'doc','content':blocks}}]};p=validate_project(p)
    result=build_export(p,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'footnotesExpected':1,'endnotesExpected':1,'skipListNumbers':True,'expectedText':['BODY ANCHOR','BODY END']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    expected=[f'LONG{i:02d}' for i in range(45)]+[f'LEFT{i:02d}' for i in range(1,24) if i not in (3,6)]+[f'RIGHT{i:02d}' for i in range(1,24)]+[f'BODY{i:02d}' for i in range(18)]
    checks=[]
    for pdf in [root/'word-rendered.pdf',root.parent/'rich-notes-ui'/'notes.pdf']:
        if not pdf.exists():continue
        pages=PdfReader(pdf).pages;text='\n'.join(page.extract_text() for page in pages)
        for marker in expected:assert text.count(marker)==1,(pdf.name,marker,text.count(marker))
        checks.append({'file':pdf.name,'pages':len(pages),'markers':len(expected)})
    native=root/'word-resaved.docx'
    if native.exists():
        restored=import_document(native);found=notes([restored['document']]);assert len(found)==2
        table=next(node for node in found[0]['attrs']['body']['content'] if node['type']=='table')
        assert len(table['content'])==24
        assert table['content'][2]['content'][0]['attrs']['rowspan']==2
        assert any(node['type']=='ordered_list' for node in found[0]['attrs']['body']['content'])
        assert all(marker in document_text(found[0]['attrs']['body']) for marker in expected if not marker.startswith('BODY'))
    print(json.dumps({'status':'passed','checks':checks}))
