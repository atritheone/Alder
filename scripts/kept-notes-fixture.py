"""Oversized kept rows in both note kinds; short kept rows remain intact."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import create_project,validate_project
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)

def para(text):return {'type':'paragraph','content':[{'type':'text','text':text}]}
def cell(text,header=False):return {'type':'table_header' if header else 'table_cell','attrs':{'colwidth':[180],'paddingTop':4,'paddingBottom':4},'content':[para(text)]}
def note(kind,prefix):
    rows=[{'type':'table_row','attrs':{'allowSplit':False,'blockId':prefix+'_header'},'content':[cell(prefix+' HEADER',True),cell('Value',True)]},
          {'type':'table_row','attrs':{'allowSplit':False,'blockId':prefix+'_short'},'content':[cell(prefix+' SHORT'),cell(prefix+' SHORT_VALUE')]},
          {'type':'table_row','attrs':{'allowSplit':False,'blockId':prefix+'_long'},'content':[cell(''),cell(prefix+' LAST_VALUE')]}]
    rows[-1]['content'][0]['content']=[para(f'{prefix}{i:03d} kept row wording') for i in range(70)]
    return {'type':'document_note','attrs':{'kind':kind,'blockId':prefix+'_note','body':{'type':'doc','content':[para(prefix+' OPEN'),{'type':'table','content':rows},para(prefix+' CLOSE')]}}}
if '--check' not in sys.argv:
    project=create_project('Kept note rows','blank');project['settings'].update(documentKind='docx',includeTitle=False,pageSize='A5',marginMm=20)
    content=[para('NOTE BODY')];content[0]['content'].append(note('footnote','FOOT'))
    content.append(para('END BODY'));content[-1]['content'].append(note('endnote','END'))
    project['book']={'version':1,'chapters':[{'id':'main','title':'Document','include':True,'document':{'type':'doc','content':content}}]}
    project=validate_project(project)
    (root/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
else:
    from zipfile import ZipFile
    from lxml import etree
    from pypdf import PdfReader
    W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';report=[]
    for file in (root/'notes.docx',root/'word-resaved.docx'):
        if not file.exists():continue
        with ZipFile(file) as archive:
            for kind,prefix in [('footnote','FOOT'),('endnote','END')]:
                doc=etree.fromstring(archive.read('word/'+kind+'s.xml'))
                rows=list(doc.iter('{'+W+'}tr'))
                short=next(r for r in rows if prefix+' SHORT' in ''.join(r.itertext()))
                long=next(r for r in rows if prefix+'000' in ''.join(r.itertext()))
                assert short.find('.//{'+W+'}cantSplit') is not None,(file,kind,'short')
                assert long.find('.//{'+W+'}cantSplit') is None,(file,kind,'long')
        report.append({'docx':file.name,'keptShortRows':2,'splitLongRows':2})
    for file in (root/'notes.pdf',root/'word-rendered.pdf'):
        if not file.exists():continue
        pdf=PdfReader(file);text='\n'.join(page.extract_text() for page in pdf.pages)
        for prefix in ('FOOT','END'):
            for i in range(70):assert text.count(f'{prefix}{i:03d}')==1,(file,prefix,i)
            assert text.count(prefix+' LAST_VALUE')==1
        report.append({'pdf':file.name,'pages':len(pdf.pages),'markers':142})
    print(json.dumps({'status':'passed','checks':report}))
