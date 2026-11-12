"""Source-bound carry-over preserves failures and skips prior inference on resume."""
import copy
import importlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.fixture
def setup(monkeypatch,tmp_path):
    grammar=Path(__file__).resolve().parents[2]/'scripts/developer/grammar'
    monkeypatch.syspath_prepend(str(grammar));module=importlib.import_module('reuse_ratings')
    archive=tmp_path/'source';tool=archive/'scripts/developer/grammar';tool.mkdir(parents=True)
    files={}
    for name in ('judge.py','judge_server.py','judge_client.py','judge_protocol.py','common.py','rubric.json'):
        target=tool/name;shutil.copyfile(grammar/name,target)
        files[str(target.relative_to(archive))]=__import__('hashlib').sha256(target.read_bytes()).hexdigest()
    source=module.digest(files)
    (archive/'source-snapshot.json').write_text(json.dumps({'sourceSHA256':source,'files':files}),'utf8')
    identity={'modelSHA256':'0'*64,'seedPolicy':'fixed-per-request-v1',
        'contextCachePolicy':'reset-before-uncached-request','candidateOrdering':'canonical-pair-v1'}
    log=tmp_path/'calls.jsonl';client=tmp_path/'client.py';identity_path=tmp_path/'identity.json'
    identity_path.write_text(json.dumps(identity),'utf8')
    client.write_text('''import json,sys
from pathlib import Path
if '--identity' in sys.argv:
 print(Path(sys.argv[1]).read_text('utf8'));raise SystemExit()
p=json.load(sys.stdin)
with Path(sys.argv[1]).open('a') as f:f.write('called\\n')
if p['source']=='Ambiguous source.':v={'winner':'abstain','defects':[]}
else:
 loser='A' if 'bad' in p['A'] else 'B'
 v={'winner':'B' if loser=='A' else 'A','defects':[{'candidate':loser,'quote':'bad','dimension':'correctness','reason':'Public fixture.'}]}
print(json.dumps(v))
''','utf8')
    config={'family':'fixture','modelSHA256':'0'*64,'sourceArchiveSHA256':source,'serverIdentity':identity,
        'command':[sys.executable,str(client),str(log)],
        'preflightCommand':[sys.executable,str(client),str(identity_path),'--identity']}
    config_path=tmp_path/'config.json';config_path.write_text(json.dumps(config),'utf8')
    old=[{'id':str(i),'sourceIndex':i,'source':text,'group':str(i),'a':'bad text','b':'good text','split':'validation'}
        for i,text in enumerate(('Clear source.','Ambiguous source.'))]
    new=copy.deepcopy(old)+[{'id':'2','sourceIndex':2,'source':'New source.','group':'2','a':'bad text','b':'good text','split':'validation'}]
    old_path=tmp_path/'old.jsonl';new_path=tmp_path/'new.jsonl'
    for path,rows in ((old_path,old),(new_path,new)):
        path.write_text(''.join(json.dumps(row)+'\n' for row in rows),'utf8')
    output=tmp_path/'old-ratings.json'
    args=[sys.executable,'-B',str(tool/'judge.py'),'--pairs',str(old_path),'--judge-config',str(config_path),
        '--output',str(output),'--split','validation']
    subprocess.run(args,check=True,capture_output=True,text=True,timeout=30)
    raw=json.loads(output.read_text('utf8'));policy={'fixture':'source-only policy'}
    audit={'originalPairsSHA256':module.digest(old),'pairsSHA256':module.digest(new),
        'excludedUnratedOriginalSourceIndices':[]}
    monkeypatch.setattr(module,'verify_manifest',lambda supplied:([],new,audit))
    return module,old,new,raw,config,archive,policy,log,new_path,config_path,tmp_path


def test_resume_keeps_the_abstention_and_queries_only_new_pairs(setup):
    module,old,new,raw,config,archive,policy,log,new_path,config_path,root=setup
    result,proof=module.reuse(old,new,raw,config,archive,policy)
    assert proof['retainedRatings']==2 and proof['retainedAbstentions']==1
    assert result['records'][1]['winner']=='abstain' and not proof['modelInferencePerformed']
    output=root/'continued.json';output.write_text(json.dumps(result),'utf8')
    subprocess.run([sys.executable,'-B',str(archive/'scripts/developer/grammar/judge.py'),
        '--pairs',str(new_path),'--judge-config',str(config_path),'--output',str(output),'--split','validation'],
        check=True,capture_output=True,text=True,timeout=30)
    final=json.loads(output.read_text('utf8'))
    assert final['status']=='completed' and len(final['records'])==3
    assert len(log.read_text().splitlines())==6  # Four old calls plus two new; no retry of the abstention.
    assert final['records'][1]['winner']=='abstain' and final['records'][1]['retainedRating']['ratingsSHA256']==module.digest(raw)


@pytest.mark.parametrize('mutation',['config','public_evidence','running','source','pair'])
def test_unbound_or_changed_evidence_cannot_be_reused(setup,mutation):
    module,old,new,raw,config,archive,policy,*_=setup
    if mutation=='config':config['serverIdentity']['seedPolicy']='different-policy'
    if mutation=='public_evidence':raw['records'][0]['responses'][0]['defects'][0]['quote']='Invented'
    if mutation=='running':raw['status']='running'
    if mutation=='source':(archive/'scripts/developer/grammar/common.py').write_text('changed','utf8')
    if mutation=='pair':new[0]['context']='Different context.'
    with pytest.raises(ValueError):module.reuse(old,new,raw,config,archive,policy)


def test_population_repair_cannot_silently_discard_a_known_abstention(setup,monkeypatch):
    module,old,new,raw,config,archive,policy,*_=setup
    selected=[p for p in new if p['id']!='1']
    audit={'originalPairsSHA256':module.digest(old),'pairsSHA256':module.digest(selected),
        'excludedUnratedOriginalSourceIndices':[1]}
    monkeypatch.setattr(module,'verify_manifest',lambda supplied:([],selected,audit))
    with pytest.raises(ValueError,match='known abstention'):
        module.reuse(old,selected,raw,config,archive,policy)
