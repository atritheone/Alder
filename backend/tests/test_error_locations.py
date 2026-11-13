import threading
import time
from pathlib import Path
import pytest
import importlib.util
_spec=importlib.util.spec_from_file_location('repair_experiments_test',Path(__file__).resolve().parents[2]/'scripts/developer/grammar/repair_experiments.py')
_experiment=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(_experiment)
error_locations,locate_and_revise,audit_located=(_experiment.error_locations,_experiment.locate_and_revise,_experiment.audit_located)
from alder.proofreading.contracts import configuration,u16,slice16,diagnostic


def test_locations_quote_utf16_source_and_never_supply_the_proposed_replacement():
    source='😀 He go to work with mispelled notes.'
    hints=error_locations(source,'😀 He goes to work with misspelled notes.')
    assert [item['originalText'] for item in hints]==['go','mispelled']
    assert hints[0]['start']==6
    assert all(slice16(source,item['start'],item['end'])==item['originalText'] for item in hints)
    assert all(item['suggestions']==[] for item in hints)
    assert 'misspelled' not in str(hints) and 'goes' not in str(hints)


def test_insertions_use_a_valid_empty_source_span_and_diagnostics_are_bounded():
    source='The report arrived'
    assert error_locations(source,source+'.')[0]['start']==u16(source)
    assert error_locations(source,source+'.')[0]['originalText']==''
    source=' '.join('word'+str(i) for i in range(30))
    draft=source.replace('word','term')
    assert len(error_locations(source,draft))<=12
    assert error_locations('A source.',None)==[]


def test_both_passes_start_from_original_and_hints_are_generated_without_reference_answers():
    source='He go to work.';calls=[]
    def model(text,config,cancelled):
        calls.append((text,config));return 'He goes to work.'
    config={**configuration({}),'task':'revise','context':'Earlier. '+source}
    assert locate_and_revise(source,config,model,lambda:False,lambda:False)=='He goes to work.'
    assert [text for text,_ in calls]==[source,source]
    assert calls[0][1]['task']=='proofread' and calls[1][1]['task']=='revise'
    assert calls[1][1]['originalText']==source and calls[1][1]['grammarRepair']
    assert calls[1][1]['languageIssues'][0]['originalText']=='go'
    assert not any(key in calls[1][1] for key in ('reference','references','previousDraft'))


def test_unchanged_locator_needs_only_one_call():
    calls=[]
    def model(text,*args):calls.append(text);return text
    assert locate_and_revise('The files arrived.',configuration({}),model,lambda:False,lambda:False)=='The files arrived.'
    assert len(calls)==1


def test_cancel_after_locator_stops_before_second_call():
    calls=[]
    def model(*args):calls.append(1);return 'He goes.'
    with pytest.raises(InterruptedError):
        locate_and_revise('He go.',configuration({}),model,lambda:False,lambda:bool(calls))
    assert calls==[1]


def test_final_audit_cannot_spend_a_third_model_call_or_drop_original_facts():
    config=configuration({})
    assert audit_located('He go at 9.','He goes at 10.',config,lambda *a:[],lambda:False).text is None
    source='He go with mispelled words.';draft='He goes with mispelled words.'
    def rules(text,config):
        start=u16(text,text.index('mispelled'))
        return [diagnostic(text,start,start+9,'spelling','lt:SPELL','Spelling',['misspelled'],'rules')]
    result=audit_located(source,draft,config,rules,lambda:False)
    assert result.text is None and result.reason=='residual-spelling'


def service_type(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    from repair_study import LocatedRepairService
    return LocatedRepairService


def test_async_location_pipeline_returns_only_final_rewrite_with_context_offsets(tmp_path,monkeypatch):
    service=service_type(monkeypatch)(tmp_path/'resources',tmp_path/'data');calls=[]
    monkeypatch.setattr(service.resources,'capabilities',lambda:{'model':{'available':True},'rules':{'available':True}})
    monkeypatch.setattr(service.rules,'check',lambda *a:[])
    target='😀 He go to work.';final='😀 He goes to work.'
    def model(text,config,cancelled):calls.append((text,config));return final
    monkeypatch.setattr(service.model,'check',model)
    context='Earlier. '+target+' Later.';start=u16('Earlier. ')
    try:
        job=service.start({'text':context,'targetId':'located','revision':True,
            'range':{'start':start,'end':start+u16(target)}})
        for _ in range(100):
            job=service.get(job['id'])
            if job['status'] in ('completed','partial','failed'):break
            time.sleep(.01)
        assert job['status']=='completed' and len(calls)==2
        assert calls[1][1]['languageIssues'][0]['start']==6
        assert calls[1][1]['context']==context
        assert len(job['annotations'])==1 and job['annotations'][0]['start']==start
        assert job['annotations'][0]['originalText']==target and job['annotations'][0]['replacementText']==final
    finally:service.shutdown()


@pytest.mark.parametrize('phase',['locator','correction'])
def test_cancel_during_either_pass_never_publishes_an_intermediate_result(tmp_path,monkeypatch,phase):
    service=service_type(monkeypatch)(tmp_path/'resources',tmp_path/'data')
    entered=threading.Event();release=threading.Event();calls=[]
    monkeypatch.setattr(service.resources,'capabilities',lambda:{'model':{'available':True},'rules':{'available':True}})
    monkeypatch.setattr(service.rules,'check',lambda *a:[])
    def model(text,config,cancelled):
        calls.append(config)
        if (config.get('task')=='proofread')==(phase=='locator'):
            entered.set();release.wait(2)
        return 'He goes to work.'
    monkeypatch.setattr(service.model,'check',model)
    try:
        job=service.start({'text':'He go to work.','targetId':'cancel','revision':True})
        assert entered.wait(1);service.cancel(job['id']);release.set()
        for _ in range(100):
            job=service.get(job['id'])
            if job['status']=='cancelled':break
            time.sleep(.01)
        assert job['status']=='cancelled' and job['annotations']==[]
        assert len(calls)==(1 if phase=='locator' else 2)
    finally:release.set();service.shutdown()


@pytest.mark.parametrize('profile,mode',[('creative','improve'),('standard','rephrase')])
def test_creative_and_explicit_rephrase_do_not_use_the_locator(tmp_path,monkeypatch,profile,mode):
    service=service_type(monkeypatch)(tmp_path/'resources',tmp_path/'data');calls=[]
    monkeypatch.setattr(service.resources,'capabilities',lambda:{'rules':{'available':True}})
    monkeypatch.setattr(service.model,'check',lambda text,config,stop:calls.append(config) or text)
    config={**configuration({}, {'revisionProfile':profile}),'task':'revise','revisionMode':mode}
    try:
        assert service._generate_revision('A cold night.',config,lambda:False,lambda:False)=='A cold night.'
        assert len(calls)==1 and calls[0]['task']=='revise'
    finally:service.shutdown()
