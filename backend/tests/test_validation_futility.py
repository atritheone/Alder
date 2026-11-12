"""Missing validation outcomes cannot hide a conclusive full-population failure."""
import importlib
from pathlib import Path

import pytest


@pytest.fixture
def human(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    module=importlib.import_module('validation_futility')
    pairs=[{'id':str(i),'group':str(i//6),'split':'validation','source':'They was waiting.',
        'a':'They were waiting.','b':'She was waiting.','humanWinner':'A'} for i in range(150)]
    def row(index,winner,unstable=False):
        def response(choice):
            if choice in ('tie','abstain'):return {'winner':choice,'defects':[]}
            return {'winner':choice,'defects':[{'candidate':'B' if choice=='A' else 'A',
                'quote':'waiting','reason':'Fixture finding.','dimension':'correctness'}]}
        first,second=('A','A') if unstable else (winner,{'A':'B','B':'A','tie':'tie','abstain':'abstain'}[winner])
        return {'id':str(index),'pairSHA256':module.digest(pairs[index]),
            'winner':'abstain' if unstable else winner,'orderDecisions':[first,second],
            'responses':[response(first),response(second)]}
    return module,pairs,row


def test_point_agreement_rejects_only_beyond_the_existing_full_population_boundary(human):
    module,pairs,row=human
    assert not module.assess(pairs,[row(i,'B') for i in range(30)])['futile']
    result=module.assess(pairs,[row(i,'B') for i in range(31)])
    assert result['futile'] and result['remainingCases']==119
    assert result['bestPossibleFinalAgreement']==119/150


@pytest.mark.parametrize('kind,allowed,rejected',[('abstain',15,16),('unstable',7,8)])
def test_abstention_and_order_bounds_use_full_denominator(human,kind,allowed,rejected):
    module,pairs,row=human
    make=lambda i:row(i,'abstain') if kind=='abstain' else row(i,'A',unstable=True)
    assert not module.assess(pairs,[make(i) for i in range(allowed)])['futile']
    assert module.assess(pairs,[make(i) for i in range(rejected)])['futile']


@pytest.mark.parametrize('mutation',['hash','winner','quote','missing_response','duplicate'])
def test_unverified_public_evidence_cannot_trigger_rejection(human,mutation):
    module,pairs,row=human;ratings=[row(0,'B')]
    if mutation=='hash':ratings[0]['pairSHA256']='changed'
    if mutation=='winner':ratings[0]['winner']='A'
    if mutation=='quote':ratings[0]['responses'][0]['defects'][0]['quote']='absent quote'
    if mutation=='missing_response':del ratings[0]['responses']
    if mutation=='duplicate':ratings.append(row(0,'B'))
    with pytest.raises(ValueError):module.assess(pairs,ratings)


def test_calibration_controls_and_small_populations_are_not_validation(human):
    module,pairs,_=human
    with pytest.raises(ValueError):module.assess(pairs[:80],[])
    pairs[0]['split']='calibration'
    with pytest.raises(ValueError):module.assess(pairs,[])
    pairs[0]['split']='validation';pairs[0]['correctWinner']='A'
    with pytest.raises(ValueError):module.assess(pairs,[])


def test_complete_or_promising_results_never_become_a_qualification(human):
    module,pairs,row=human
    for ratings in ([],[row(i,'A') for i in range(150)]):
        result=module.assess(pairs,ratings)
        assert result['futile'] is False and 'status' not in result and 'qualified' not in result
