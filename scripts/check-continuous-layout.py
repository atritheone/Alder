"""Compare physical section ownership against native Word fixture output."""
import json
from pathlib import Path
import sys
from pypdf import PdfReader
root=Path(sys.argv[1]).resolve()
checks=[]
for case in ('ordinary','restart','first','paper','horizontal','vertical'):
    desktop=PdfReader(root/'continuous-sections'/f'{case}.pdf')
    native=PdfReader(root/f'continuous-word-{case}'/'word-rendered.pdf')
    actual=[' '.join(p.extract_text().split()) for p in desktop.pages]
    expected=[' '.join(p.extract_text().split()) for p in native.pages]
    assert len(actual)==len(expected),(case,actual,expected)
    for marker in ('BEFORE SECTION','AFTER SECTION','LATER BODY','PRE HEADER','POST HEADER'):
        assert [i for i,text in enumerate(actual) if marker in text]==[i for i,text in enumerate(expected) if marker in text],(case,marker,actual,expected)
    for first,second in zip(desktop.pages,native.pages):
        assert abs(float(first.mediabox.width)-float(second.mediabox.width))<1
        assert abs(float(first.mediabox.height)-float(second.mediabox.height))<1
    for marker in ('BEFORE SECTION','AFTER SECTION','LATER BODY'):
        assert ' '.join(actual).count(marker)==1
    assert ('Page 10' if case=='restart' else f'Page {len(actual)}') in actual[-1]
    checks.append({'case':case,'pages':len(actual),'matches':'paper geometry, body/header sheet ownership and page numbering'})
print(json.dumps({'status':'passed','checks':checks},indent=2))
