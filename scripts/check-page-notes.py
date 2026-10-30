"""Verify rendered labels, reference values and continuing-note ownership."""
import json,re,sys
from pathlib import Path
from pypdf import PdfReader
root=Path(sys.argv[1]).resolve()
ordinary=PdfReader(root/'notes.pdf');assert len(ordinary.pages)==3
for page,expected in zip(ordinary.pages,(['3 FOOT_A','4 FOOT_B'],['3 FOOT_C','4 FOOT_D'],['3 FOOT_E'])):
    words=re.sub(r'\s+',' ',page.extract_text())
    for marker in expected:assert marker in words,(marker,words)
for name,number in zip('ABCDE',[3,4,3,4,3]):
    assert f'REF_{name} {number}' in re.sub(r'\s+',' ',ordinary.pages[-1].extract_text())
crowded=PdfReader(root/'crowded.pdf');words='\n'.join(page.extract_text() for page in crowded.pages)
for i in range(12):
    for j in range(70 if i==3 else 3):assert len(re.findall(r'\bNOTE_'+str(i)+'_LINE_'+str(j)+r'\b',words))==1,(i,j)
report=json.loads((root/'report.json').read_text())
for item in report['crowdedOwnership']:
    i=int(item['id'].split('_')[-1]);words=re.sub(r'\s+',' ',crowded.pages[item['page']].extract_text())
    assert f"{item['number']} NOTE_{i}_LINE_0" in words,(item,words)
result={'status':'passed','ordinaryPages':len(ordinary.pages),'crowdedPages':len(crowded.pages),'labels':[3,4,3,4,3],'noteLines':103}
(root/'pdf-check.json').write_text(json.dumps(result));print(json.dumps(result))
