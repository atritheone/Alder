"""Guard profiles must change only admission, with immutable facts still checked."""
import importlib
from pathlib import Path
import pytest
from alder.proofreading.lexical_repairs import REPAIR_FAMILIES,lexical_families
from alder.proofreading.revisions import revision_rejection


@pytest.mark.parametrize('family,source,target',[
    ('contractions','Ill check the report.',"I'll check the report."),
    ('initial-maybe','May be I will go.','Maybe I will go.'),
    ('quantifier','I watch a Lo of TV series.','I watch a lot of TV series.'),
    ('existential-negation','There is no much time.',"There isn't much time."),
    ('negative-possession',"I don't have anything to send.",'I have nothing to send.'),
])
def test_only_the_selected_family_can_admit_its_repair(family,source,target):
    assert revision_rejection(source,target,[]) is not None
    assert revision_rejection(source,target,[],lexical_repairs=[family]) is None
    assert revision_rejection(source,target,[],lexical_repairs=REPAIR_FAMILIES-{family}) is not None
    assert revision_rejection(source,target,[],lexical_repairs=True)==revision_rejection(source,target,[],lexical_repairs=REPAIR_FAMILIES)


def test_independent_exceptions_cannot_hide_the_need_for_a_combination():
    source="I watch a Lo of TV series when I don't have anything else to do."
    target='I watch a lot of TV series when I have nothing else to do.'
    for family in ('quantifier','negative-possession'):
        assert revision_rejection(source,target,[],lexical_repairs=[family]) is not None
    assert revision_rejection(source,target,[],lexical_repairs=['quantifier','negative-possession']) is None


@pytest.mark.parametrize('source,target,accepted',[
    ('Ill pay 47 dollars.',"I'll pay 48 dollars.",[]),
    ('Ill pay 47 dollars.',"I'll pay 47 euros.",[]),
    ('Ill check.',"I'll check.",['Ill']),
    ('May be I will go.','Maybe I will go.',['May']),
    ('I watch a Lo of old films.','I watch a lot of old films.',['Lo']),
])
def test_every_profile_retains_protected_vocabulary_and_facts(source,target,accepted,monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    arms=importlib.import_module('guard_ablation').profiles()
    assert len(arms)==32 and len({tuple(v) for v in arms.values()})==32
    for families in arms.values():
        assert revision_rejection(source,target,accepted,lexical_repairs=families) is not None


@pytest.mark.parametrize('value',['contractions',{'unknown'},42])
def test_unknown_profiles_are_not_treated_as_enable_everything(value):
    with pytest.raises(ValueError):lexical_families(value)


def test_safety_report_keeps_bad_admissions_distinct_from_good_corrections(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    report=importlib.import_module('guard_ablation_report')
    challenges=importlib.import_module('guard_challenges').cases()
    result=report.challenge_report(challenges,{'none':[],'exact':['contractions'],'maybe':['initial-maybe']})
    assert result['none']['faithfulAdmitted']==0 and result['none']['harmfulAdmitted']==[]
    assert result['exact']['faithfulAdmitted']==4 and result['exact']['harmfulAdmitted']==[]
    assert result['exact']['explicitVocabularyFailures']==[]
    assert result['maybe']['harmfulAdmitted']==['harmful-2']  # Adverse evidence cannot become a pass.
    with pytest.raises(ValueError):report.challenge_report(challenges+[challenges[0]],{'none':[]})


@pytest.mark.parametrize('profile,mode,displayed',[
    ('standard','improve',True),('creative','improve',False),('standard','rephrase',False),
])
def test_guard_only_hook_uses_incumbent_finaliser_and_one_request_with_document_offsets(
        tmp_path,monkeypatch,profile,mode,displayed):
    import time
    from alder.proofreading.service import ProofreadingService
    from alder.proofreading.contracts import u16
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    ablation=importlib.import_module('guard_ablation')
    service=ProofreadingService(tmp_path/'resources',tmp_path/'data');calls=[]
    source='Thanks, Ill watch as soon as I can.';target="Thanks, I'll watch as soon as I can."
    monkeypatch.setattr(service.resources,'capabilities',lambda:{'model':{'available':True},'rules':{'available':True}})
    monkeypatch.setattr(service.rules,'check',lambda *args:[])
    monkeypatch.setattr(service.model,'check',lambda text,config,stop:calls.append((text,config)) or target)
    monkeypatch.setattr(service,'_revision_annotation',lambda text,draft,config:
                        ablation.annotations(text,draft,config,{'selected':['contractions']})['selected'])
    context='😀 Earlier. '+source+' Later.';offset=u16('😀 Earlier. ')
    try:
        job=service.start({'text':context,'targetId':'guard-only','revision':True,'revisionMode':mode,
          'configuration':{'revisionProfile':profile},'range':{'start':offset,'end':offset+u16(source)}})
        for _ in range(100):
            job=service.get(job['id'])
            if job['status'] in ('completed','partial','failed','cancelled'):break
            time.sleep(.01)
        assert job['status']=='completed' and bool(job['annotations'])==displayed and len(calls)==1
        assert calls[0][0]==source and not any(calls[0][1].get(k) for k in ('focusedRepair','grammarRepair'))
        if displayed:
            item=job['annotations'][0]
            assert (item['start'],item['end'],item['replacementText'])==(offset,offset+u16(source),target)
    finally:service.shutdown()
