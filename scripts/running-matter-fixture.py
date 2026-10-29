"""Native Word running-story layout, field and link qualification."""
import json
from pathlib import Path
import runpy
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
source=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_running_matter.py'))
from alder.publishing import build_export,import_document
from alder.models import document_text
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    project=source['fixture']()
    result=build_export(project,'docx',root)
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'runningMatterExpected':True,'skipListNumbers':True,'expectedText':['FIRST BODY','SECOND BODY','THIRD BODY']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    from docx import Document
    opened=import_document(root/'word-resaved.docx')
    matter=opened['settings']['runningMatter']
    assert matter['differentFirst'] and matter['differentEven']
    assert document_text(matter['header']['first'])=='FIRST HEADER'
    assert document_text(matter['header']['even'])=='EVEN HEADER'
    section=next(n for n in opened['document']['content'] if n['type']=='section_break')
    assert document_text(section['attrs']['runningMatter']['header']['default'])=='SECTION HEADER'
    word=Document(root/'word-resaved.docx')
    assert word.sections[1].even_page_header.is_linked_to_previous
    assert word.sections[1].footer.is_linked_to_previous
    assert not word.sections[1].header.is_linked_to_previous
    pages=[p.extract_text() for p in PdfReader(root/'word-rendered.pdf').pages]
    assert len(pages)==3,pages
    for page,header,body in zip(pages,['FIRST HEADER','EVEN HEADER','SECTION HEADER'],['FIRST BODY','SECOND BODY','THIRD BODY']):assert header in page and body in page,(header,page)
    assert 'Total 3' in pages[1] and 'Page 3' in pages[2],pages
    assert {'type':'strong'} in matter['header']['even']['content'][0]['content'][0]['marks']
    print(json.dumps({'status':'passed','pages':len(pages),'checks':['first/odd/even variants','formatted running paragraphs','PAGE/NUMPAGES','independent section links','Word resave/reimport']}))
