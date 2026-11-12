"""Coverage futility must remain an optimistic, evidence-bound rejection only."""
import copy
import importlib
from pathlib import Path

import pytest


@pytest.fixture
def data(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    module=importlib.import_module('ranking_futility')
    pairs=[]
    for i in range(112):
        for j in range(15):
            systems=[str(j),str((j+1)%15)]
            pairs.append({'id':module.digest([i,*systems])[:24],'sourceIndex':i,'systems':systems,
                'source':f'Source {i}.','group':module.digest(f'Source {i}.'),'split':'validation',
                'a':'bad first','b':'bad second','rankingProtocol':'source-balanced-peer-cycle-v1'})
    return module,pairs


def abstention(module,pair):
    return {'id':pair['id'],'pairSHA256':module.digest(pair),'winner':'abstain',
        'orderDecisions':['abstain','abstain'],'responses':[None,None]}


def test_unqueried_comparisons_remain_optimistically_successful(data):
    module,pairs=data;pairs=pairs[:1500]
    result=module.assess(pairs,[])
    assert not result['futile'] and result['bestPossibleCompleteSources']==100
    assert result['bestPossibleSourceCoverage']==1 and result['recordedComparisons']==0


def test_one_abstention_defeats_exactly_one_hundred_source_minimum(data):
    module,pairs=data;pairs=pairs[:1500]
    result=module.assess(pairs,[abstention(module,pairs[0])])
    assert result['futile'] and result['bestPossibleCompleteSources']==99
    assert result['bestPossibleSourceCoverage']==.99  # Coverage alone would fit.


def test_same_incomplete_source_is_counted_once_and_larger_population_can_continue(data):
    module,pairs=data
    result=module.assess(pairs,[abstention(module,p) for p in pairs[:2]])
    assert not result['futile'] and result['observedIncompleteSources']==1
    assert result['bestPossibleCompleteSources']==111


def test_coverage_can_be_impossible_even_with_one_hundred_possible_complete_sources(data):
    module,pairs=data
    result=module.assess(pairs,[abstention(module,pairs[i*15]) for i in range(12)])
    assert result['futile'] and result['bestPossibleCompleteSources']==100
    assert result['bestPossibleSourceCoverage']<.9


@pytest.mark.parametrize('mutation',['unknown','duplicate','hash','quote','order'])
def test_tampered_evidence_cannot_trigger_a_stop(data,mutation):
    module,pairs=data;rows=[abstention(module,pairs[0])]
    if mutation=='unknown':rows[0]['id']='unknown'
    if mutation=='duplicate':rows.append(copy.deepcopy(rows[0]))
    if mutation=='hash':rows[0]['pairSHA256']='other'
    if mutation=='quote':rows[0]['responses'][0]={'winner':'A','defects':[
        {'candidate':'B','quote':'invented','dimension':'meaning','reason':'Fixture.'}]}
    if mutation=='order':rows[0]['orderDecisions']=['A','B']
    with pytest.raises(ValueError):module.assess(pairs,rows)
