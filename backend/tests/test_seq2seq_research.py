"""Research GEC adapters must not truncate input or pass incomplete output."""
import importlib
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def worker(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    return importlib.import_module('seq2seq_worker')


def fixture_model(length=12,complete=True):
    calls=[]
    class Tokenizer:
        def __call__(self,text,**kwargs):
            assert kwargs=={'return_tensors':'pt','truncation':False}
            calls.append(text);return {'input_ids':SimpleNamespace(shape=(1,length))}
        def decode(self,ids,**kwargs):
            assert kwargs=={'skip_special_tokens':True,'clean_up_tokenization_spaces':False}
            return '“They are ready,” she says. 🙂'
    def generate(**kwargs):
        assert kwargs['do_sample'] is False and kwargs['num_beams']==1 and kwargs['max_new_tokens']==256
        calls.append('generated');return [SimpleNamespace(tolist=lambda:[0,7,1 if complete else 7])]
    return Tokenizer(),SimpleNamespace(config=SimpleNamespace(eos_token_id=1),generate=generate),SimpleNamespace(inference_mode=nullcontext),calls


def test_research_worker_uses_task_prefix_and_preserves_decoded_unicode(worker):
    tokenizer,model,torch,calls=fixture_model()
    text='“They is ready,” she says. 🙂'
    assert worker.correct({'text':text},tokenizer,model,torch)=='“They are ready,” she says. 🙂'
    assert calls==[worker.PREFIX+text,'generated']


def test_overlong_source_is_rejected_before_generation(worker):
    tokenizer,model,torch,calls=fixture_model(length=513)
    with pytest.raises(ValueError,match='never truncate'):worker.correct({'text':'A long input.'},tokenizer,model,torch)
    assert 'generated' not in calls


def test_output_without_actual_eos_is_withheld(worker):
    tokenizer,model,torch,_=fixture_model(complete=False)
    with pytest.raises(ValueError,match='Incomplete output'):worker.correct({'text':'They is ready.'},tokenizer,model,torch)


@pytest.mark.parametrize('payload',[{'text':None},{'text':' '},{'text':'x'*2401},{'text':'Valid.','revisionMode':'rephrase'}])
def test_unsupported_requests_are_rejected(worker,payload):
    tokenizer,model,torch,calls=fixture_model()
    with pytest.raises(ValueError):worker.correct(payload,tokenizer,model,torch)
    assert not calls


@pytest.mark.parametrize('candidate',['coedit-large-research','grmr-q4b-research'])
def test_restricted_research_candidate_cannot_open_validation_or_sealed_tests(worker,candidate):
    runner=importlib.import_module('run')
    registry=runner.read(Path(worker.__file__).with_name('experiments.json'))
    for stage in ('validation','test'):
        with pytest.raises(ValueError,match='development-only'):
            runner.trials({'trials':[candidate],'diagnosticValidation':True},registry,stage)


def grmr_fixture(worker,length=2,finish='stop',output='They are ready. 🙂'):
    grmr=importlib.import_module('grmr_worker');calls=[]
    class Model:
        def tokenize(self,text,**kwargs):
            calls.append(('prompt',text.decode('utf8')))
            assert kwargs=={'add_bos':False,'special':True};return [7]*length
        def reset(self):calls.append('reset')
        def set_seed(self,seed):assert seed==917;calls.append('seed')
        def __call__(self,tokens,**kwargs):
            assert kwargs['seed']==917 and kwargs['temperature']==.7 and kwargs['min_p']==.01
            assert kwargs['top_k']==40 and kwargs['top_p']==.95 and kwargs['repeat_penalty']==1
            assert kwargs['frequency_penalty']==kwargs['presence_penalty']==0
            assert kwargs['stop']==[grmr.CORRECTED_END] and kwargs['max_tokens']==1100
            calls.append('generated');return {'choices':[{'text':output,'finish_reason':finish}]}
    return grmr,Model(),calls


def test_grmr_uses_published_task_format_and_fresh_request_state(worker):
    grmr,model,calls=grmr_fixture(worker)
    assert grmr.correct({'text':'They is ready. 🙂'},model)=='They are ready. 🙂'
    assert calls==[('prompt','<|text_start|>\nThey is ready. 🙂<|text_end|>\n<|corrected_start|>\n'),
                   'reset','seed','generated']


@pytest.mark.parametrize('delimiter',['<|text_start|>','<|text_end|>','<|corrected_start|>','<|corrected_end|>','<|endoftext|>'])
def test_grmr_reserved_document_delimiters_never_reach_generation(worker,delimiter):
    grmr,model,calls=grmr_fixture(worker)
    with pytest.raises(ValueError,match='Reserved task delimiter'):
        grmr.correct({'text':'A literal '+delimiter+' in the document.'},model)
    assert calls==[]


def test_grmr_rejects_context_overflow_without_truncation(worker):
    grmr,model,calls=grmr_fixture(worker,length=3000)
    with pytest.raises(ValueError,match='never truncate'):grmr.correct({'text':'They is ready.'},model)
    assert 'generated' not in calls and 'reset' not in calls


@pytest.mark.parametrize('finish,output',[('length','They are ready.'),('stop','<|corrected_start|>They are ready.')])
def test_grmr_withholds_truncated_or_malformed_task_output(worker,finish,output):
    grmr,model,_=grmr_fixture(worker,finish=finish,output=output)
    with pytest.raises(ValueError):grmr.correct({'text':'They is ready.'},model)
