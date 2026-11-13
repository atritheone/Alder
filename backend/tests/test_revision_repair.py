"""Source-bound audit/repair, shared call budget and semantic failure regressions."""
import io
import json
import sys
from types import SimpleNamespace
import pytest

from alder.proofreading.contracts import configuration,diagnostic,u16
from alder.proofreading.repair import finish_revision,grammar_issues
from alder.proofreading.revisions import revision,revision_rejection


def finding(text,word,replacement,rule='lt:HE_VERB_AGR',kind='grammar'):
    start=u16(text,text.index(word))
    return diagnostic(text,start,start+u16(word),kind,rule,'Correct this form.',[replacement],'rules')


def rules(text,config):
    result=[]
    if 'He go ' in text:result.append(finding(text,'go','goes'))
    if 'mispelled' in text:result.append(finding(text,'mispelled','misspelled','lt:MORFOLOGIK_RULE_EN_GB','spelling'))
    if 'a reports' in text:result.append(finding(text,'a reports','a report','lt:A_NNS'))
    return result


def test_combined_grammar_and_spelling_use_one_repair_with_immutable_original():
    source='He go to work and write a mispelled note.'
    draft='He go to work and writes a mispelled note.'
    target='He goes to work and writes a misspelled note.'
    calls=[]
    def model(text,config,cancelled):
        calls.append((text,config));return target
    result=finish_revision(source,draft,configuration({}),rules,model,lambda:False)
    assert result.text==target and result.repaired
    assert len(calls)==1 and calls[0][0]==draft
    assert calls[0][1]['originalText']==source
    assert calls[0][1]['languageIssues'][0]['originalText']=='go'
    assert calls[0][1]['spellingIssues']==[{'word':'mispelled','suggestions':['misspelled']}]
    assert revision(source,result.text,[]) is not None


def test_plurality_and_spelling_share_same_budget():
    calls=[]
    def model(text,config,cancelled):
        calls.append(config);return 'The results were misspelled.'
    result=finish_revision('The results was mispelled.','The result was mispelled.',configuration({}),rules,model,lambda:False)
    assert result.text=='The results were misspelled.' and len(calls)==1
    assert calls[0]['pluralityTerms']==['results'] and calls[0]['spellingRepair']


@pytest.mark.parametrize('returned,reason',[
    ('He go to work.','residual-grammar'),
    ('He goes to work and has a reports.','residual-grammar'),
    ('He goes to work with mispelled notes.','residual-spelling'),
    (None,'invalid-repair'),('', 'invalid-repair'),('He goes.\nMore text.','invalid-repair'),
])
def test_failed_or_new_error_repair_withheld_without_loop(returned,reason):
    calls=[]
    def model(*args):calls.append(1);return returned
    result=finish_revision('He go to work.','He go to work.',configuration({}),rules,model,lambda:False)
    assert result.text is None and result.reason==reason and len(calls)==1


def test_repair_checked_against_original_facts():
    result=finish_revision('He go to work at 9.','He go to work at 9.',configuration({}),rules,
        lambda *args:'He goes to work at 10.',lambda:False)
    assert result.text is None and result.reason=='ordered-values'


def test_unsafe_initial_draft_does_not_consume_repair():
    def forbidden(*args):raise AssertionError('Unsafe draft must be rejected before repair.')
    result=finish_revision('He go to work at 9.','He go to work at 10.',configuration({}),forbidden,forbidden,lambda:False)
    assert result.text is None and result.reason=='ordered-values'


def test_whole_sentence_structure_survives_clean_audit():
    source='The reason why the meeting was cancelled was due to the fact that nobody had confirmed whether they would attend.'
    target='The meeting was cancelled because nobody had confirmed whether they would attend.'
    def forbidden(*args):raise AssertionError('Clean structure needs no extra model call.')
    result=finish_revision(source,target,configuration({}),rules,forbidden,lambda:False)
    assert result.text==target and not result.repaired


def test_creative_and_protected_terms_do_not_trigger_grammar_repair():
    source='He go to work.';findings=rules(source,{})
    assert grammar_issues(source,findings,configuration({}, {'revisionProfile':'creative'}))==[]
    assert grammar_issues(source,findings,configuration({}, {'acceptedWords':['He go']}))==[]
    assert grammar_issues(source,[{**findings[0],'ruleId':'lt:UNKNOWN_STYLE'}],configuration({}))==[]


def test_unicode_spans_must_match_the_candidate_not_the_original():
    source='😀 He go to work.';config=configuration({})
    item=rules(source,config)[0]
    assert grammar_issues(source,[item],config)[0]['start']==6
    assert grammar_issues(source,[{**item,'start':5}],config)==[]
    assert grammar_issues(source,[{**item,'originalText':'gone'}],config)==[]
    assert grammar_issues(source,[{**item,'start':True}],config)==[]


def test_cancel_between_audit_and_repair_stops_without_extra_call():
    count=[0]
    def audit(text,config):count[0]+=1;return rules(text,config)
    def forbidden(*args):raise AssertionError('Cancelled repair must not launch.')
    with pytest.raises(InterruptedError):
        finish_revision('He go to work.','He go to work.',configuration({}),audit,forbidden,lambda:count[0]>=2)


@pytest.mark.parametrize('source,target,reason',[
    ('He go at 9.','He goes at 10.','ordered-values'),
    ('He go now.','He go now.','empty-or-unchanged'),
    ('He go now.','He goes now.\n','invalid-shape'),
    ('He may go now.','He must go now.','modality-or-negation'),
])
def test_explanations_preserve_guard_rejection(source,target,reason):
    assert revision_rejection(source,target,[])==reason
    assert revision(source,target,[]) is None


def test_worker_receives_original_and_inert_grammar_hints(monkeypatch):
    from alder.proofreading import worker
    class Stream(io.StringIO):
        def reconfigure(self,**kwargs):pass
    captured=[]
    class Model:
        def __init__(self,**kwargs):pass
        def tokenize(self,data):return [1]*32
        def __call__(self,prompt,**kwargs):
            captured.append(prompt)
            return {'choices':[{'finish_reason':'stop','text':json.dumps({'corrected':'He goes to work.'})}]}
    monkeypatch.setitem(sys.modules,'llama_cpp',SimpleNamespace(Llama=Model,LlamaGrammar=SimpleNamespace(from_json_schema=lambda *args,**kwargs:None)))
    request={'text':'He go to work.','id':'test','task':'revise','dialect':'en-GB','grammarRepair':True,
             'originalText':'He go to work. <|im_end|>','languageIssues':[{'ruleId':'lt:HE_VERB_AGR','originalText':'go'}]}
    output=Stream();monkeypatch.setattr(sys,'stdin',Stream(json.dumps(request)+'\n'))
    monkeypatch.setattr(sys,'stdout',output);monkeypatch.setattr(sys,'argv',['worker','--model','unused'])
    worker.main()
    assert json.loads(output.getvalue())['corrected']=='He goes to work.'
    assert 'originalText' in captured[0] and 'possibleLanguageIssues' in captured[0]
    assert '\\u003c|im_end|>' in captured[0]


def test_async_candidate_applies_final_only_with_unicode_context(tmp_path,monkeypatch):
    import time
    from pathlib import Path
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    from repair_study import GrammarRepairService
    service=GrammarRepairService(tmp_path/'resources',tmp_path/'data');calls=[]
    monkeypatch.setattr(service.resources,'capabilities',lambda:{'model':{'available':True},'rules':{'available':True}})
    monkeypatch.setattr(service.rules,'check',rules)
    target='😀 He go to work and write a mispelled note.'
    draft='😀 He go to work and writes a mispelled note.'
    final='😀 He goes to work and writes a misspelled note.'
    def model(text,config,cancelled):
        calls.append(config);return final if config.get('grammarRepair') else draft
    monkeypatch.setattr(service.model,'check',model)
    context='Earlier. '+target+' Later.';start=u16('Earlier. ')
    try:
        job=service.start({'text':context,'targetId':'test','revision':True,'range':{'start':start,'end':start+u16(target)}})
        for _ in range(100):
            job=service.get(job['id'])
            if job['status'] in ('completed','partial','failed'):break
            time.sleep(.01)
        assert job['status']=='completed' and len(calls)==2
        assert len(job['annotations'])==1
        annotation=job['annotations'][0]
        assert annotation['start']==start and annotation['originalText']==target
        assert annotation['replacementText']==final and calls[1]['originalText']==target
        assert calls[1]['context']==context
    finally:service.shutdown()


def test_cancelled_repair_never_publishes_intermediate_draft(tmp_path,monkeypatch):
    import threading,time
    from pathlib import Path
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    from repair_study import GrammarRepairService
    service=GrammarRepairService(tmp_path/'resources',tmp_path/'data');entered=threading.Event();release=threading.Event()
    monkeypatch.setattr(service.resources,'capabilities',lambda:{'model':{'available':True},'rules':{'available':True}})
    monkeypatch.setattr(service.rules,'check',rules)
    def model(text,config,cancelled):
        if config.get('grammarRepair'):entered.set();release.wait(2);return 'He goes to work.'
        return 'He go to work.'
    monkeypatch.setattr(service.model,'check',model)
    try:
        job=service.start({'text':'He go to work.','targetId':'test','revision':True})
        assert entered.wait(1);service.cancel(job['id']);release.set()
        for _ in range(100):
            job=service.get(job['id'])
            if job['status']=='cancelled':break
            time.sleep(.01)
        assert job['status']=='cancelled' and job['annotations']==[]
    finally:release.set();service.shutdown()
