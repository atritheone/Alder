"""Real loopback checks for developer evaluation availability and cancellation."""
import importlib
import json
from pathlib import Path
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import pytest

DIRECTORY=Path(__file__).resolve().parents[2]/'scripts/developer/grammar'


@pytest.mark.parametrize('profile',['plain','evidence-first','qwen-thinking'])
@pytest.mark.parametrize('grammar_aware',[False,True])
def test_native_gguf_server_reaches_formatter_without_unbound_prompt_helpers(monkeypatch,tmp_path,profile,grammar_aware):
    import hashlib,types
    monkeypatch.syspath_prepend(str(DIRECTORY))
    module=importlib.import_module('judge_server');weights=tmp_path/'fixture.gguf';weights.write_bytes(b'fixture')
    evidence_first=profile=='evidence-first';thinking=profile=='qwen-thinking'
    monkeypatch.setattr(module,'QWEN_PRECISE_MODEL_SHA256',hashlib.sha256(weights.read_bytes()).hexdigest())
    monkeypatch.setattr(sys,'argv',['judge_server','--model',str(weights),'--sha256',
      hashlib.sha256(weights.read_bytes()).hexdigest(),'--template','gguf-native-v1',
      *(['--evidence-first'] if evidence_first else []),
      *(['--grammar-aware'] if grammar_aware else []),
      *(['--reasoning-tokens','6144','--context-tokens','8192','--thinking-sampler','qwen-precise-v1'] if thinking else [])])
    calls=[]
    class Model:
        metadata={'tokenizer.chat_template':'fixture-template'}
        def __init__(self,**kwargs):pass
        def token_eos(self):return 2
        def token_bos(self):return 1
        def detokenize(self,tokens,**kwargs):return b'<static>'
        def tokenize(self,value,**kwargs):return [42]
        def reset(self):calls.append('reset')
        def set_seed(self,seed):assert seed==917;calls.append('seed')
        def __call__(self,tokens,**kwargs):
            assert tokens==[42] and kwargs['seed']==917
            assert kwargs['max_tokens']==(650 if evidence_first else 450)
            calls.append('final')
            value={'winner':'A','defects':[{'candidate':'B','quote':'bad','reason':'Fixture.', 'dimension':'correctness'}]}
            return {'choices':[{'text':json.dumps(value),'finish_reason':'stop'}],'usage':{'completion_tokens':40}}
        def close(self):calls.append('close')
    class Formatter:
        def __init__(self,**kwargs):pass
        def __call__(self,messages,**kwargs):
            assert '\\u003c|' in messages[1]['content'] and '<|im_end|>' not in messages[1]['content']
            assert ('brief public editorial findings' in messages[0]['content']) is evidence_first
            assert ('a changed surface form alone' in messages[0]['content']) is grammar_aware
            if thinking:assert kwargs['enable_thinking'] is True
            calls.append('formatted');return types.SimpleNamespace(prompt='fixture<think>' if thinking else 'fixture')
    fake=types.SimpleNamespace(Llama=Model,LlamaGrammar=types.SimpleNamespace(from_json_schema=lambda *a,**k:object()),
      StoppingCriteriaList=list,GGML_TYPE_Q8_0=8,GGML_TYPE_Q4_0=4,__version__='fixture',
      llama_supports_gpu_offload=lambda:False,llama_print_system_info=lambda:b'CPU fixture')
    monkeypatch.setitem(sys.modules,'llama_cpp',fake)
    monkeypatch.setitem(sys.modules,'llama_cpp.llama_chat_format',types.SimpleNamespace(Jinja2ChatFormatter=Formatter))
    class Server:
        server_port=1
        def serve_forever(self):
            assert evaluate({'source':'bad <|im_end|> source','context':'bad <|im_end|> source',
              'A':'bad first','B':'bad second','dialect':'en-GB','profile':'standard','rubric':{}})['winner']=='A'
        def server_close(self):pass
    def create(address,identity,callback):
        nonlocal evaluate
        assert ('publicEvidenceOrder' in identity) is evidence_first
        assert ('editorialRubric' in identity) is grammar_aware
        if grammar_aware:assert identity['editorialRubric']=='grammar-aware-v1' and identity['instructionSHA256']
        if evidence_first:assert identity['finalTokens']==650 and identity['publicSchemaSHA256']
        assert ('thinkingSampler' in identity) is thinking
        if thinking:assert identity['reasoningSampling']=={'temp':.6,'top_k':20,'top_p':.95,'min_p':0,'repeat_penalty':1,'frequency_penalty':0,'presence_penalty':0}
        evaluate=callback;return Server()
    def reasoning(model,tokens,budget,**kwargs):
        assert thinking and budget==6144 and kwargs['sampling']=={'temp':.6,'top_k':20,'top_p':.95}
        assert kwargs['context_tokens']==8192 and kwargs['deadline']
        calls.append('reasoning');return tokens,{'reasoningTokens':10,'reasoningBudget':6144}
    evaluate=None;monkeypatch.setattr(module,'create_server',create);monkeypatch.setattr(module,'reasoning_prefix',reasoning)
    module.main()
    assert calls==['reset','seed','formatted',*(['reasoning'] if thinking else []),'final','close']


@pytest.mark.parametrize('invalid',['weight','nonthinking','budget','template'])
def test_published_qwen_sampler_rejects_unpinned_or_incompatible_profiles_before_loading(monkeypatch,tmp_path,invalid):
    monkeypatch.syspath_prepend(str(DIRECTORY));module=importlib.import_module('judge_server')
    args=['judge_server','--model',str(tmp_path/'unloaded.gguf'),'--sha256',
        'wrong' if invalid=='weight' else module.QWEN_PRECISE_MODEL_SHA256,
        '--template','auto' if invalid=='template' else 'gguf-native-v1','--thinking-sampler','qwen-precise-v1']
    if invalid!='budget':args+=['--reasoning-tokens','6144']
    if invalid=='nonthinking':args.append('--nonthinking')
    monkeypatch.setattr(sys,'argv',args)
    with pytest.raises(ValueError,match='pinned native thinking profile'):module.main()


def test_fixed_readiness_prefix_can_resume_without_regenerating_previous_pairs(monkeypatch,tmp_path):
    monkeypatch.syspath_prepend(str(DIRECTORY));module=importlib.import_module('judge');common=importlib.import_module('common')
    calls=tmp_path/'calls';worker=tmp_path/'worker.py'
    worker.write_text('import json,sys\nfrom pathlib import Path\n'+
        f'with Path({str(calls)!r}).open("a") as out:out.write("call\\n")\n'+
        'p=json.load(sys.stdin);winner="A" if p["A"]=="good" else "B"\n'+
        'print(json.dumps({"winner":winner,"defects":[{"candidate":"B" if winner=="A" else "A","quote":"bad","reason":"Fixture.","dimension":"correctness"}]}))\n','utf-8')
    pairs=tmp_path/'controls.jsonl';config=tmp_path/'config.json';target=tmp_path/'ratings.json'
    pairs.write_text(''.join(json.dumps({'id':str(i),'group':str(i),'split':'calibration',
        'source':'bad','a':'bad','b':'good','correctWinner':'B'})+'\n' for i in range(3)),'utf-8')
    common.write(config,{'family':'readiness-fixture','modelSHA256':'fixture','command':[sys.executable,str(worker)]})
    for limit in (1,3):
        monkeypatch.setattr(sys,'argv',['judge','--pairs',str(pairs),'--judge-config',str(config),'--output',str(target),'--limit',str(limit)])
        module.main()
    result=common.read(target)
    assert result['status']=='completed' and result['requestedCases']==3
    assert [row['id'] for row in result['records']]==['0','1','2']
    assert all(row['winner']=='B' for row in result['records'])
    assert len(calls.read_text().splitlines())==6  # Two orders per distinct pair, once.


def test_evidence_first_public_grammar_binds_each_candidates_exact_quotes(monkeypatch):
    monkeypatch.syspath_prepend(str(DIRECTORY))
    protocol=importlib.import_module('judge_protocol')
    payload={'A':'Alice goes to school.','B':'Bob go to school.'}
    schema=protocol.evidence_first_schema(payload)
    assert list(schema['properties'])==['defects','winner']
    for branch in schema['properties']['defects']['items']['oneOf']:
        candidate=branch['properties']['candidate']['enum'][0]
        assert all(quote in payload[candidate] for quote in branch['properties']['quote']['enum'])
    assert set(schema['properties']['winner']['enum'])=={'A','B','tie','abstain'}


@pytest.fixture
def modules(monkeypatch):
    monkeypatch.syspath_prepend(str(DIRECTORY))
    return {name:importlib.import_module(name) for name in ('judge_http','judge','common','tagger_hints','native_reasoning')}


def test_busy_inference_keeps_identity_responsive_and_never_queues_native_calls(modules):
    entered=threading.Event();release=threading.Event();calls=[]
    def evaluate(payload):
        calls.append(payload);entered.set()
        if not release.wait(5):raise RuntimeError('Fixture deadline')
        return {'winner':'tie','defects':[]}
    server=modules['judge_http'].create_server(('127.0.0.1',0),{'modelSHA256':'fixture','template':'auto'},evaluate)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    url=f'http://127.0.0.1:{server.server_port}/'
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def post(path=''):
        with opener.open(urllib.request.Request(url+path,data=b'{}'),timeout=4) as response:return json.load(response)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(post)
            try:
                assert entered.wait(3)
                with opener.open(url,timeout=2) as response:assert json.load(response)['modelSHA256']=='fixture'
                for path in ('','shutdown'):
                    with pytest.raises(urllib.error.HTTPError) as error:post(path)
                    assert error.value.code==503 and json.load(error.value)=={'error':'JudgeBusy'}
                command=[sys.executable,'-B',str(DIRECTORY/'judge_client.py'),'--url',url,
                  '--sha256','fixture','--template','auto','--timeout','1']
                result=subprocess.run(command,input='private fixture text',capture_output=True,text=True,timeout=4)
                assert result.returncode==75 and result.stdout==''
                assert json.loads(result.stderr)=={'failure':'JudgeBusy','phase':'inference'}
                assert len(calls)==1
            finally:release.set()
            assert future.result(timeout=3)=={'winner':'tie','defects':[]}
        assert post('shutdown')=={'status':'stopping'}
        thread.join(timeout=3);assert not thread.is_alive()
    finally:
        release.set();server.shutdown();server.server_close();thread.join(timeout=3)


def test_judge_transport_failure_records_current_abstention_and_preserves_remaining_pairs(modules,tmp_path,monkeypatch):
    common=modules['common'];calls=tmp_path/'calls'
    fake=tmp_path/'unavailable.py'
    fake.write_text('from pathlib import Path\nimport sys\n'+f'Path({str(calls)!r}).write_text("called")\nsys.exit(75)\n','utf8')
    config=tmp_path/'config.json';pairs=tmp_path/'pairs.jsonl';output=tmp_path/'ratings.json'
    common.write(config,{'family':'transport-fixture','modelSHA256':'fixture','command':[sys.executable,str(fake)]})
    pairs.write_text(''.join(json.dumps({'id':str(index),'group':str(index),'split':'calibration',
      'source':'He go.','a':'He goes.','b':'He went.'})+'\n' for index in range(3)),'utf8')
    monkeypatch.setattr(sys,'argv',['judge.py','--pairs',str(pairs),'--judge-config',str(config),'--output',str(output)])
    modules['judge'].main();report=common.read(output)
    assert calls.read_text()=='called' and report['status']=='interrupted'
    assert len(report['records'])==1 and report['requestedCases']==3
    row=report['records'][0]
    assert row['winner']=='abstain' and row['orderDecisions']==['abstain','abstain']
    assert row['errors']==['CalledProcessError','TransportUnavailable']


def test_invalid_judge_body_releases_native_lock_without_leaking_source(modules):
    server=modules['judge_http'].create_server(('127.0.0.1',0),{},lambda value: {'received':True})
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    url=f'http://127.0.0.1:{server.server_port}/'
    try:
        with pytest.raises(urllib.error.HTTPError) as error:
            opener.open(urllib.request.Request(url,data=b'private malformed text'),timeout=2)
        assert error.value.code==422 and json.load(error.value)=={'error':'JSONDecodeError'}
        with opener.open(urllib.request.Request(url,data=b'{}'),timeout=2) as response:
            assert json.load(response)=={'received':True}
    finally:server.shutdown();server.server_close();thread.join(timeout=3)


def test_tagger_keeps_exact_unicode_offsets_and_rejects_truncated_alignment(modules):
    tagger=modules['tagger_hints'];text='🙂  The trains is late.'
    assert tagger.word_spans(text)[2]==(7,13,'trains')
    with pytest.raises(ValueError,match='Incomplete'):tagger.first_subtokens([None,0,0,1,None],3)
    with pytest.raises(ValueError,match='Invalid'):tagger.first_subtokens([0,2,1],3)
    assert tagger.first_subtokens([None,0,0,1,2,2,None],3)==[1,3,4]


def test_tagger_invalid_scores_and_case_only_tags_cannot_become_hints(modules):
    tagger=modules['tagger_hints'];labels=['$KEEP','$REPLACE_are','$TRANSFORM_CASE_CAPITAL']
    words=[None,0,1,2,None];probabilities=[[1,0,0],[1,0,0],[0,0,1],[0,1,0],[1,0,0]]
    hints=tagger.decode_tags('trains is',labels,words,probabilities,[0,0,.9,.9,0],{})
    assert len(hints)==1 and hints[0]['originalText']=='is' and hints[0]['alternatives'][0]['edits'][0]['replacement']=='are'
    with pytest.raises(ValueError,match='probabilities'):
        tagger.decode_tags('trains is',labels,words,[*probabilities[:-1],[float('nan'),0,0]],[0,0,.9,.9,0],{})
    with pytest.raises(ValueError,match='length'):
        tagger.decode_tags('trains is',labels,words,probabilities[:-1],[0,0,.9,.9,0],{})
    assert tagger.suggestion('children','$TRANSFORM_AGREEMENT_SINGULAR',{}) is None
    assert tagger.suggestion('read','$TRANSFORM_VERB_VB_VBD',{('read','VB','VBD'):{'read','red'}}) is None


def test_longer_native_profile_still_requires_actual_closure_without_decoding_content(modules):
    from types import SimpleNamespace
    decoded=[]
    def decode(ids,**kwargs):
        decoded.append(ids);assert ids==[9];return b'</think>'
    def generate(tokens,**kwargs):yield from [*([7]*2500),9]
    model=SimpleNamespace(tokenize=lambda *args,**kwargs:[9],detokenize=decode,generate=generate,token_eos=lambda:0)
    tokens,stats=modules['native_reasoning'].reasoning_prefix(model,[1],6144,context_tokens=8192)
    assert len(tokens)==2502 and tokens[-1]==9 and decoded==[[9]]
    assert stats=={'reasoningTokens':2501,'reasoningBudget':6144}
    with pytest.raises(ValueError,match='token budget'):
        modules['native_reasoning'].reasoning_prefix(model,[1],8193,context_tokens=16384)


def test_native_request_deadline_closes_generation_without_a_forced_final_answer(modules,monkeypatch):
    from types import SimpleNamespace
    native=modules['native_reasoning'];closed=[]
    def generate(tokens,**kwargs):
        try:yield from [7,8,9]
        finally:closed.append(True)
    model=SimpleNamespace(tokenize=lambda *args,**kwargs:[9],detokenize=lambda *args,**kwargs:b'</think>',
      generate=generate,token_eos=lambda:0)
    monkeypatch.setattr(native.time,'monotonic',lambda:11)
    with pytest.raises(native.ReasoningFailure) as error:native.reasoning_prefix(model,[1],128,deadline=10)
    assert error.value.diagnostic=={'reasoningFailure':'deadline','generatedTokens':0,'reasoningBudget':128}
    assert closed==[True]


def test_rejected_tagger_probe_cannot_be_run_as_a_qualified_candidate(modules):
    runner=importlib.import_module('run');registry=modules['common'].read(DIRECTORY/'experiments.json')
    with pytest.raises(ValueError,match='rejected at its native probe'):
        runner.trials({'trials':['4b-tagger-hints']},registry,'development')


def test_recorded_model_replay_cannot_reuse_a_response_for_different_context_or_locale(modules):
    replay=importlib.import_module('replay');config={'dialect':'en-AU','context':'Read-only context.','acceptedWords':['Quux']}
    trace=[{'source':'The report is late.','phase':'generation','proposal':'The report is late.',
      'configurationSHA256':modules['common'].digest(config)}]
    for changed in ({**config,'dialect':'en-US'},{**config,'context':'Another context.'},{**config,'acceptedWords':[]}):
        used=[]
        with pytest.raises(RuntimeError,match='unrecorded'):replay.recorded_request(trace,used,trace[0]['source'],changed)
        assert used==[]
    used=[]
    assert replay.recorded_request(trace,used,trace[0]['source'],config)==trace[0]['proposal'] and used==[0]
    with pytest.raises(RuntimeError,match='unrecorded'):replay.recorded_request(trace,used,trace[0]['source'],config)


def test_service_cannot_turn_an_unbound_replay_request_into_completed_evidence(modules,tmp_path,monkeypatch):
    replay=importlib.import_module('replay');common=modules['common']
    data={'schemaVersion':1,'rights':{'evaluationAllowed':True},'cases':[{'id':'a','group':'a',
      'source':'He go.','split':'development','dialect':'en-AU','profile':'standard','track':'correctness'}]}
    corpus=tmp_path/'corpus.json';baseline=tmp_path/'baseline.jsonl';output=tmp_path/'replay.jsonl'
    common.write(corpus,data)
    baseline.write_text(json.dumps({'id':'a','source':'He go.','fingerprint':'old','modelTrace':[
      {'source':'He go.','phase':'generation','proposal':'He goes.','configurationSHA256':'wrong'}]})+'\n','utf8')
    common.write(baseline.with_suffix('.manifest.json'),{'fingerprint':'old','settings':{'corpus':common.digest(data)}})
    class Service:
        def __init__(self,*args):
            from types import SimpleNamespace
            self.model=SimpleNamespace()
        def start(self,request):
            try:self.model.check('He go.',{'dialect':'en-AU'},lambda:False)
            except RuntimeError:pass  # Real service reports a failed job rather than propagating it.
            return {'status':'failed','annotations':[],'warnings':['Check failed.']}
        def shutdown(self):pass
    monkeypatch.setattr(replay.generate,'ProofreadingService',Service)
    monkeypatch.setattr(sys,'argv',['replay.py','--corpus',str(corpus),'--baseline',str(baseline),
      '--resources',str(tmp_path),'--output',str(output)])
    with pytest.raises(RuntimeError,match='unrecorded model requests'):replay.main()
    report=common.read(output.with_suffix('.manifest.json'))
    assert report['status']=='failed' and report['unboundRequestCaseIds']==['a']
    row=common.records(output)[0]
    assert row['status']=='failed' and row['replayRequestsBound'] is False and row['recordedCallsUsed']==[]


def test_published_edit_parser_keeps_labels_and_rejects_malformed_annotations(modules):
    importer=importlib.import_module('import_edit_acceptability')
    before,after,votes=importer.correction('They [is→are|True] [very→|False] late.')
    assert before=='They is very late.' and after=='They are  late.' and votes==[True,False]
    for malformed in ('They [is→are|True,] late.','They [is→are|False|True] late.','They [is→are|True late.'):
        with pytest.raises(ValueError,match='MalformedEditMarkup'):importer.correction(malformed)


def test_published_source_error_markers_must_align_to_an_original_source(modules):
    importer=importlib.import_module('import_edit_acceptability')
    content='<t>They [is] late.</t>\n<Correction>\n<s1>They [is→are|True] late.</s1>'
    source,rows=importer.parse_file(content,{'Theyislate.':{'They is late.'}})
    assert source=='They is late.' and rows[0]['targetCompact']=='Theyarelate.'
    with pytest.raises(ValueError,match='UnalignedEditSource'):
        importer.parse_file(content.replace('[is→are|True]','[was→are|True]'),{'Theyislate.':{'They is late.'}})
    with pytest.raises(ValueError,match='CorrectionTags'):
        importer.parse_file(content.replace('</s1>','</s2>'),{'Theyislate.':{'They is late.'}})


def test_conditional_worker_uses_hints_without_bypassing_spelling_repair_or_explicit_rephrasing(modules,tmp_path,monkeypatch):
    import io
    from types import SimpleNamespace
    diagnosis=importlib.import_module('source_diagnosis');experiment=importlib.import_module('experiment')
    trace=tmp_path/'assessment.jsonl'
    source=(DIRECTORY.parents[2]/'backend/alder/proofreading/worker.py').read_text('utf8')
    worker=experiment.rule_hints_worker(diagnosis.render_worker(source,trace,rule_guided=True))
    namespace={'__name__':'conditional_worker'};exec(compile(worker,'conditional-worker','exec'),namespace)
    prompts=[]
    class Model:
        def __init__(self,**kwargs):pass
        def tokenize(self,*args,**kwargs):return [1]
        def __call__(self,prompt,**kwargs):
            prompts.append(prompt)
            value=({'issueType':'none','evidence':'','corrected':''} if len(prompts)==1 else
                   {'corrected':'The trains were late.'})
            return {'choices':[{'text':json.dumps(value),'finish_reason':'stop'}]}
    class Stream(io.StringIO):
        def reconfigure(self,**kwargs):pass
    base={'text':'The trains were late.','task':'revise','dialect':'en-AU'}
    hints=[{'kind':'grammar','word':'was','suggestions':['were']}]
    requests=[base,{**base,'text':'The trains was late.','spellingIssues':hints},
      {**base,'spellingRepair':True,'spellingIssues':hints},{**base,'revisionMode':'rephrase'}]
    protocol=Stream();monkeypatch.setattr(sys,'stdin',Stream(''.join(json.dumps(row)+'\n' for row in requests)))
    monkeypatch.setattr(sys,'stdout',protocol);monkeypatch.setattr(sys,'argv',['worker','--model','fixture'])
    monkeypatch.setitem(sys.modules,'llama_cpp',SimpleNamespace(Llama=Model,
      LlamaGrammar=SimpleNamespace(from_json_schema=lambda *args,**kwargs:'grammar')))
    namespace['main']()
    assert [row['corrected'] for row in map(json.loads,protocol.getvalue().splitlines())]==['The trains were late.']*4
    assert len(trace.read_text('utf8').splitlines())==1
    assert diagnosis.DIAGNOSIS_INSTRUCTION in prompts[0]
    assert all(diagnosis.DIAGNOSIS_INSTRUCTION not in prompt for prompt in prompts[1:])
    assert 'possibleLanguageIssues' in prompts[1] and 'possibleSpellingIssues' in prompts[2]
