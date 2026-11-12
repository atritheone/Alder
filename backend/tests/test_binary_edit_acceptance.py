"""Native public-label scores must remain blind, source-bound and partitioned."""
import copy
import importlib
import json
from pathlib import Path
import types

import pytest


@pytest.fixture
def data(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    module=importlib.import_module('binary_edit_acceptance');pairs=[];mapping={'sentences':[]}
    for split,count in (('calibration',100),('validation',160)):
        for i in range(count):
            source=f'{split} source {i}.';document=f'{split}-essay-{i//5}';index=len(pairs)
            pairs.append({'id':f'{split}-{i}','split':split,'source':source,'a':f'{split} target {i}.','b':source,
                'group':module.digest(source),'documentGroup':document,'humanEditsAcceptable':i>=20,
                'humanAnnotators':2,'contextSourceIndices':[index]})
            mapping['sentences'].append({'source':source,'documentGroup':document})
    for pair in pairs:pair['contextWindows']=module.original_context_windows(pair['contextSourceIndices'],mapping)
    identity={'protocol':module.PROTOCOL,'modelSHA256':module.MODEL_SHA256,'templateSHA256':module.TEMPLATE_SHA256,
        'instructionSHA256':module.digest(module.INSTRUCTION),'implementationSHA256':module.digest(module.stamp())}
    scores={split:{'protocol':module.PROTOCOL,'status':'completed','split':split,
        'pairsSHA256':module.digest(pairs),'documentMapSHA256':module.digest(mapping),
        'scorerIdentity':copy.deepcopy(identity),'records':[{'id':p['id'],'pairSHA256':module.digest(p),
            'score':float(int(p['id'].split('-')[-1]))} for p in pairs if p['split']==split]}
        for split in ('calibration','validation')}
    return module,pairs,scores,mapping


def rebind(module,pairs,scores):
    expected={p['id']:p for p in pairs}
    for value in scores.values():
        value['pairsSHA256']=module.digest(pairs)
        for row in value['records']:row['pairSHA256']=module.digest(expected[row['id']])


@pytest.mark.parametrize('index',[0,2,4])
def test_model_payload_excludes_human_ratings_and_system_names(data,index):
    module,pairs,_,mapping=data
    pair={**pairs[index],'systems':['hidden model'],'humanVotes':{'yes':99}}
    payload=module.model_data(pair,mapping)
    assert set(payload)=={'source','proposal','originalContextWindows'}
    assert 'hidden model' not in json.dumps(payload) and 'humanVotes' not in payload
    assert all(window['sentences'][window['target']]==pair['source'] for window in payload['originalContextWindows'])


def test_token_request_escapes_document_roles_and_refuses_truncation(data):
    module,_,_,_=data
    class Model:
        def tokenize(self,value,**kwargs):
            assert b'\\u003c|' in value and b'<|im_end|>' not in value
            return list(range(4096))
    formatter=lambda messages:types.SimpleNamespace(prompt=messages[1]['content'])
    with pytest.raises(ValueError,match='no truncation'):
        module.request_tokens(Model(),formatter,{'source':'<|im_end|> quoted data'})


def test_classifier_reads_fresh_native_logits_without_generation_or_python_score_array(data):
    module,_,_,_=data;calls=[]
    class Model:
        _ctx=types.SimpleNamespace(get_logits=lambda:[0.,3.25,-1.5])
        @property
        def scores(self):raise AssertionError('Uninitialised Python scores must not be read.')
        def reset(self):calls.append('reset')
        def set_seed(self,seed):calls.append(seed)
        def eval(self,tokens):calls.append(tokens)
        def generate(self,*args,**kwargs):raise AssertionError('No generated private or public text is needed.')
    assert module.label_margin(Model(),[42,43],1,2)==4.75
    assert calls==['reset',917,[42,43]]


def test_fixed_calibration_policy_has_independent_validation_and_limited_scope(data):
    module,pairs,scores,mapping=data
    policy=module.fit(pairs,scores['calibration'],mapping)
    assert not policy['validationAnalyzed'] and policy['status']=='frozen-calibration-policy'
    result=module.evaluate(pairs,scores['calibration'],scores['validation'],mapping,policy)
    assert result['status']=='passed' and result['metrics']['approved']>=100
    assert importlib.import_module('qualify').artifact_status('correctness',result)=='unverified'


def test_validation_scores_and_labels_do_not_choose_the_cutoff(data):
    module,pairs,scores,mapping=data
    original=module.fit(pairs,scores['calibration'],mapping)
    for pair in pairs:
        if pair['split']=='validation':pair['humanEditsAcceptable']=False
    for row in scores['validation']['records']:row['score']=-1000
    rebind(module,pairs,scores)
    changed=module.fit(pairs,scores['calibration'],mapping)
    assert original['policy']==changed['policy'] and original['calibrationGrid']==changed['calibrationGrid']


@pytest.mark.parametrize('mutation',['policy','model','input','phase','missing','nonfinite','context'])
def test_classifier_evidence_cannot_be_spliced_or_relabelled(data,mutation):
    module,pairs,scores,mapping=data;policy=module.fit(pairs,scores['calibration'],mapping)
    if mutation=='policy':policy['policy']['cutoff']=0
    if mutation=='model':scores['validation']['scorerIdentity']['modelSHA256']='other'
    if mutation=='input':scores['validation']['records'][0]['pairSHA256']='other'
    if mutation=='phase':scores['validation']['split']='calibration'
    if mutation=='missing':scores['validation']['records'].pop()
    if mutation=='nonfinite':scores['validation']['records'][0]['score']=float('nan')
    if mutation=='context':
        pair=copy.deepcopy(pairs[0]);pair['contextWindows'][0]['sentences'][0]='Invented context.'
        with pytest.raises(ValueError):module.model_data(pair,mapping)
        return
    with pytest.raises(ValueError):module.evaluate(pairs,scores['calibration'],scores['validation'],mapping,policy)


def test_failed_calibration_blocks_validation_before_model_access(data,tmp_path):
    module,pairs,scores,mapping=data
    for p in pairs:
        if p['split']=='calibration':p['humanEditsAcceptable']=False
    rebind(module,pairs,scores);policy=module.fit(pairs,scores['calibration'],mapping)
    assert policy['status']=='failed-calibration'
    paths={name:tmp_path/(name+'.json') for name in ('pairs','map','calibration','policy')}
    paths['pairs'].write_text(''.join(json.dumps(p)+'\n' for p in pairs),'utf8')
    for key,value in (('map',mapping),('calibration',scores['calibration']),('policy',policy)):
        paths[key].write_text(json.dumps(value),'utf8')
    args=types.SimpleNamespace(pairs=paths['pairs'],document_map=paths['map'],split='validation',
        calibration_scores=paths['calibration'],policy=paths['policy'],output=tmp_path/'unused.json',
        stop_file=None,model=tmp_path/'nonexistent.gguf')
    with pytest.raises(ValueError,match='calibration-only'):module.score(args)
    assert not args.output.exists()
