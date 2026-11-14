"""Recovery cannot replace an incumbent correction or exceed its shared budget."""
import time
import pytest
from alder.proofreading.focused_repair import finish_recovery
from alder.proofreading.contracts import configuration,diagnostic,u16


def test_valid_incumbent_is_preserved_even_when_a_grammar_rule_disagrees():
    source='The poor is still working.';draft='The poor are still working.'
    def rules(text,config):
        start=u16(text,text.index('are'))
        return [diagnostic(text,start,start+3,'grammar','lt:HE_VERB_AGR','Possible agreement.',['is'],'rules')]
    def forbidden(*args):raise AssertionError('Do not rewrite an accepted incumbent delivery.')
    result=finish_recovery(source,draft,configuration({}),rules,forbidden,lambda:False)
    assert result.text==draft and not result.repaired


def test_original_plural_request_and_its_successful_result_are_preserved():
    source='The poor is still working, and the reports was delayed.'
    draft='The poor person is still working, and the report was delayed.'
    target='The poor are still working, and the reports were delayed.';calls=[]
    def model(text,config,cancelled):
        calls.append((text,config));return target
    result=finish_recovery(source,draft,configuration({}),lambda *a:[],model,lambda:False)
    assert result.text==target and result.repaired and len(calls)==1
    assert calls[0][0]==source and calls[0][1]['repairReason']=='plurality'
    assert calls[0][1]['pluralityTerms']==['reports'] and not calls[0][1].get('focusedRepair')


def test_a_rejected_proposal_can_use_an_unspent_source_retry():
    source='The entries was 47.';draft='The entries were 48.';calls=[]
    def model(text,config,cancelled):
        calls.append((text,config));return 'The entries were 47.'
    result=finish_recovery(source,draft,configuration({}),lambda *a:[],model,lambda:False)
    assert result.text=='The entries were 47.' and len(calls)==1
    assert calls[0][0]==source and calls[0][1]['focusedRepair']


def test_spelling_repair_spends_the_budget_even_if_its_facts_remain_wrong():
    source='He must use the mispelled words.';draft='He may use the mispelled words.';calls=[]
    def rules(text,config):
        if 'mispelled' not in text:return []
        start=u16(text,text.index('mispelled'))
        return [diagnostic(text,start,start+9,'spelling','lt:SPELL','Spelling',['misspelled'],'rules')]
    def model(text,config,cancelled):
        calls.append((text,config));return 'He may use the misspelled words.'
    result=finish_recovery(source,draft,configuration({}),rules,model,lambda:False)
    assert result.text is None and result.reason=='modality-or-negation' and len(calls)==1
    assert calls[0][1]['spellingRepair'] and not calls[0][1].get('focusedRepair')


def test_paired_lexical_correction_adds_no_model_call():
    def forbidden(*args):raise AssertionError('Qualified lexical correction requires no retry.')
    result=finish_recovery('Lets go',"Let's go.",configuration({}),lambda *a:[],forbidden,lambda:False)
    assert result.text=="Let's go." and not result.repaired


@pytest.mark.parametrize('source,draft,displayed',[
    ('Lets go',"Let's go.",True),
    ('We are more closed now.','We are more open now.',False),
    ('The young is still working.','The young person is still working.',False),
    ('The young is still working.','The young are still working.',True),
])
def test_shipping_policy_keeps_failed_recovery_disabled_and_preserves_source_groups(
        tmp_path,monkeypatch,source,draft,displayed):
    from alder.proofreading.service import ProofreadingService
    service=ProofreadingService(tmp_path/'resources',tmp_path/'data');calls=[]
    monkeypatch.setattr(service.resources,'capabilities',lambda:{'model':{'available':True},'rules':{'available':True}})
    monkeypatch.setattr(service.rules,'check',lambda *a:[])
    monkeypatch.setattr(service.model,'check',lambda *a:calls.append(a) or draft)
    try:
        job=service.start({'text':source,'targetId':'shipping-guard','revision':True})
        for _ in range(100):
            job=service.get(job['id'])
            if job['status'] in ('completed','partial','failed','cancelled'):break
            time.sleep(.01)
        assert job['status']=='completed' and bool(job['annotations'])==displayed
        assert len(calls)==1  # No unqualified recovery call in the application.
        if displayed:assert job['annotations'][0]['replacementText']==draft
    finally:service.shutdown()
