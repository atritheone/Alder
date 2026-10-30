"""Independent Word measurements before implementing mirrored editing frames."""
import json
from pathlib import Path
import sys
from docx import Document
from docx.shared import Mm,Pt
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
start=2 if '--even-start' in sys.argv else 1
if '--alder' in sys.argv:
    import runpy
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
    from alder.publishing import build_export, import_document
    if '--check' in sys.argv:
        from pypdf import PdfReader
        imported=import_document(root/'word-resaved.docx')
        assert imported['settings']['mirrorMargins'] is True
        assert imported['settings']['firstPageNumber']==start
        pdf=PdfReader(root/'word-rendered.pdf')
        assert len(pdf.pages)==4
        positions=[]
        for i,page in enumerate(pdf.pages):
            points=[]
            page.extract_text(visitor_text=lambda text,cm,tm,font,size:points.append(cm[4]+tm[4]) if f'MIRROR{i+1}' in text else None)
            assert len(points)==1
            assert abs(points[0]-(20 if (i+start)%2==0 else 45)*72/25.4)<.25,points
            positions+=points
        print(json.dumps({'status':'passed','bodyX':positions,'checks':['native mirrored margins and gutter','logical numbering parity','Word render/resave/reimport']}))
    else:
        source=runpy.run_path(str(Path(__file__).resolve().parents[1]/'backend/tests/test_mirrored_margins.py'))
        project=source['fixture'](start)
        result=build_export(project,'docx',root)
        (root/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
        (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'expectedText':['MIRROR1','MIRROR4']}),encoding='utf-8')
    raise SystemExit(0)
doc=Document();section=doc.sections[0]
section.page_width=Mm(150);section.page_height=Mm(170)
section.left_margin=Mm(40);section.right_margin=Mm(20);section.gutter=Mm(5)
section.top_margin=section.bottom_margin=Mm(20)
doc.styles['Normal'].font.name='Cambria';doc.styles['Normal'].font.size=Pt(12)
mirror=OxmlElement('w:mirrorMargins');doc.settings.element.append(mirror)
number=OxmlElement('w:pgNumType');number.set(qn('w:start'),str(start));section._sectPr.append(number)
for i in range(4):
    p=doc.add_paragraph(f'MIRROR{i+1} Inside and outside margins.');p.paragraph_format.page_break_before=i>0
file=root/'fixture.docx';doc.save(file)
(root/'fixture-exports.json').write_text(json.dumps({'docx':{'path':str(file)},'skipListNumbers':True,'expectedText':['MIRROR1','MIRROR4']}),encoding='utf-8')
