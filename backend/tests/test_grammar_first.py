import time
from pathlib import Path
import pytest
from alder.proofreading.contracts import configuration,diagnostic,u16


@pytest.fixture
def service(tmp_path,monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    from repair_study import GrammarFirstService
    value=GrammarFirstService(tmp_path/'resources',tmp_path/'data')
    monkeypatch.setattr(value.resources,'capabilities',lambda:{'model':{'available':True},'rules':{'available':True}})
    monkeypatch.setattr(value.rules,'check',lambda *a:[])
    try:yield value
    finally:value.shutdown()


def run(service,source):
    job=service.start({'text':source,'targetId':'grammar-first','revision':True})
    for _ in range(100):
        job=service.get(job['id'])
        if job['status'] in ('completed','partial','failed','cancelled'):break
        time.sleep(.01)
    return job


def test_complete_grammar_correction_needs_one_call(service,monkeypatch):
    calls=[]
    def model(text,config,stop):calls.append(config);return 'He goes to work with misspelled notes.'
    monkeypatch.setattr(service.model,'check',model)
    job=run(service,'He go to work with mispelled notes.')
    assert job['status']=='completed' and len(calls)==1 and calls[0]['task']=='proofread'
    assert job['annotations'][0]['replacementText']=='He goes to work with misspelled notes.'


def test_grammatical_but_redundant_sentence_still_gets_whole_sentence_restructuring(service,monkeypatch):
    source='The reason why the meeting was cancelled was due to the fact that nobody had confirmed whether they would attend.'
    target='The meeting was cancelled because nobody had confirmed whether they would attend.';calls=[]
    def model(text,config,stop):
        calls.append((text,config));return source if config.get('grammarFirstPass') else target
    monkeypatch.setattr(service.model,'check',model)
    job=run(service,source)
    assert job['status']=='completed' and len(calls)==2
    assert calls[1][0]==source and calls[1][1]['task']=='revise' and calls[1][1]['clarityFallback']
    assert len(job['annotations'])==1 and job['annotations'][0]['replacementText']==target


@pytest.mark.parametrize('first',[
    'Because the train arrived late, a difficult morning',
    'Because the train arrived late, a difficult morning.',
])
def test_case_and_punctuation_changes_do_not_publish_an_unrepaired_fragment(service,monkeypatch,first):
    source='because the train arrived late, a difficult morning'
    target='Because the train arrived late, it was a difficult morning.';calls=[]
    def model(text,config,stop):calls.append(config);return first if config.get('grammarFirstPass') else target
    monkeypatch.setattr(service.model,'check',model)
    job=run(service,source)
    assert job['status']=='completed' and len(calls)==2
    assert job['annotations'][0]['replacementText']==target


def test_invalid_locator_shape_falls_back_without_publishing_it(service,monkeypatch):
    calls=[]
    def model(text,config,stop):calls.append(config);return 'A title.\n\n' if config.get('grammarFirstPass') else text
    monkeypatch.setattr(service.model,'check',model)
    job=run(service,'A title.')
    assert job['status']=='completed' and len(calls)==2 and job['annotations']==[]


def test_spelling_in_clarity_fallback_is_withheld_without_third_call(service,monkeypatch):
    source='The report arrived.';calls=[]
    def rules(text,config):
        if 'mispelled' not in text:return []
        start=u16(text,text.index('mispelled'))
        return [diagnostic(text,start,start+9,'spelling','lt:SPELL','Spelling',['misspelled'],'rules')]
    def model(text,config,stop):calls.append(config);return source if config.get('grammarFirstPass') else 'The mispelled report arrived.'
    monkeypatch.setattr(service.rules,'check',rules);monkeypatch.setattr(service.model,'check',model)
    job=run(service,source)
    assert job['status']=='partial' and job['annotations']==[] and len(calls)==2


def test_first_pass_retains_one_repair_for_plurality(service,monkeypatch):
    calls=[]
    def model(text,config,stop):
        calls.append(config)
        return 'The results were unexpected.' if config.get('repairReason')=='plurality' else 'The result was unexpected.'
    monkeypatch.setattr(service.model,'check',model)
    job=run(service,'The results was unexpected.')
    assert job['status']=='completed' and len(calls)==2 and calls[1]['repairReason']=='plurality'
    assert job['annotations'][0]['replacementText']=='The results were unexpected.'


@pytest.mark.parametrize('profile,mode',[('creative','improve'),('standard','rephrase')])
def test_creative_and_another_construction_still_use_the_existing_editor(service,monkeypatch,profile,mode):
    calls=[];monkeypatch.setattr(service.model,'check',lambda text,config,stop:calls.append(config) or text)
    config={**configuration({}, {'revisionProfile':profile}),'task':'revise','revisionMode':mode}
    source='A cold night.'
    assert service._generate_revision(source,config,lambda:False,lambda:False)==source
    assert len(calls)==1 and calls[0]['task']=='revise' and not calls[0].get('grammarFirstPass')
