"""The edit-validity component cannot tune on validation or approve other scopes."""
import copy
import importlib
from pathlib import Path

import pytest


@pytest.fixture
def data(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    module=importlib.import_module('edit_acceptance');pairs=[];rows=[];mapping={'sentences':[]}
    for split,count in (('calibration',100),('validation',160)):
        for i in range(count):
            source=f'{split} source {i}.';document=f'{split}-essay-{i//5}'
            pair={'id':f'{split}-{i}','split':split,'source':source,'a':f'{split} target {i}.','b':source,
                'group':module.digest(source),'documentGroup':document,
                'humanEditsAcceptable':i>=20,'humanAnnotators':2}
            pairs.append(pair);mapping['sentences'].append({'source':source,'documentGroup':document})
            value={'grammaticality':float(i),'faithfulness':float(i)}
            rows.append({'id':pair['id'],'pairSHA256':module.digest(pair),'dimensions':[value,value]})
    ratings={'judge':{'family':'fixture','modelSHA256':'fixture'},'implementationSHA256':'fixture','records':rows}
    return module,pairs,ratings,mapping


def rehash(module,pairs,ratings):
    for pair,row in zip(pairs,ratings['records']):row['pairSHA256']=module.digest(pair)


def test_frozen_component_passes_only_its_declared_edit_validity_scope(data):
    module,pairs,ratings,mapping=data
    policy=module.fit(pairs,ratings,mapping)
    assert policy['status']=='frozen-calibration-policy' and policy['validationAnalyzed'] is False
    result=module.evaluate(pairs,ratings,mapping,policy)
    assert result['status']=='passed' and result['metrics']['approved']>=100
    assert result['metrics']['agreement']>=.95 and result['agreement95DocumentBootstrap'][0]>.95
    assert importlib.import_module('qualify').artifact_status('evaluator',result)=='unverified'


def test_validation_labels_and_scores_cannot_influence_fitted_cutoffs(data):
    module,pairs,ratings,mapping=data
    original=module.fit(pairs,ratings,mapping)
    for pair,row in zip(pairs,ratings['records']):
        if pair['split']=='validation':
            pair['humanEditsAcceptable']=False
            row['dimensions'][0]={'grammaticality':-1000.,'faithfulness':1000.}
    rehash(module,pairs,ratings)
    changed=module.fit(pairs,ratings,mapping)
    assert changed['policy']==original['policy'] and changed['calibrationGrid']==original['calibrationGrid']


def test_failed_calibration_does_not_analyze_validation(data):
    module,pairs,ratings,mapping=data
    for pair in pairs:
        if pair['split']=='calibration':pair['humanEditsAcceptable']=False
    rehash(module,pairs,ratings)
    policy=module.fit(pairs,ratings,mapping)
    assert policy['status']=='failed-calibration' and policy['policy'] is None and not policy['validationAnalyzed']
    with pytest.raises(ValueError,match='frozen'):module.evaluate(pairs,ratings,mapping,policy)


def test_frozen_cutoff_cannot_be_hand_edited_after_fitting(data):
    module,pairs,ratings,mapping=data
    policy=module.fit(pairs,ratings,mapping);policy['policy']['cutoffs']['grammaticality']=0
    with pytest.raises(ValueError,match='calibration-only'):module.evaluate(pairs,ratings,mapping,policy)


@pytest.mark.parametrize('mutation',['score','quote_hash','duplicate','label_scope','raters','document','fold'])
def test_unbound_or_mislabelled_acceptance_data_fails(data,mutation):
    module,pairs,ratings,mapping=data
    if mutation=='score':ratings['records'][0]['dimensions'][0]['faithfulness']=float('nan')
    if mutation=='quote_hash':ratings['records'][0]['pairSHA256']='other'
    if mutation=='duplicate':ratings['records'].append(copy.deepcopy(ratings['records'][0]))
    if mutation=='label_scope':pairs[0]['humanFullyCorrect']=True;rehash(module,pairs,ratings)
    if mutation=='raters':pairs[0]['humanAnnotators']=1;rehash(module,pairs,ratings)
    if mutation=='document':pairs[0]['documentGroup']='unverified';rehash(module,pairs,ratings)
    if mutation=='fold':
        pairs[-1]['documentGroup']=pairs[0]['documentGroup'];mapping['sentences'][-1]['documentGroup']=pairs[0]['documentGroup']
        rehash(module,pairs,ratings)
    with pytest.raises(ValueError):module.fit(pairs,ratings,mapping)


def test_missing_candidate_scores_remain_in_coverage(data):
    module,pairs,ratings,mapping=data
    ratings['records'][0]['dimensions'][0]=None
    policy=module.fit(pairs,ratings,mapping)
    assert all(row['metrics']['cases']==100 and row['metrics']['scorable']==99 for row in policy['calibrationGrid'])
