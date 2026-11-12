"""An early semantic rejection needs verified evidence and the full denominator."""
import importlib
from pathlib import Path

import pytest


@pytest.fixture
def controls(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    module=importlib.import_module('semantic_futility')
    pairs=[{'id':str(i),'group':str(i%8),'category':str(i%8),'split':'validation',
        'source':'They was waiting.','a':'They were waiting.','b':'She was waiting.',
        'correctWinner':'A','goldOrigin':'controlled semantic mutation, not a human preference rating'} for i in range(200)]
    def row(index,winner):
        def response(choice):
            if choice in ('tie','abstain'):return {'winner':choice,'defects':[]}
            return {'winner':choice,'defects':[{'candidate':'B' if choice=='A' else 'A',
                'quote':'waiting','reason':'Fixture finding.','dimension':'meaning'}]}
        opposite={'A':'B','B':'A','tie':'tie','abstain':'abstain'}[winner]
        return {'id':str(index),'pairSHA256':module.digest(pairs[index]),'winner':winner,
            'orderDecisions':[winner,opposite],'responses':[response(winner),response(opposite)]}
    return module,pairs,row


def test_first_grounded_harmful_preference_rejects_without_running_remaining_cases(controls):
    module,pairs,row=controls
    result=module.assess(pairs,[row(0,'B')])
    assert result['futile'] and result['knownHarmfulPreferences']==1
    assert result['remainingCases']==199 and result['bestPossibleFinalDetection']==.995
    assert 'zero-preference' in result['reasons'][0]


def test_missing_and_abstaining_cases_cannot_silently_improve_detection(controls):
    module,pairs,row=controls
    assert not module.assess(pairs,[row(i,'abstain') for i in range(10)])['futile']
    result=module.assess(pairs,[row(i,'abstain') for i in range(11)])
    assert result['futile'] and result['bestPossibleFinalDetection']==.945
    assert result['knownHarmfulPreferences']==0


@pytest.mark.parametrize('mutation',['hash','winner','quote','missing_response','duplicate'])
def test_invalid_or_repeated_public_evidence_cannot_trigger_a_rejection(controls,mutation):
    module,pairs,row=controls;ratings=[row(0,'B')]
    if mutation=='hash':ratings[0]['pairSHA256']='changed'
    if mutation=='winner':ratings[0]['winner']='A'
    if mutation=='quote':ratings[0]['responses'][0]['defects'][0]['quote']='not in either candidate'
    if mutation=='missing_response':del ratings[0]['responses']
    if mutation=='duplicate':ratings.append(row(0,'B'))
    with pytest.raises(ValueError):module.assess(pairs,ratings)


def test_human_labels_and_small_control_sets_cannot_use_this_policy(controls):
    module,pairs,_=controls
    with pytest.raises(ValueError):module.assess(pairs[:10],[])
    pairs[0]['humanWinner']='A'
    with pytest.raises(ValueError):module.assess(pairs,[])


def test_even_a_complete_correct_trial_is_not_a_qualification_report(controls):
    module,pairs,row=controls
    result=module.assess(pairs,[row(i,'A') for i in range(200)])
    assert result['futile'] is False and result['remainingCases']==0
    assert 'status' not in result and 'qualified' not in result
