"""Exercise the installed local rules pack with attributed multilingual text."""
import json,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from alder.proofreading.service import ProofreadingService
from alder.proofreading.contracts import u16,slice16
root=Path(sys.argv[1]).resolve();root.mkdir(parents=True,exist_ok=True)
resources=Path(sys.argv[2]).resolve()
sentences=[('The colour is blue.','en-GB'),('The colour is blue.','en-US'),('Bonjour le monde.','fr-FR'),('Ceci est une fautte.','fr'),('Das ist ein Fehlehr.','de-DE'),('שלום עולם','he'),('Mispelled generated citation','zxx')]
text='\n'.join(t for t,_ in sentences);ranges=[];cursor=0
for passage,language in sentences:
    ranges.append({'start':cursor,'end':cursor+u16(passage),'language':language});cursor+=u16(passage)+1
service=ProofreadingService(resources,root/'data')
try:
    job=service.start({'text':text,'targetId':'language-evidence','languageRanges':ranges})
    deadline=time.monotonic()+60
    while job['status'] in ('queued','running') and time.monotonic()<deadline:
        time.sleep(.1);job=service.get(job['id'])
    (root/'result.json').write_text(json.dumps(job,ensure_ascii=False,indent=2),encoding='utf-8')
    assert job['status']=='partial',job
    assert job['coverage']=={'totalBlocks':7,'checkedBlocks':5,'advancedBlocks':0,'skippedBlocks':2},job
    assert any('he' in w for w in job['warnings'])
    by_line=[[a for a in job['annotations'] if a['start']>=r['start'] and a['end']<=r['end']] for r in ranges]
    assert not by_line[0] and not by_line[2] and not by_line[5] and not by_line[6],by_line
    for index,word in [(1,'colour'),(3,'fautte'),(4,'Fehlehr')]:assert any(a['originalText']==word for a in by_line[index]),by_line[index]
    for a in job['annotations']:assert slice16(text,a['start'],a['end'])==a['originalText']
    print('Passed installed-rule checks: British/US conventions, French/German ranges, unsupported language coverage, generated exclusions and exact correction offsets.')
finally:service.shutdown()
