"""Native Word row-break semantics and lossless reimport qualification."""
import json
import re
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import create_project, validate_project
from alder.publishing import build_export, import_document


def fixture(allow):
    project=create_project('Row breaks','blank')
    project['settings'].update(documentKind='docx',includeTitle=False,footer=False,pageSize='Custom',pageWidthMm=158.75,pageHeightMm=105.833333333,marginMm=20*25.4/96)
    def paragraph(text):return {'type':'paragraph','attrs':{'spaceBefore':0,'spaceAfter':0,'lineSpacingMode':'exact','lineSpacing':18,'widowOrphan':False},'content':[{'type':'text','text':text}]}
    def cell(prefix,count,header=False):return {'type':'table_header' if header else 'table_cell','content':[paragraph(f'{prefix}{i:03}') for i in range(count)]}
    doc={'type':'doc','content':[*[paragraph(f'INTRO{i}') for i in range(6)],{'type':'table','content':[
        {'type':'table_row','content':[cell('HEADLEFT',1,True),cell('HEADRIGHT',1,True)]},
        {'type':'table_row','attrs':{'allowSplit':allow},'content':[cell('LEFT',8),cell('RIGHT',6)]},
        {'type':'table_row','attrs':{'allowSplit':True},'content':[cell('TAILLEFT',8),cell('TAILRIGHT',7)]},
    ]},paragraph('AFTER')]}
    project['book']={'version':1,'chapters':[{'id':'chapter','title':'Document','include':True,'document':doc}]}
    return validate_project(project)


if __name__=='__main__':
    root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
    allow=sys.argv[2]=='true'
    if '--check' not in sys.argv:
        project=fixture(allow);export=build_export(project,'docx',root)
        (root/'fixture-exports.json').write_text(json.dumps({'docx':export,'skipListNumbers':True,'expectedText':['LEFT000','RIGHT005','TAILLEFT007','AFTER']}),encoding='utf-8')
        (root/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
    else:
        from pypdf import PdfReader
        imported=import_document(root/'word-resaved.docx')
        rows=next(n for n in imported['document']['content'] if n['type']=='table')['content']
        assert [r['attrs']['allowSplit'] for r in rows]==[False,allow,True]
        texts=[page.extract_text() for page in PdfReader(root/'word-rendered.pdf').pages]
        assert ('LEFT000' in re.findall(r'\b(?:LEFT|RIGHT|TAILLEFT|TAILRIGHT)\d{3}\b',texts[0])) is allow
        tokens=re.findall(r'\b(?:LEFT|RIGHT|TAILLEFT|TAILRIGHT)\d{3}\b','\n'.join(texts))
        assert len(tokens)==len(set(tokens))==29
        if not allow:assert all('LEFT'+f'{i:03}' in re.findall(r'\bLEFT\d{3}\b',texts[1]) for i in range(8))
        (root/'checked-layout.json').write_text(json.dumps({'pages':texts,'allowSplit':allow},indent=2),encoding='utf-8')
        print(json.dumps({'status':'passed','allowSplit':allow,'pages':len(texts)}))
