"""Native Word merge-field round trip; no external data connection is attached."""
import json
import re
import sys
from pathlib import Path
sys.path[:0]=[str(Path(__file__).resolve().parents[1]/'backend'),str(Path(__file__).resolve().parents[1]/'backend'/'tests')]
from test_mail_merge import fixture
from alder.publishing import build_export,import_document
from alder.mail_merge import merge_keys

root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
if '--check' not in sys.argv:
    project=fixture();result=build_export(project,'docx',root)
    (root/'fixture-project.json').write_text(json.dumps(project),encoding='utf-8')
    (root/'fixture-exports.json').write_text(json.dumps({'docx':result,'skipListNumbers':True,'footnotesExpected':1,'expectedText':['Dear','Account','Your note']}),encoding='utf-8')
else:
    result=import_document(root/'word-resaved.docx')
    assert merge_keys(result['document'])==['Account','Address','Name']
    assert merge_keys(result['settings']['runningMatter'])==['Name']
    from pypdf import PdfReader
    from alder.models import document_text
    for file in (root.parent/'mail-merge-ui'/'merged.pdf',root.parent/'mail-merge-ui-word'/'word-rendered.pdf'):
        if not file.exists():continue
        pdf=PdfReader(file);text=re.sub(r'\s+',' ','\n'.join(page.extract_text() for page in pdf.pages))
        assert len(pdf.pages)==1
        for marker in ('First line','Second line','00123','ALPHA'):assert text.count(marker)==1,(file,marker)
        assert text.count('A & B <literal>')==3,(file,text)
    resaved=root.parent/'mail-merge-ui-word'/'word-resaved.docx'
    if resaved.exists():
        document=import_document(resaved)['document']
        assert not merge_keys(document)
        for marker in ('A & B <literal>','First line','Second line','00123','ALPHA'):assert marker in document_text(document)
    print(json.dumps({'status':'passed','fields':merge_keys(result['document']),'warnings':result['warnings']}))
