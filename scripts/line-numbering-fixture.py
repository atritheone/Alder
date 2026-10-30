"""Native line numbering evidence: intervals, breaks, empty lines and tables."""
import json,sys,re
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import create_project,validate_project
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' in sys.argv:
    from pypdf import PdfReader
    original=json.loads((root/'fixture-project.json').read_text(encoding='utf-8'))
    restored=import_document(root/'word-resaved.docx')
    assert restored['settings']['lineNumbering']==original['settings']['lineNumbering']
    sections=lambda doc:[n['attrs']['page'].get('lineNumbering') for n in doc['content'] if n['type']=='section_break']
    wanted=sections(original['book']['chapters'][0]['document'])
    assert sections(restored['document'])==wanted
    labels=[]
    for page in PdfReader(root/'word-rendered.pdf').pages:
        numbers=[int(m[1]) for line in page.extract_text(extraction_mode='layout').splitlines() if (m:=re.match(r'^\s*(\d+)(?:\s|$)',line))]
        labels.append(numbers[:-1]) # Footer page label is separate from body lines.
    expected=[[3,4,10,11],[10,11],[]] if wanted else [[3,4,5,6,7,8,9],[10,11]] if original['settings']['lineNumbering']['step']==1 else [[4,6,8],[10]]
    assert labels==expected,(labels,expected)
    print('Word resave and physical line labels passed:',labels)
    raise SystemExit()
p=create_project('Line numbering fixture',template='blank')
restart=next((a for a in sys.argv[2:] if not a.startswith('--')),'continuous')
p['settings'].update(documentKind='docx',includeTitle=False,footer=True,pageSize='A5',lineNumbering={'start':3,'step':1 if '--all' in sys.argv else 2,'distance':6,'restart':restart})
def paragraph(text):
    return {'type':'paragraph','attrs':{'spaceBefore':0,'spaceAfter':0,'lineSpacingMode':'exact','lineSpacing':18,'widowOrphan':False},'content':[n for i,line in enumerate(text.split('\n')) for n in ([{'type':'hard_break'}] if i else [])+([{'type':'text','text':line}] if line else [])]}
doc={'type':'doc','content':[paragraph('ALPHA'),paragraph('BRAVO\nCHARLIE\n\nDELTA'),{'type':'table','content':[{'type':'table_row','content':[{'type':'table_cell','content':[paragraph('TABLE'+str(i))]}]} for i in range(2)]},paragraph('ECHO'),{'type':'page_break'},paragraph('FOXTROT'),paragraph('GOLF')]}
if '--sections' in sys.argv:
    settings={'pageSize':'A5','marginMm':20,'lineNumbering':{'start':10,'step':1,'distance':6,'restart':'newSection'}}
    doc['content']=[paragraph('ALPHA'),paragraph('BRAVO'),{'type':'section_break','attrs':{'kind':'continuous','page':settings}},paragraph('CHARLIE'),paragraph('DELTA'),{'type':'section_break','attrs':{'kind':'nextPage','page':settings}},paragraph('ECHO'),paragraph('FOXTROT'),{'type':'section_break','attrs':{'kind':'nextPage','page':{**settings,'lineNumbering':None}}},paragraph('GOLF')]
p['book']={'version':1,'chapters':[{'id':'main','title':'Text','include':True,'document':doc}]};p=validate_project(p)
result=build_export(p,'docx',root)
(root/'fixture-project.json').write_text(json.dumps(p),encoding='utf-8')
(root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'expectedText':['ALPHA','GOLF']}),encoding='utf-8')
