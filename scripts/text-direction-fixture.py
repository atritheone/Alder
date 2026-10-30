import json,runpy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.models import document_text
from alder.publishing import build_export,import_document
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    project=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_text_direction.py'))['fixture']()
    result=build_export(project,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'expectedText':['ENGLISH','English 123','English 456','English 789']}),encoding='utf-8')
else:
    from pypdf import PdfReader
    import subprocess,xml.etree.ElementTree as ET
    original=json.loads((root/'fixture-project.json').read_text('utf-8'))['book']['chapters'][0]['document']
    restored=import_document(root/'word-resaved.docx')['document']
    assert document_text(restored)==document_text(original),(document_text(restored),document_text(original))
    assert [n['attrs'].get('textDirection','ltr') for n in restored['content']]==[n['attrs']['textDirection'] for n in original['content']]
    (root/'reimport.json').write_text(json.dumps(restored,ensure_ascii=False,indent=2),encoding='utf-8')
    converter=Path(__file__).resolve().parents[1]/'release/win-unpacked/resources/tools/calibre/app/bin/pdftotext.exe'
    bounds=root/'word-bounds.html'
    subprocess.run([str(converter),'-bbox-layout',str(root/'word-rendered.pdf'),str(bounds)],check=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    ns={'x':'http://www.w3.org/1999/xhtml'}
    lines=ET.parse(bounds).findall('.//x:line',ns)
    words=lambda line:[word.text for word in sorted(line.findall('x:word',ns),key=lambda n:float(n.get('xMin')))]
    english=next(line for line in lines if 'ENGLISH' in words(line))
    assert words(english)[:4]==['ENGLISH','Latin','and','42'],words(english)
    for number in ('123','456'):
        line=next(line for line in lines if number in words(line) and 'English' in words(line))
        assert words(line)[:4]==['.','English',number,'(2026)'],words(line)
    print(json.dumps({'status':'passed','pages':len(PdfReader(root/'word-rendered.pdf').pages)}))
