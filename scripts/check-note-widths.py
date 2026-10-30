"""No duplicated or missing note wording in actual desktop/Word output."""
import json
from pathlib import Path
import sys
from pypdf import PdfReader
root=Path(sys.argv[1]);results={}
for name in (('alder.pdf','word-rendered.pdf') if '--word' in sys.argv else ('alder.pdf',)):
    pdf=PdfReader(root/name);text='\n'.join(p.extract_text() for p in pdf.pages)
    for i in range(400):
        marker=f'NOTE{i:04d}';assert text.count(marker)==1,(name,marker,text.count(marker))
    for marker in ('FIRST_BODY','SECOND_BODY','THIRD_BODY'):assert text.count(marker)==1,(name,marker)
    results[name]=len(pdf.pages)
print(json.dumps({'status':'passed','noteMarkers':400,'pages':results}))
