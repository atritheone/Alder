"""Evaluation failures must not turn into successful corrections or qualification."""
import importlib.util
import sys
from pathlib import Path
import pytest

DIRECTORY=Path(__file__).resolve().parents[2]/'scripts/developer/grammar'


@pytest.fixture
def evaluation(monkeypatch):
    monkeypatch.syspath_prepend(str(DIRECTORY))
    modules={}
    for name in ('common','judge','compare','calibrate','qualify','reference','conll_documents','run','document_cohort','reference_comparison','audit_inference','judge_client','judge_protocol','absolute_grading','native_worker','assess','pointwise_judge_server','normalize_display','reference_guidance','native_reasoning','judge_server','generate','experiment','specialist_judge_server','ranking','comparator','candidate_pairs','import_preservation','mistral_tokenizer','review_tatoeba','source_diagnosis'):
        spec=importlib.util.spec_from_file_location('grammar_'+name,DIRECTORY/(name+'.py'))
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        modules[name]=module
        monkeypatch.setitem(sys.modules,name,module)
    return modules


@pytest.mark.parametrize('field',['mustContain','mustPreserve','expectUnchanged'])
def test_corpus_rejects_unsupported_expectations_instead_of_silently_leaving_checks_ungraded(evaluation,tmp_path,field):
    module=evaluation['common'];target=tmp_path/'corpus.json'
    row={'id':'a','group':'a','source':'They was late.','split':'development',
      'dialect':'en-AU','profile':'standard','track':'document',field:['were']}
    module.write(target,{'schemaVersion':1,'rights':{'evaluationAllowed':True},'cases':[row]})
    with pytest.raises(ValueError,match='Unsupported expectation'):module.corpus(target)
    del row[field];row['required']='were'
    module.write(target,{'schemaVersion':1,'rights':{'evaluationAllowed':True},'cases':[row]})
    with pytest.raises(ValueError,match='lists of nonempty strings'):module.corpus(target)


@pytest.mark.parametrize('ratings,expected',[
    ([('a',1),('b',1)],'community-OK'),
    ([('a',-1),('b',-1)],'community-not-OK'),
    ([('a',1),('b',-1)],'unlabelled'),
    ([('a',1),('b',1),('unknown',0)],'unlabelled'),
    ([('owner',1),('a',1)],'unlabelled'),
    ([('a',1),('a',1),('b',1)],'unlabelled'),
])
def test_community_reviews_require_distinct_current_external_reviewers(evaluation,ratings,expected):
    module=evaluation['review_tatoeba'];case={'owner':'owner','modified':module.date('2026-10-01 12:00:00')}
    state,_,_=module.review_state(case,[(user,rating,'2026-10-02 12:00:00') for user,rating in ratings],{'owner','a','b'})
    assert state==expected
    stale=[(user,rating,'2026-09-01 12:00:00') for user,rating in ratings]
    state,_,excluded=module.review_state(case,stale,{'owner','a','b'})
    assert state=='unlabelled' and excluded['staleReview']==len(ratings)


def test_community_population_inspection_binds_snapshot_text_and_review_dates(evaluation,tmp_path):
    import bz2,hashlib
    module=evaluation['review_tatoeba'];common=evaluation['common']
    texts={1:'This sentence has several ordinary English words.',2:'Another sentence has several ordinary English words.'}
    cc0=''.join(f'{key}\teng\t{text}\t2026-10-01 12:00:00\n' for key,text in texts.items())
    detailed=''.join(f'{key}\teng\t{text}\twriter\t2026-04-02 12:00:00\t2026-10-01 12:00:00\n' for key,text in texts.items())
    detailed+=f'3\teng\t{texts[2]}\tother\t2026-04-02 12:00:00\t2026-10-01 12:00:00\n'
    payloads={'english-CC0.tsv.bz2':bz2.compress(cc0.encode()),'english-detailed.tsv.bz2':bz2.compress(detailed.encode()),
      'user-languages.tsv':b'eng\t5\ta\tDescription\ncontinued description\neng\t5\tb\tDescription\n',
      'sentence-reviews.tsv':b'a\t1\t1\t2026-10-02 00:00:00\t2026-10-02 00:00:00\nb\t1\t1\t2026-10-02 00:00:00\t2026-10-02 00:00:00\na\t2\t1\t2026-10-02 00:00:00\t2026-10-02 00:00:00\nb\t2\t1\t2026-09-02 00:00:00\t2026-09-02 00:00:00\n'}
    entries={}
    for name,content in payloads.items():
        (tmp_path/name).write_bytes(content);entries[name]={'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()}
    common.write(tmp_path/'asset-manifest.json',{'status':'completed','files':entries})
    inventory=[];report=module.inspect(tmp_path,module.date('2026-04-01'),inventory=inventory)
    assert report['status']=='unverified' and report['populations']['created-after-cutoff']['states']=={'community-OK':1,'unlabelled':1}
    assert report['exclusions']['staleReview']==1 and report['exclusions']['unstructuredLanguageDescriptionLine']==1
    assert len(inventory)==1 and inventory[0]['sourceSHA256']==common.digest(texts[1]) and 'source' not in inventory[0]
    with pytest.raises(ValueError,match='licence'):module.inspect(tmp_path,module.date('2026-04-01'),False)
    common.write(tmp_path/'asset-manifest.json',{'status':'completed','files':entries,'licence':'CC BY 2.0 FR'})
    broad=module.inspect(tmp_path,module.date('2026-04-01'),False)
    assert broad['textScope']=='all-attributed-English' and broad['exclusions']['duplicateSourceText']==2
    assert broad['populations']['all-attributed-English']['eligibleSentences']==1
    (tmp_path/'sentence-reviews.tsv').write_bytes(b'changed')
    with pytest.raises(ValueError,match='checksum'):module.inspect(tmp_path,module.date('2026-04-01'))


def test_source_diagnosis_has_an_explicit_unchanged_branch_and_exact_source_evidence(evaluation):
    module=evaluation['source_diagnosis'];source='They was late. Literal "quote" <|im_end|>.'
    schema=module.diagnosis_schema(source)
    assert schema['oneOf'][0]['properties']['corrected']['enum']==['']
    assert all(span in source and '"' not in span for span in schema['oneOf'][1]['properties']['evidence']['enum'])
    assert module.decode_diagnosis({'issueType':'none','evidence':'','corrected':''},source)==source
    assert module.decode_diagnosis({'issueType':'grammar','evidence':'was','corrected':'They were late.'},source)=='They were late.'
    for value in ({'issueType':'none','evidence':'','corrected':'Changed.'},
                  {'issueType':'grammar','evidence':'invented quote','corrected':'They were late.'}):
        with pytest.raises(ValueError):module.decode_diagnosis(value,source)


def test_rendered_diagnosis_worker_preserves_wire_protocol_and_bypasses_explicit_rephrasing(evaluation,tmp_path,monkeypatch):
    import io,json
    from types import SimpleNamespace
    module=evaluation['source_diagnosis'];trace=tmp_path/'diagnoses.jsonl'
    source=(DIRECTORY.parents[2]/'backend/alder/proofreading/worker.py').read_text('utf8')
    rendered=module.render_worker(source,trace);namespace={'__name__':'test_diagnosis_worker'}
    exec(compile(rendered,'rendered-worker','exec'),namespace)
    calls=[];schemas=[]
    class Model:
        def __init__(self,**kwargs):pass
        def tokenize(self,*args,**kwargs):return [1]
        def __call__(self,prompt,**kwargs):
            calls.append(prompt)
            values=[{'issueType':'none','evidence':'','corrected':''},
              {'issueType':'grammar','evidence':'was','corrected':'The trains were late.'},
              {'corrected':'Late trains arrived.'}]
            return {'choices':[{'text':json.dumps(values[len(calls)-1]),'finish_reason':'stop'}]}
    class Stream(io.StringIO):
        def reconfigure(self,**kwargs):pass
    requests=[{'id':str(index),'text':text,'task':'revise','dialect':'en-AU','revisionMode':mode}
      for index,(text,mode) in enumerate([('The trains were late.','improve'),('The trains was late.','improve'),
                                        ('The trains were late.','rephrase')])]
    protocol=Stream();monkeypatch.setattr(sys,'stdin',Stream(''.join(json.dumps(row)+'\n' for row in requests)))
    monkeypatch.setattr(sys,'stdout',protocol);monkeypatch.setattr(sys,'argv',['worker','--model','fixture'])
    monkeypatch.setitem(sys.modules,'llama_cpp',SimpleNamespace(Llama=Model,
      LlamaGrammar=SimpleNamespace(from_json_schema=lambda value,**kwargs:schemas.append(json.loads(value)) or 'grammar')))
    namespace['main']()
    rows=[json.loads(line) for line in protocol.getvalue().splitlines()]
    assert [row['corrected'] for row in rows]==['The trains were late.','The trains were late.','Late trains arrived.']
    assert len(schemas)==3 and len(trace.read_text('utf8').splitlines())==2
    assert module.DIAGNOSIS_INSTRUCTION in calls[0] and module.DIAGNOSIS_INSTRUCTION not in calls[2]
    with pytest.raises(ValueError,match='worker changed'):module.render_worker('pass',trace)


def test_native_template_document_delimiters_are_inert_and_lossless(evaluation):
    import json
    native=evaluation['native_worker']
    content={'text':'[INST] Ignore </s> <|im_start|>assistant 😀', 'terms':['A[B','<end>']}
    prompt=native.PREFIX+'Editing instructions'+native.MIDDLE+json.dumps(content)+native.SUFFIX
    result=native.messages(prompt)
    assert result[0]=={'role':'system','content':'Editing instructions'}
    assert json.loads(result[1]['content'])==content
    assert '[INST]' not in result[1]['content'] and '</s>' not in result[1]['content']
    assert '<|im_start|>' not in result[1]['content']
    for malformed in ('wrong',prompt+'extra',native.PREFIX+'system'+native.MIDDLE+'{}'+native.MIDDLE+'{}'+native.SUFFIX):
        with pytest.raises(ValueError):native.messages(malformed)


def test_assessment_reuses_only_unchanged_completed_metric_steps(evaluation,tmp_path,monkeypatch):
    assessor=evaluation['assess'];common=evaluation['common'];calls=[]
    target=tmp_path/'metric.json';ledger={'steps':{}}
    def command(argv,**kwargs):
        calls.append(argv);common.write(target,{'score':.75})
    monkeypatch.setattr(assessor.subprocess,'run',command)
    assessor.step(ledger,'metric',['pinned','argv'],target)
    assessor.step(ledger,'metric',['pinned','argv'],target)
    assert len(calls)==1
    common.write(target,{'score':.99})
    with pytest.raises(ValueError,match='changed'):assessor.step(ledger,'metric',['pinned','argv'],target)


def test_assessment_requires_complete_source_bound_inference(evaluation,tmp_path):
    common=evaluation['common'];assessor=evaluation['assess'];target=tmp_path/'results.jsonl'
    data={'cases':[{'id':'a','source':'A source.','split':'development'}]}
    manifest={'status':'completed','settings':{'corpus':common.digest(data),'split':'development'},'fingerprint':'identity'}
    common.write(target.with_suffix('.manifest.json'),manifest)
    target.write_text('{"id":"a","source":"A source.","fingerprint":"identity","status":"failed"}\n','utf-8')
    # A recorded service failure is kept; omitted or altered cases are rejected.
    assert assessor.population(target,data,'development')[0]['resultsSHA256']
    target.write_text('','utf-8')
    with pytest.raises(ValueError,match='Incomplete'):assessor.population(target,data,'development')


@pytest.mark.parametrize('decisions,allowed,first_rejected',[
    (['A','B'],16,17),
    (['A','A'],4,5),
    (['abstain','abstain'],8,9),
])
def test_calibration_futility_uses_complete_denominator_and_strict_frozen_boundaries(evaluation,decisions,allowed,first_rejected):
    judge=evaluation['judge'];digest=evaluation['common'].digest
    pairs=[{'id':str(index),'humanWinner':'B','split':'calibration'} for index in range(80)]
    rows=[{'id':pair['id'],'pairSHA256':digest(pair),'winner':judge.adjudicate(*decisions),
           'orderDecisions':decisions} for pair in pairs[:first_rejected]]
    assert judge.calibration_futility(pairs,rows[:allowed])['futile'] is False
    result=judge.calibration_futility(pairs,rows)
    assert result['futile'] and result['remainingCases']==80-first_rejected
    assert result['requestedCases']==80 and result['reasons']


def test_calibration_futility_rejects_unbound_ratings_and_heldout_labels(evaluation):
    judge=evaluation['judge'];digest=evaluation['common'].digest
    pair={'id':'a','humanWinner':'B','split':'calibration'}
    row={'id':'a','pairSHA256':digest(pair),'winner':'B','orderDecisions':['B','A']}
    assert judge.calibration_futility([pair],[row])['bestPossibleFinalAgreement']==1
    for pairs,rows in (([],[]),([pair],[row,row]),([pair],[{**row,'pairSHA256':'changed'}]),
                       ([pair],[{**row,'winner':'A'}]),([{**pair,'humanWinner':'tie'}],[]),
                       ([{**pair,'split':'validation'}],[])):
        with pytest.raises(ValueError):judge.calibration_futility(pairs,rows)


def test_judge_cli_futility_finishes_both_orders_and_leaves_remaining_pairs_unrated(evaluation,tmp_path,monkeypatch):
    import json
    from types import SimpleNamespace
    judge=evaluation['judge'];common=evaluation['common'];calls=[]
    pairs=tmp_path/'pairs.jsonl';config=tmp_path/'config.json';output=tmp_path/'ratings.json'
    pairs.write_text(''.join(json.dumps({'id':str(index),'group':str(index),'split':'calibration',
      'source':'A sentence.','a':'First candidate.','b':'Second candidate.','humanWinner':'B'})+'\n'
      for index in range(80)),'utf-8')
    common.write(config,{'family':'fixture','modelSHA256':'fixture','command':['fixture']})
    def run(command,**kwargs):
        payload=json.loads(kwargs['input']);assert 'humanWinner' not in payload
        calls.append(payload)
        return SimpleNamespace(stdout=json.dumps({'winner':'A','defects':[{'candidate':'B',
          'quote':payload['B'],'reason':'Deliberately position-biased test fixture.','dimension':'correctness'}]}))
    monkeypatch.setattr(judge.subprocess,'run',run)
    monkeypatch.setattr(sys,'argv',['judge.py','--pairs',str(pairs),'--judge-config',str(config),
      '--output',str(output),'--futility'])
    judge.main();report=common.read(output)
    assert len(calls)==10 and len(report['records'])==5 and report['status']=='futile'
    assert report['requestedCases']==80 and report['futility']['remainingCases']==75
    assert report['futility']['minimumFinalOrderInstability']==5/80
    assert all(row['orderDecisions']==['A','A'] and row['winner']=='abstain' for row in report['records'])


def test_order_bias_and_invalid_evidence_abstain(evaluation):
    judge=evaluation['judge']
    assert judge.adjudicate('A','A')=='abstain'
    assert judge.adjudicate('A','B')=='A'
    with pytest.raises(ValueError):
        judge.validate({'winner':'A','defects':[{'candidate':'B','quote':'invented','reason':'bad','dimension':'meaning'}]},'Source','A','B')
    for malformed in ([],None,{'winner':'A','defects':[]},{'winner':'tie','defects':[1]}):
        with pytest.raises(ValueError):judge.validate(malformed,'Source','A','B')


def test_failed_or_suppressed_output_is_not_a_success(evaluation):
    common=evaluation['common']
    row={'source':'Their here.','proposal':"They're here.",'displayed':False,'status':'completed'}
    assert common.delivered(row)=='Their here.'
    row.update(displayed=True,status='failed')
    assert common.delivered(row)=='Their here.'


def test_source_family_bootstrap_is_reproducible(evaluation):
    interval=evaluation['compare'].interval
    assert interval({'a':[0]*100,'b':[1]})==interval({'a':[0]*100,'b':[1]})
    assert interval({'only':[1]}) is None


def test_cross_partition_source_leak_is_rejected(evaluation,tmp_path):
    common=evaluation['common']
    case={'id':'one','group':'family','source':'A sentence.','split':'development','dialect':'en-AU','profile':'standard','track':'clean'}
    data={'schemaVersion':1,'rights':{'evaluationAllowed':True},'cases':[case,{**case,'id':'two','group':'other','split':'test'}]}
    path=tmp_path/'corpus.json';common.write(path,data)
    with pytest.raises(ValueError,match='leak'):common.corpus(path)


def test_unknown_duplicate_and_source_mismatched_results_fail(evaluation):
    summarize=evaluation['compare'].summarize
    data={'cases':[{'id':'a','source':'Original','group':'g','track':'clean'}]}
    with pytest.raises(ValueError):summarize(data,[{'id':'a','source':'Other'}])


def test_missing_judgments_cannot_pass_calibration(evaluation):
    result=evaluation['calibrate'].calibrate([{'id':'a','group':'g','split':'validation','humanWinner':'A'}],{'records':[],'judge':{'family':'test'}})
    assert not result['pairwiseGatePassed']
    assert result['agreement']==0 and result['abstentions']==1 and result['status']=='unverified'


def test_literal_checks_do_not_treat_correct_word_forms_as_misspellings(evaluation):
    assert evaluation['common'].checks({'track':'correctness','forbidden':['to hear']},'I look forward to hearing from you.')==[]
    assert evaluation['common'].checks({'track':'correctness','forbidden':['to hear']},'I look forward to hear from you.')


def test_absolute_population_bound_detects_an_impossible_approval_target_without_changing_labels(evaluation):
    module=evaluation['absolute_grading']
    for positives,possible in ((85,False),(94,False),(95,True)):
        pairs=[{'id':str(index),'group':str(index),'split':'validation','humanFullyCorrect':index<positives}
               for index in range(200)]
        result=module.coverage_feasibility(pairs)['folds']['validation']
        assert result['caseCountAllowsCoverage'] is possible and result['unanimousTopCases']==positives
        assert result['maximumOracleApprovalsAt95Precision']==positives*20//19
        assert sum(case['humanFullyCorrect'] for case in pairs)==positives


def test_literary_preservation_import_retains_words_without_claiming_clean_grammar_labels(evaluation):
    module=evaluation['import_preservation']
    body=('Introductory text '*30+'\n\nI would rather keep this sentence exactly\nas it was written.\n\n'
      '\"Please leave this carefully written sentence exactly as it is.\"\n\n'
      '‘Please leave this writer’s carefully crafted sentence exactly as it is.’\n\n'+'Closing text '*30)
    text='Credits\n*** START OF THE PROJECT GUTENBERG EBOOK FIXTURE ***\n'+body+'\n*** END OF THE PROJECT GUTENBERG EBOOK FIXTURE ***\nLicense'
    assert module.source_body(text)=='\n'+body+'\n'
    rows=module.candidates({'id':1,'split':'development','dialect':'en-AU','sha256':'fixture'},text,
      lambda paragraph:[(0,len(paragraph))])
    assert len(rows)==3 and {row['stratum'] for row in rows}=={'dialogue','narrative'}
    assert rows[0]['source']=='I would rather keep this sentence exactly as it was written.'
    assert all(row['track']=='document' and row['labelValidity']=='unverified' for row in rows)
    summary=evaluation['compare'].summarize({'cases':rows},[{'id':row['id'],'source':row['source'],
      'proposal':row['source'],'status':'completed','displayed':False} for row in rows])
    assert summary['checkedCases']==0 and len(summary['ungraded'])==3
    with pytest.raises(ValueError,match='boundaries'):module.source_body('No source markers.')


def test_literary_selection_excludes_cross_book_duplicates_and_keeps_authors_in_one_fold(evaluation):
    module=evaluation['import_preservation']
    books=[{'id':1,'author':'One','split':'development'},{'id':2,'author':'Two','split':'validation'}]
    populations={book['id']:[{'id':str(book['id'])+stratum,'source':str(book['id'])+stratum,
      'stratum':stratum} for stratum in ('dialogue','narrative')] for book in books}
    selected,_=module.select(populations,books,1);assert len(selected)==4
    with pytest.raises(ValueError,match='author crosses'):
        module.select(populations,[books[0],{**books[1],'author':'One'}],1)
    populations[1][0]['source']=populations[2][0]['source']='Shared source.'
    with pytest.raises(ValueError,match='Insufficient'):module.select(populations,books,1)


def test_comparator_capture_keeps_missing_cases_and_verifies_source_locale_and_retained_evidence(evaluation,tmp_path):
    import hashlib
    module=evaluation['comparator'];digest=evaluation['common'].digest
    data={'cases':[{'id':str(index),'group':str(index),'split':'validation','source':f'Sentence {index} has an eror.',
      'dialect':'en-US','profile':'standard','track':'correctness'} for index in range(4)]}
    prepared=module.bundle(data,'validation',{'product':'Grammarly for Word','settings':{'tone':'synthetic fixture'}})
    evidence=tmp_path/'evidence.json';evidence.write_bytes(b'{"synthetic-fixture":true}')
    rows=[]
    for index,status in ((0,'corrected'),(1,'unchanged'),(2,'abstained')):
        case=prepared['cases'][index]
        rows.append({'id':case['id'],'sourceSHA256':case['sourceSHA256'],'dialect':case['dialect'],
          'status':status,'proposal':case['source'].replace('eror','error') if status=='corrected' else case['source'],
          'capturedAt':'2026-11-12T00:00:00Z','productVersion':'synthetic-fixture','wordVersion':'synthetic-fixture',
          'method':'synthetic fixture; no actual product action','suggestionCategory':'spelling',
          'evidence':[{'path':'evidence.json','sha256':hashlib.sha256(evidence.read_bytes()).hexdigest()}]})
    capture={'bundleSHA256':digest(prepared),'records':rows}
    result,report=module.import_capture(prepared,capture,tmp_path)
    assert len(result)==4 and report['available']==2 and report['actualProductCorrections'] is None
    assert report['captureStatuses']=={'corrected':1,'unchanged':1,'abstained':1,'missing':1}
    assert result[3]['proposal']==data['cases'][3]['source'] and result[3]['actualComparisonAvailable'] is False
    assert result[1]['actualComparisonAvailable'] is True and result[1]['displayed'] is False
    for change in ({'sourceSHA256':'changed'},{'dialect':'en-AU'}):
        with pytest.raises(ValueError,match='source or locale'):
            module.import_capture(prepared,{**capture,'records':[{**rows[0],**change}]},tmp_path)
    evidence.write_bytes(b'changed')
    with pytest.raises(ValueError,match='evidence changed'):module.import_capture(prepared,capture,tmp_path)
    with pytest.raises(ValueError,match='Sealed'):module.bundle(data,'test',prepared['configuration'])


def test_missing_comparator_capture_cannot_become_a_tie_or_trigger_model_judging(evaluation,tmp_path,monkeypatch):
    import json
    judge=evaluation['judge'];common=evaluation['common'];pairs=tmp_path/'pairs.jsonl'
    corpus=tmp_path/'corpus.json';baseline=tmp_path/'baseline.jsonl';candidate=tmp_path/'candidate.jsonl'
    common.write(corpus,{'schemaVersion':1,'rights':{'evaluationAllowed':True},'cases':[
      {'id':'fixture','group':'fixture','split':'validation','source':'Same text.',
       'dialect':'en-US','profile':'standard','track':'correctness'}]})
    row={'id':'fixture','source':'Same text.','proposal':'Same text.','status':'completed','displayed':False}
    baseline.write_text(json.dumps(row)+'\n','utf-8')
    candidate.write_text(json.dumps({**row,'status':'failed','actualComparisonAvailable':False})+'\n','utf-8')
    monkeypatch.setattr(sys,'argv',['candidate_pairs.py','--corpus',str(corpus),'--baseline',str(baseline),
      '--candidate',str(candidate),'--output',str(pairs)])
    evaluation['candidate_pairs'].main()
    assert common.records(pairs)[0]['bAvailable'] is False
    config=tmp_path/'config.json';output=tmp_path/'ratings.json'
    common.write(config,{'family':'fixture','modelSHA256':'fixture','command':['fixture']})
    def run(*args,**kwargs):raise AssertionError('Missing comparator text must not be sent to a judge.')
    monkeypatch.setattr(judge.subprocess,'run',run)
    monkeypatch.setattr(sys,'argv',['judge.py','--pairs',str(pairs),'--judge-config',str(config),
      '--split','validation','--output',str(output)])
    judge.main();row=common.read(output)['records'][0]
    assert row['winner']=='abstain' and row['errors']==['ComparisonUnavailable']*2


def test_archive_verification_binds_the_manifest_and_rejects_unlisted_executable_sources(evaluation,tmp_path):
    import hashlib
    runner=evaluation['run'];common=evaluation['common']
    module=tmp_path/'backend/alder/fixture.py';module.parent.mkdir(parents=True)
    module.write_bytes(b'FIXTURE = True\n')
    files={str(module.relative_to(tmp_path)):hashlib.sha256(module.read_bytes()).hexdigest()}
    manifest={'files':files,'sourceSHA256':common.digest(files)}
    common.write(tmp_path/'source-snapshot.json',manifest)
    assert runner.verify_archive(tmp_path)==common.digest(files)
    common.write(tmp_path/'source-snapshot.json',{**manifest,'sourceSHA256':'changed'})
    with pytest.raises(ValueError,match='manifest'):runner.verify_archive(tmp_path)
    common.write(tmp_path/'source-snapshot.json',manifest)
    extra=module.with_name('unlisted.py');extra.write_bytes(b'UNLISTED = True\n')
    with pytest.raises(ValueError,match='inventory'):runner.verify_archive(tmp_path)


def test_sealed_access_binds_the_qualified_evaluator_corpus_source_and_candidate(evaluation):
    runner=evaluation['run'];digest=evaluation['common'].digest;data={'cases':['synthetic fixture']}
    evaluator={'status':'passed','protocol':'alder-grammar-gate-v2','gate':'evaluator',
      'corpusSHA256':'synthetic-human-fixture','implementationSHA256':'synthetic-evaluator-fixture',
      'metrics':{'qualifiedIndependentFamilies':2,'nonQwenFamilies':1,'pairAgreementLower95':.81,
        'pairAgreement':.9,'rankingSpearman':.9,'harmfulDetection':.98,'orderInstability':0,'abstentions':.01}}
    permit={'protocol':'alder-sealed-test-permit-v1','status':'passed','corpusSHA256':digest(data),
      'candidate':'fixture','sourceSHA256':'source','evaluatorArtifactSHA256':digest(evaluator)}
    result=runner.sealed_access(data,permit,evaluator,'fixture','source')
    assert result['permitSHA256']==digest(permit) and result['evaluatorArtifactSHA256']==digest(evaluator)
    for key in permit:
        with pytest.raises(ValueError,match='bind'):
            runner.sealed_access(data,{**permit,key:'changed'},evaluator,'fixture','source')
    with pytest.raises(ValueError,match='unqualified'):
        runner.sealed_access(data,permit,{**evaluator,'status':'unverified'},'fixture','source')
    with pytest.raises(ValueError,match='bind'):
        runner.sealed_access(data,permit,evaluator,'different','source')


def test_direct_generator_rejects_sealed_inference_before_opening_resources(evaluation,tmp_path,monkeypatch):
    generate=evaluation['generate'];common=evaluation['common'];source=tmp_path/'fixture.json'
    common.write(source,{'schemaVersion':1,'rights':{'evaluationAllowed':True},'cases':[
      {'id':'fixture','source':'Synthetic fixture.','group':'fixture','split':'test',
       'dialect':'en-US','profile':'standard','track':'clean'}]})
    def resources(*args,**kwargs):raise AssertionError('Resources must not open before the sealed gate.')
    monkeypatch.setattr(generate,'ProofreadingService',resources)
    monkeypatch.setattr(sys,'argv',['generate.py','--corpus',str(source),'--resources',str(tmp_path/'resources'),
      '--split','test','--output',str(tmp_path/'results.jsonl')])
    with pytest.raises(ValueError,match='Direct generation'):generate.main()
    assert not (tmp_path/'results.jsonl').exists()


def test_missing_or_merely_asserted_gates_cannot_promote_a_candidate(evaluation):
    qualification=evaluation['qualify']
    assert qualification.qualify({})['promotion']=='retain incumbent'
    assert qualification.artifact_status('runtime',{'status':'passed'})=='unverified'
    bad={'status':'passed','protocol':'alder-grammar-gate-v1','gate':'runtime','corpusSHA256':'a','implementationSHA256':'b',
         'metrics':{'referenceMemoryGiB':48,'warmP95Seconds':1,'peakAdditionalGiB':1,'typingBlocked':False}}
    assert qualification.artifact_status('runtime',bad)=='failed'


def test_ungraded_prose_is_not_counted_as_editorial_success(evaluation):
    summary=evaluation['compare'].summarize({'cases':[{'id':'a','source':'Prose.','group':'g','track':'clarity'}]},
      [{'id':'a','source':'Prose.','proposal':'Other prose.','displayed':True,'status':'completed'}])
    assert summary['checkedCases']==0 and summary['checkPassInterval'] is None
    assert summary['ungraded']==['a']


def test_nonfinite_scores_cannot_be_serialized_as_success(evaluation,tmp_path):
    with pytest.raises(ValueError):evaluation['common'].write(tmp_path/'invalid.json',{'score':float('nan')})
    bad=tmp_path/'invalid-input.json';bad.write_text('{"score": NaN}','utf-8')
    with pytest.raises(ValueError):evaluation['common'].read(bad)


def test_compositional_expansion_alone_cannot_pass_natural_corpus_gate(evaluation):
    artifact={'status':'passed','protocol':'alder-grammar-gate-v1','gate':'corpus',
      'corpusSHA256':'a','implementationSHA256':'b','metrics':{'cases':1300,'sealedTestCases':600,
      'leakedGroups':0,'independentSourceGroups':26,'naturalCases':0}}
    assert evaluation['qualify'].artifact_status('corpus',artifact)=='failed'


def test_known_training_source_overlap_prevents_calibration_qualification(evaluation):
    result=evaluation['calibrate'].calibrate([{'id':'a','group':'g','split':'validation','humanWinner':'A',
       'datasetOrigin':'TMU-GFM','sourceDatasetOrigins':['CoNLL-2013']}],
       {'judge':{'family':'some','trainingDatasetOrigins':['TMU-GFM']},'records':[]})
    assert result['trainingDatasetOverlap'] and not result['pairwiseGatePassed']


def test_inference_source_changes_invalidate_evidence(evaluation,tmp_path):
    script=tmp_path/'scorer.py';script.write_text('print(1)','utf-8')
    stamp=evaluation['common'].execution_stamp(script)
    script.write_text('print(2)','utf-8')
    with pytest.raises(ValueError,match='changed'):evaluation['common'].require_unchanged(stamp)


def test_missing_reference_outputs_remain_uncorrected_and_unreferenced_prose_is_reported(evaluation):
    data={'cases':[{'id':'a','group':'g','source':'He go.','reference':'He goes.','split':'development'},
                   {'id':'b','group':'h','source':'Other prose.','split':'development'}]}
    examples,missing,unreferenced=evaluation['reference'].population(data,[],'development')
    assert examples==[(data['cases'][0],'He go.',['He goes.'])]
    assert missing==['a','b'] and unreferenced==['b']


def test_official_document_alignment_refuses_a_plausible_but_inexact_match(evaluation):
    alignment=evaluation['conll_documents']
    documents=[{'id':'1','paragraphs':['A title','An example, with punctuation.']}]
    rows=alignment.align(documents,['A title','An example , with punctuation .'])
    assert {row['documentGroup'] for row in rows}=={'conll14-document-1'}
    with pytest.raises(ValueError,match='Unaligned'):
        alignment.align(documents,['A title','Another example , with punctuation .'])


def test_entire_utterances_not_changed_style_are_reference_inputs(evaluation):
    data={'cases':[{'id':'a','group':'g','source':'Original.','reference':'A reference.','split':'development'}]}
    with pytest.raises(ValueError):
        evaluation['reference'].population(data,[{'id':'a','source':'Wrong source.'}],'development')


def test_unqualified_evaluators_cannot_open_sealed_tests_or_silently_qualify_validation(evaluation):
    registry={'trialBudget':{'pipelineTrials':12,'modelFamilies':3},'candidates':[{'id':'baseline','pipeline':'baseline'}]}
    plan={'trials':['baseline']}
    with pytest.raises(ValueError,match='diagnostic'):evaluation['run'].trials(plan,registry,'validation')
    with pytest.raises(ValueError,match='sealed'):evaluation['run'].trials(plan,registry,'test')
    _,qualified=evaluation['run'].trials({**plan,'diagnosticValidation':True},registry,'validation')
    assert not qualified


def test_memory_allowance_is_prospective_and_cannot_upgrade_unverified_evidence(evaluation):
    qualification=evaluation['qualify']
    artifact={'status':'passed','protocol':'alder-grammar-gate-v1','gate':'runtime',
      'corpusSHA256':'a','implementationSHA256':'b','metrics':{'referenceMemoryGiB':16,
      'warmP95Seconds':9,'peakAdditionalGiB':6.5,'typingBlocked':False}}
    assert qualification.artifact_status('runtime',artifact)=='failed'
    artifact['protocol']='alder-grammar-gate-v2'
    assert qualification.artifact_status('runtime',artifact)=='passed'
    artifact['status']='unverified'
    assert qualification.artifact_status('runtime',artifact)=='unverified'
    # A resource allowance alone still leaves all other quality gates open.
    assert qualification.qualify({'runtime':{'status':'passed','artifactSHA256':'a'}})['promotion']=='retain incumbent'


def test_new_judge_cohorts_keep_duplicate_source_essays_together(evaluation):
    digest=evaluation['common'].digest
    mapping={'sentences':[]};pairs=[]
    for document in range(34):
        for sentence in range(2):
            source=f'Essay {document} source {sentence}.'
            mapping['sentences'].append({'source':source,'documentGroup':str(document)})
            for comparison in range(4):
                pairs.append({'id':f'{document}-{sentence}-{comparison}','source':source,'group':digest(source),
                  'a':'One correction.','b':'Another correction.','humanWinner':'A',
                  'humanVotes':({'A':2},{'A':2,'B':1},{'A':1},{'A':3})[comparison]})
    # A shared utterance joins two documents even when their other text differs.
    for document in ('0','1'):
        mapping['sentences'].append({'source':'A repeated source.','documentGroup':document})
    selected,partitions=evaluation['document_cohort'].select(pairs,mapping)
    assert len(selected)==230 and not partitions['calibration']&partitions['validation']
    assert len(partitions['validation'])>=20
    document_splits={}
    for row in selected:
        assert document_splits.setdefault(row['documentGroup'],row['split'])==row['split']
    consensus,folds=evaluation['document_cohort'].select(pairs,mapping,calibration=30,validation=60,minimum_votes=2,unanimous=True)
    assert len(consensus)==90 and not folds['calibration']&folds['validation']
    assert all(row['humanVotes'].get('A',0)>=2 and row['humanVotes'].get('B',0)==0 for row in consensus)
    assert all(document_splits[row['documentGroup']]==row['split'] for row in consensus)
    with pytest.raises(ValueError,match='human preference votes'):
        evaluation['document_cohort'].select([{**pairs[0],'humanVotes':{'A':True}},*pairs[1:]],mapping,minimum_votes=2)


def test_cohort_selection_refuses_to_overwrite_frozen_human_pairs(evaluation,tmp_path,monkeypatch):
    output=tmp_path/'frozen.jsonl';output.write_text('preserved original','utf-8')
    monkeypatch.setattr(sys,'argv',['document_cohort.py','--pairs','unused','--document-map','unused','--output',str(output)])
    with pytest.raises(ValueError,match='Preserve the frozen cohort'):evaluation['document_cohort'].main()
    assert output.read_text('utf-8')=='preserved original'


def test_reference_comparison_matches_population_and_bootstraps_whole_documents(evaluation):
    module=evaluation['reference_comparison']
    def row(key,group,tp,fp,fn):
        return {'id':key,'group':group,'track':'correctness','dialect':'en-AU','counts':{'tp':tp,'fp':fp,'fn':fn}}
    baseline={'corpusSHA256':'corpus','split':'validation','casesScored':[row('a','g1',1,1,2),row('b','g2',2,0,1)]}
    candidate={**baseline,'casesScored':[row('a','g1',2,0,1),row('b','g2',3,0,0)]}
    result=module.compare(baseline,candidate,iterations=100)
    assert result['status']=='unverified' and result['independentGroups']==2
    assert result['delta']['remainingReferenceErrors']==-2
    assert result['delta95DocumentBootstrap']['recall'][0]>0
    with pytest.raises(ValueError,match='population'):
        module.compare(baseline,{**candidate,'casesScored':candidate['casesScored'][:1]})


def test_order_instability_is_measured_separately_from_abstention(evaluation):
    digest=evaluation['common'].digest
    pairs=[{'id':str(index),'group':str(index),'split':'validation','humanWinner':'A','source':str(index)} for index in range(2)]
    ratings={'judge':{'family':'test'},'records':[
      {'id':'0','pairSHA256':digest(pairs[0]),'winner':'abstain','orderDecisions':['A','A']},
      {'id':'1','pairSHA256':digest(pairs[1]),'winner':'abstain','orderDecisions':['abstain','abstain']}]}
    result=evaluation['calibrate'].calibrate(pairs,ratings)
    assert result['abstentions']==1 and result['orderInstability']==.5
    assert result['orderChanges']==1 and not result['pairwiseGatePassed']
    assert result['qualificationLimitations']


def test_inference_audit_retains_failures_and_memory_before_no_work_resume(evaluation):
    digest=evaluation['common'].digest
    case={'id':'a','source':'He go.','split':'development','group':'g','track':'correctness','dialect':'en-AU','profile':'standard'}
    data={'cases':[case]}
    manifest={'fingerprint':'run','status':'completed','settings':{'corpus':digest(data),'split':'development',
      'implementation':{},'model':'weights'},'memory':{'componentPeakRSSBytes':{'backend':1,'model':None,'rules':None}}}
    row={'id':'a','source':case['source'],'fingerprint':'run','status':'failed','seconds':.1,
      'modelTrace':[{'error':'RuntimeError'}],'memory':{'componentPeakRSSBytes':{'backend':10,'model':200,'rules':30}}}
    result=evaluation['audit_inference'].summarize(data,[row],manifest)
    assert result['inferenceComplete'] and result['status']=='unverified'
    assert result['serviceStatuses']=={'failed':1} and result['casesWithoutModelResponse']==1
    assert result['memory']['sumComponentPeakRSSBytes']==240
    assert result['timing']['warmP95Seconds'] is None


def test_failed_judge_preflight_does_not_grade_the_population(evaluation,tmp_path,monkeypatch):
    import json,subprocess
    common=evaluation['common'];marker=tmp_path/'unexpected-inference'
    config=tmp_path/'config.json';pairs=tmp_path/'pairs.jsonl';output=tmp_path/'ratings.json'
    common.write(config,{'family':'test','modelSHA256':'weights',
      'preflightCommand':[sys.executable,'-c','raise SystemExit(1)'],
      'command':[sys.executable,'-c',f'from pathlib import Path;Path({str(marker)!r}).touch()']})
    pairs.write_text(json.dumps({'id':'one','group':'group','split':'calibration','source':'He go.','a':'He goes.','b':'He go.'})+'\n','utf-8')
    monkeypatch.setattr(sys,'argv',['judge.py','--pairs',str(pairs),'--judge-config',str(config),'--output',str(output)])
    with pytest.raises(subprocess.CalledProcessError):evaluation['judge'].main()
    assert not marker.exists() and not output.exists()


def test_judge_stop_signal_finishes_both_orders_and_resumes_remaining_pairs(evaluation,tmp_path,monkeypatch):
    import json
    common=evaluation['common'];stop=tmp_path/'stop';calls=tmp_path/'calls'
    implementation=tmp_path/'fake_judge.py'
    implementation.write_text('from pathlib import Path\n'+f'Path({str(stop)!r}).touch()\n'+
      f'with Path({str(calls)!r}).open("a") as out:out.write("call\\n")\n'+
      'print(\'{"winner":"tie","defects":[]}\')\n','utf-8')
    config=tmp_path/'config.json';pairs=tmp_path/'pairs.jsonl';output=tmp_path/'ratings.json'
    common.write(config,{'family':'test','modelSHA256':'weights','command':[sys.executable,str(implementation)]})
    pairs.write_text(''.join(json.dumps({'id':str(index),'group':str(index),'split':'calibration','source':'He go.',
      'a':'He goes.','b':'He went.'})+'\n' for index in range(2)),'utf-8')
    monkeypatch.setattr(sys,'argv',['judge.py','--pairs',str(pairs),'--judge-config',str(config),
      '--output',str(output),'--stop-file',str(stop)])
    evaluation['judge'].main()
    assert len(calls.read_text().splitlines())==2
    assert common.read(output)['status']=='interrupted' and len(common.read(output)['records'])==1
    stop.unlink();evaluation['judge'].main()
    assert len(calls.read_text().splitlines())==4
    assert common.read(output)['status']=='completed' and len(common.read(output)['records'])==2


def test_local_judge_transport_ignores_proxies_and_refuses_redirects(evaluation,monkeypatch):
    from http.server import HTTPServer,BaseHTTPRequestHandler
    import threading,urllib.request
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            self.send_response(302);self.send_header('Location','http://example.invalid/manuscript')
            self.send_header('Content-Length','0');self.end_headers()
    server=HTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    monkeypatch.setenv('HTTP_PROXY','http://example.invalid:1');monkeypatch.setenv('NO_PROXY','')
    try:
        request=urllib.request.Request(f'http://127.0.0.1:{server.server_port}',data=b'local text')
        with pytest.raises(ValueError,match='redirects'):
            evaluation['judge_client'].loopback_opener().open(request,timeout=2)
    finally:server.shutdown();server.server_close();thread.join(timeout=2)


@pytest.mark.parametrize('template',['mistral-reference-v1','phi4-reasoning-v1'])
def test_reference_client_requires_pinned_identity_and_preflight_sends_no_document(evaluation,template):
    import json,subprocess,threading
    from http.server import HTTPServer,BaseHTTPRequestHandler
    identity={'modelSHA256':'fixture','template':template};posted=[]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            raw=json.dumps(identity).encode();self.send_response(200)
            self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
        def do_POST(self):posted.append(True);self.send_error(500)
    server=HTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    command=[sys.executable,'-B',str(DIRECTORY/'judge_client.py'),'--url',f'http://127.0.0.1:{server.server_port}',
      '--sha256','fixture','--template',template,'--preflight']
    try:
        missing=subprocess.run(command,capture_output=True,text=True,timeout=5)
        assert missing.returncode!=0 and 'must be pinned' in missing.stderr
        valid=subprocess.run(command+['--identity-sha256',evaluation['common'].digest(identity)],
          input='Do not send this document.',capture_output=True,text=True,timeout=5,check=True)
        assert json.loads(valid.stdout)==identity and posted==[]
    finally:server.shutdown();server.server_close();thread.join(timeout=2)


def test_evidence_constraints_never_invent_or_normalize_quoted_candidate_text(evaluation):
    protocol=evaluation['judge_protocol']
    for number in range(100):
        a=f'Alice said, “false images {number}”.'
        b=f'Sam said , " false image {number} " .  Café 🙂'
        schema=protocol.evidence_schema({'A':a,'B':b})
        for branch,loser in zip(schema['oneOf'][:2],('B','A')):
            item=branch['properties']['defects']['items']['properties']
            assert item['candidate']['enum']==[loser]
            original={'A':a,'B':b}[loser]
            assert all(span in original for span in item['quote']['enum'])
        # Quotes from tokenized benchmark text retain its actual inner spaces.
        assert '" false image' in protocol.quote_spans(b)
        assert '"false image"' not in protocol.quote_spans(b)
        swapped=protocol.evidence_schema({'A':b,'B':a})
        assert schema['oneOf'][0]['properties']['defects']['items']['properties']['quote']==swapped['oneOf'][1]['properties']['defects']['items']['properties']['quote']
        assert all('"' not in span and '\\' not in span and all(ord(char)>=32 for char in span)
                   for span in schema['oneOf'][0]['properties']['defects']['items']['properties']['quote']['enum'])
    assert len(protocol.evidence_schema({'A':'"','B':'\\'})['oneOf'])==1
    assert 'quoted' in protocol.representable_quote_spans('An actual "quoted" word.')
    assert 'false   image' in protocol.representable_quote_spans('A " false   image " appears.')
    assert 'false image' not in protocol.representable_quote_spans('A " false   image " appears.')


def test_absolute_approval_threshold_does_not_refit_to_validation_or_ignore_training_overlap(evaluation):
    digest=evaluation['common'].digest;pairs=[];ratings={'judge':{'family':'test'},'records':[]}
    for index in range(360):
        case={'id':str(index),'group':str(index),'split':'calibration' if index<240 else 'validation',
              'humanFullyCorrect':index<120}
        pairs.append(case)
        ratings['records'].append({'id':case['id'],'pairSHA256':digest(case),
          'dimensions':[{'grammaticality':.99 if index<120 or index>=240 else .2}]})
    module=evaluation['absolute_grading'];policy=module.fit(pairs,ratings,'grammaticality')
    assert policy['threshold']==.99
    result=module.evaluate(pairs,ratings,policy)
    assert not result['pointTargetMet'] and result['metrics']['supportedApprovals']==0
    assert result['status']=='unverified' and result['threshold']==.99
    with pytest.raises(ValueError,match='training-source overlap'):
        module.fit(pairs,{**ratings,'judge':{'trainingDatasetOrigins':['CoNLL-2013']}},'grammaticality')


def test_human_axis_conversion_cannot_reuse_scores_after_changing_model_input(evaluation):
    module=evaluation['absolute_grading'];digest=evaluation['common'].digest
    case={'id':'a','group':'g','split':'calibration','source':'A source.','a':'An edit.','b':'An edit.',
          'humanFullyCorrect':False,'humanMeans':[2.]}
    updated={**case,'humanFullyCorrect':True,'humanMeans':[4.],'humanRatingDimension':'meaning'}
    ratings={'judge':{'family':'deberta-v3-reward'},'records':[{'id':'a','pairSHA256':digest(case),'winner':'tie','dimensions':[{'faithfulness':3.9}, {'faithfulness':3.9}]}]}
    converted=module.rebind_scores([case],[updated],ratings)
    assert converted['records'][0]['pairSHA256']==digest(updated)
    assert converted['records'][0]['dimensions']==ratings['records'][0]['dimensions']
    with pytest.raises(ValueError,match='model inputs'):
        module.rebind_scores([case],[{**updated,'source':'A different source.'}],ratings)
    with pytest.raises(ValueError,match='dimensions'):
        module.population([updated],converted,'grammaticality')


def test_pointwise_scores_cannot_trade_meaning_for_fluency_or_depend_on_order(evaluation):
    module=evaluation['pointwise_judge_server']
    a={'scores':{axis:100 for axis in module.AXES},'defects':[]}
    b={'scores':{**a['scores'],'meaning':90},'defects':[{'dimension':'meaning','quote':'never','reason':'Negates the event.'}]}
    a['scores']['correctness']=70
    a['defects']=[{'dimension':'correctness','quote':'was','reason':'Incorrect agreement.'}]
    module.validate(a,'They was late.');module.validate(b,'They never arrived.')
    assert module.compare(a,b)['winner']=='A'
    assert module.compare(b,a)['winner']=='B'
    assert module.compare(a,a)['winner']=='tie'
    assert module.compare(None,a)['winner']=='abstain'
    assert module.compare(b,b)['winner']=='abstain'


def test_pointwise_lower_scores_require_exact_defect_evidence(evaluation):
    module=evaluation['pointwise_judge_server']
    value={'scores':{axis:100 for axis in module.AXES},'defects':[]}
    module.validate(value,'A valid sentence.')
    with pytest.raises(ValueError,match='scores'):
        module.validate({**value,'scores':{**value['scores'],'meaning':True}},'A valid sentence.')
    with pytest.raises(ValueError,match='evidence'):
        module.validate({**value,'scores':{**value['scores'],'correctness':80}},'A valid sentence.')


def test_pointwise_native_schema_binds_each_lower_axis_to_evidence(evaluation):
    module=evaluation['pointwise_judge_server']
    value={'ratings':{axis:{'score':100} for axis in module.AXES}}
    assert module.decode(value,'They was late.')['defects']==[]
    value['ratings']['correctness']={'score':70}
    with pytest.raises(ValueError,match='own evidence'):module.decode(value,'They was late.')
    value['ratings']['correctness'].update(quote='was',reason='Incorrect agreement.')
    assert module.decode(value,'They was late.')['scores']['correctness']==70
    branches=module.schema('They was late.')['properties']['ratings']['properties']['meaning']['oneOf']
    # Native schema conversion ignores integer bounds; the two branches must
    # instead use disjoint finite domains before any tokens are generated.
    assert branches[0]['properties']['score']['enum']==[100]
    assert branches[1]['properties']['score']['enum']==list(range(100))
    assert set(branches[1]['required'])=={'score','quote','reason'}


def test_pointwise_input_hides_positions_and_uses_one_consistent_rating_scale(evaluation):
    module=evaluation['pointwise_judge_server']
    payload={'source':'A source.','context':'A context.','dialect':'en-US','profile':'standard',
             'rubric':{'scale':{'3':'satisfactory'},'dimensions':['meaning']},'A':'First.','B':'Second.'}
    first=module.candidate_input(payload,'First.')
    swapped=module.candidate_input({**payload,'A':'Second.','B':'First.'},'First.')
    assert first==swapped and 'A' not in first and 'B' not in first
    assert first['rubric']['scale']['100']=='no identifiable defect'
    assert payload['rubric']['scale']=={'3':'satisfactory'}


def test_benchmark_display_cannot_correct_words_or_erase_a_comparison(evaluation):
    module=evaluation['normalize_display']
    assert module.text('Sam , late .',lambda value:'Sam, late.')=='Sam, late.'
    with pytest.raises(ValueError,match='lexical'):module.text('Sam , late .',lambda value:'Lee, late.')
    row={'id':'a','group':'g','split':'calibration','source':'Sam , late .','a':'Sam , late .','b':'Sam, late.','humanWinner':'B'}
    with pytest.raises(ValueError,match='identical'):module.pairs([row],lambda value:value.replace(' ,',',').replace(' .','.'))


def test_reference_guidance_applies_only_aligned_nonoverlapping_official_edits(evaluation):
    module=evaluation['reference_guidance']
    content='S They was late .\nA 1 2|||R:VERB|||were|||REQUIRED|||-NONE-|||0\n\nS A train .\n'
    rows=module.corrected_sentences(content)
    assert rows==[('They was late .','They were late .'),('A train .','A train .')]
    mapping={'sentences':[{'source':row[0]} for row in rows]}
    result=module.prepare(mapping,[rows,rows],lambda value:value.replace(' .','.'))
    assert len(result)==2 and all(len(row['references'])==1 for row in result.values())
    assert all(set(row)=={'source','references'} for row in result.values())
    assert module.corrected_sentences('S A fragment .\nA 0 3|||U:OTHER||||||REQUIRED|||-NONE-|||0')==[('A fragment .','')]
    with pytest.raises(ValueError,match='alignment'):
        module.prepare({'sentences':[{'source':'Different source.'}]},[rows[:1]],lambda value:value)
    with pytest.raises(ValueError,match='Overlapping'):
        module.corrected_sentences('S They was late .\nA 1 3|||R|||were late|||REQUIRED|||-NONE-|||0\nA 2 3|||R|||early|||REQUIRED|||-NONE-|||0')
    with pytest.raises(ValueError,match='escaped'):
        module.corrected_sentences('S Short .\nA 1 9|||R|||early|||REQUIRED|||-NONE-|||0')


def test_reference_guidance_cannot_carry_preferences_or_wrong_source_bindings(evaluation):
    module=evaluation['reference_guidance'];digest=evaluation['common'].digest
    row={'source':'They was late.','references':['They were late.']}
    data={'schemaVersion':1,'sentences':{digest(row['source']):row}}
    module.validated_map(data)
    with pytest.raises(ValueError,match='binding'):
        module.validated_map({**data,'sentences':{'wrong':row}})
    with pytest.raises(ValueError,match='binding'):
        module.validated_map({**data,'sentences':{digest(row['source']):{**row,'humanWinner':'A'}}})


def test_native_reasoning_requires_a_real_closing_token_without_decoding_private_content(evaluation):
    from types import SimpleNamespace
    closed=[];decoded=[]
    def generate(tokens,**kwargs):
        try:yield from (7,8,9,10)
        finally:closed.append(True)
    def detokenize(tokens,**kwargs):
        decoded.append(tokens);assert tokens==[9]
        return b'</think>'
    model=SimpleNamespace(tokenize=lambda *args,**kwargs:[9],detokenize=detokenize,
      generate=generate,token_eos=lambda:0)
    tokens,stats=evaluation['native_reasoning'].reasoning_prefix(model,[1,2],128)
    assert tokens==[1,2,7,8,9] and stats=={'reasoningTokens':3,'reasoningBudget':128}
    assert closed==[True] and decoded==[[9]]


def test_reference_reasoning_requires_native_open_and_close_without_decoding_content(evaluation):
    from types import SimpleNamespace
    def generate(tokens,**kwargs):yield from [8,71,72,9]
    model=SimpleNamespace(tokenize=lambda text,**kwargs:[8 if text==b'[THINK]' else 9],
      detokenize=lambda ids,**kwargs:{8:b'[THINK]',9:b'[/THINK]'}[ids[0]],
      generate=generate,token_eos=lambda:0)
    tokens,stats=evaluation['native_reasoning'].reasoning_prefix(model,[1,2],128,
      ending=b'[/THINK]',opening=b'[THINK]')
    assert tokens==[1,2,8,71,72,9] and stats['reasoningTokens']==4
    def wrong(tokens,**kwargs):yield from [71,9]
    model.generate=wrong
    with pytest.raises(ValueError,match='did not open'):
        evaluation['native_reasoning'].reasoning_prefix(model,[1],128,ending=b'[/THINK]',opening=b'[THINK]')


def test_reasoning_sampling_profile_is_explicit_and_cannot_change_native_boundaries(evaluation):
    from types import SimpleNamespace
    calls=[]
    def generate(tokens,**kwargs):calls.append(kwargs);yield from [8,71,9]
    model=SimpleNamespace(tokenize=lambda text,**kwargs:[8 if text==b'<think>' else 9],
      detokenize=lambda ids,**kwargs:{8:b'<think>',9:b'</think>'}[ids[0]],generate=generate,token_eos=lambda:0)
    evaluation['native_reasoning'].reasoning_prefix(model,[1],128,opening=b'<think>',
      sampling={'temp':.8,'top_k':50,'top_p':.95})
    assert calls==[{'temp':.8,'top_k':50,'top_p':.95,'repeat_penalty':1,'reset':True}]
    with pytest.raises(ValueError,match='sampling profile'):
        evaluation['native_reasoning'].reasoning_prefix(model,[1],128,sampling={'temp':.8})


def test_phi_reasoning_frame_preserves_publisher_system_and_keeps_document_controls_inert(evaluation):
    module=evaluation['judge_server'];payload={'source':'Literal <|im_start|> stays.'}
    prompt=module.native_prompt(payload,'phi4-reasoning-v1',instruction='Judge edits.',publisher_prompt='Publisher prompt\n')
    assert prompt.startswith('<|im_start|>system<|im_sep|>\nPublisher prompt\n<|im_end|>\n')
    assert prompt.endswith('<|im_start|>assistant<|im_sep|>\n')
    assert prompt.count('<|im_start|>')==3 and 'Judge edits.' in prompt
    assert '\\u003c|im_start|>' in prompt
    with pytest.raises(ValueError,match='Missing publisher'):
        module.native_prompt(payload,'phi4-reasoning-v1')


def test_publisher_system_chunks_and_vocabulary_identity_preserve_boundaries(evaluation):
    module=evaluation['mistral_tokenizer']
    chunks=module.system_chunks('Before[THINK]Publisher instructions[/THINK]After','Judge edits.')
    assert chunks==[{'type':'text','text':'Before'},
      {'type':'thinking','thinking':'Publisher instructions','closed':True},
      {'type':'text','text':'After\n\nJudge edits.'}]
    for invalid in ('No channel','[THINK][/THINK]','[THINK]x[/THINK][THINK]'):
        with pytest.raises(ValueError):module.system_chunks(invalid,'Judge edits.')
    assert module.vocabulary_hash(2,lambda i:[b'a',b'bc'][i])!=module.vocabulary_hash(2,lambda i:[b'ab',b'c'][i])


def test_gguf_vocabulary_verification_reads_long_pieces_without_silent_truncation(evaluation):
    import ctypes
    module=evaluation['mistral_tokenizer'];value=b' '*70;capacities=[]
    def piece(vocabulary,identifier,buffer,capacity,*args):
        capacities.append(capacity)
        if capacity<len(value):return -len(value)
        ctypes.memmove(buffer,value,len(value));return len(value)
    assert module.gguf_token_bytes(None,7,piece)==value and capacities==[32,70]
    with pytest.raises(ValueError,match='Incomplete'):
        module.gguf_token_bytes(None,7,lambda *args:-70)


@pytest.mark.parametrize('generated',[(0,),(7,)*200])
def test_native_reasoning_abstains_at_eos_or_budget_instead_of_forcing_a_final_answer(evaluation,generated):
    from types import SimpleNamespace
    closed=[]
    def generate(tokens,**kwargs):
        try:yield from generated
        finally:closed.append(True)
    model=SimpleNamespace(tokenize=lambda *args,**kwargs:[9],detokenize=lambda *args,**kwargs:b'</think>',
      generate=generate,token_eos=lambda:0)
    with pytest.raises(ValueError,match='did not finish') as caught:
        evaluation['native_reasoning'].reasoning_prefix(model,[1,2],128)
    assert caught.value.diagnostic=={'reasoningFailure':'eos' if generated==(0,) else 'budget',
      'generatedTokens':0 if generated==(0,) else 128,'reasoningBudget':128}
    assert closed==[True]
    with pytest.raises(ValueError,match='context budget'):
        evaluation['native_reasoning'].reasoning_prefix(model,list(range(3600)),128)


def test_calibration_report_binds_inputs_and_rejects_a_winner_inconsistent_with_its_votes(evaluation):
    calibrate=evaluation['calibrate'].calibrate;digest=evaluation['common'].digest
    pairs=[{'id':'a','group':'g','split':'validation','humanWinner':'A'}]
    row={'id':'a','pairSHA256':digest(pairs[0]),'winner':'A','orderDecisions':['A','B']}
    ratings={'judge':{'family':'fixture'},'records':[row]}
    report=calibrate(pairs,ratings)
    assert report['pairsSHA256']==digest(pairs) and report['ratingsSHA256']==digest(ratings)
    assert report['evaluationImplementationSHA256'] and not report['pairwiseGatePassed']
    with pytest.raises(ValueError,match='disagrees'):
        calibrate(pairs,{**ratings,'records':[{**row,'winner':'B'}]})


def test_comparative_ranking_requires_two_consistent_evidence_bound_orders(evaluation):
    module=evaluation['ranking']
    pair={'source':'They was late.','a':'They were late.','b':'They was late.'}
    defect={'quote':'was','reason':'Plural agreement.','dimension':'correctness'}
    row={'winner':'A','orderDecisions':['A','B'],'responses':[
      {'winner':'A','defects':[{**defect,'candidate':'B'}]},
      {'winner':'B','defects':[{**defect,'candidate':'A'}]}]}
    assert module.rating_score(row,pair)==1.0
    abstained={'winner':'abstain','orderDecisions':['abstain','abstain'],'responses':[None,None]}
    assert module.rating_score(abstained,pair) is None
    with pytest.raises(ValueError,match='disagrees'):module.rating_score({**row,'winner':'B'},pair)
    with pytest.raises(ValueError,match='both saved'):module.rating_score({**row,'responses':[]},pair)
    with pytest.raises(ValueError,match='source anchor'):module.rating_score(row,{**pair,'b':'Other.'})
    with pytest.raises(ValueError,match='Nonfinite'):module.rating_score({'scores':[float('nan')]},pair)


def test_ranking_display_ties_remain_explicit_without_relabelling_human_preferences(evaluation):
    module=evaluation['normalize_display']
    row={'id':'cell','group':'source','split':'validation','sourceIndex':0,'system':'candidate',
      'source':'He goes .','a':'He goes.','b':'He goes .'}
    decoder=lambda text:text.replace(' .','.')
    with pytest.raises(ValueError,match='identical'):module.pairs([row],decoder)
    normalized,changed=module.pairs([row],decoder,unlabelled_ranking_matrix=True)
    assert len(normalized)==1 and normalized[0]['displayEqualityIntroduced'] is True
    assert normalized[0]['a']==normalized[0]['b']=='He goes.' and changed['newlyIdenticalComparisons']==1
    with pytest.raises(ValueError,match='unlabelled'):
        module.pairs([{**row,'humanWinner':'A'}],decoder,unlabelled_ranking_matrix=True)


def test_ranking_preparation_keeps_raw_source_identity_after_display_normalization(evaluation,tmp_path):
    import json
    from types import SimpleNamespace
    module=evaluation['ranking'];common=evaluation['common']
    files=tmp_path/'seeda/outputs/all';files.mkdir(parents=True)
    for name in ['INPUT',*[str(index) for index in range(14)]]:
        (files/(name+'.txt')).write_text('He go .\nAnother source .\n','utf-8')
    cohort=tmp_path/'cohort.jsonl';output=tmp_path/'matrix.jsonl'
    pair={'id':'one','source':'He go.','group':common.digest('He go.'),
          'originalGroup':common.digest('He go .'),'split':'validation'}
    cohort.write_text(json.dumps(pair)+'\n','utf-8')
    args=SimpleNamespace(cohort=str(cohort),seeda=tmp_path/'seeda',output=str(output))
    module.prepare(args);rows=common.records(output)
    assert len(rows)==15 and {row['sourceIndex'] for row in rows}=={0}
    assert {row['source'] for row in rows}=={'He go .'}
    with pytest.raises(ValueError,match='Preserve'):module.prepare(args)
    cohort.write_text(json.dumps({**pair,'originalGroup':'missing'})+'\n','utf-8')
    with pytest.raises(ValueError,match='identities'):
        module.prepare(SimpleNamespace(**{**vars(args),'output':str(tmp_path/'missing.jsonl')}))


def test_canonical_comparison_is_source_bound_and_restores_exact_evidence_to_caller_labels(evaluation):
    server=evaluation['judge_server'];judge=evaluation['judge']
    original={'source':'They was late.','context':'They was late.','dialect':'en-GB',
      'profile':'standard','rubric':{},'A':'They was late.','B':'They were late.'}
    canonical,swapped=server.canonical_payload(original)
    reversed_input={**original,'A':original['B'],'B':original['A']}
    reversed_canonical,reversed_swap=server.canonical_payload(reversed_input)
    assert reversed_canonical==canonical and reversed_swap is not swapped
    verdict={'winner':'A','defects':[{'candidate':'B','quote':canonical['B'],
      'reason':'Transport fixture, not an editorial judgment.','dimension':'correctness'}]}
    first=server.restore_labels(verdict,swapped);second=server.restore_labels(verdict,reversed_swap)
    assert judge.adjudicate(judge.validate(first,original['source'],original['A'],original['B']),
      judge.validate(second,original['source'],original['B'],original['A']))==first['winner']
    assert verdict['winner']=='A' and verdict['defects'][0]['candidate']=='B'
    assert server.restore_labels({'winner':'tie','defects':[]},True)=={'winner':'tie','defects':[]}
    assert server.guided_payload({**original,'humanWinner':'B','modelName':'excluded'},None)==original


def test_reference_assisted_judge_cannot_use_reference_copy_shortcuts_or_qualify_unreferenced_judging(evaluation):
    module=evaluation['reference_guidance'];digest=evaluation['common'].digest
    guidance={digest('He go.'):{'source':'He go.','references':['He goes.']}}
    pair={'source':'He go.','a':'He goes.','b':'He go.','systems':['model','model2'],'group':'g','id':'1','split':'calibration','humanWinner':'A'}
    selected,excluded=module.eligible_pairs([pair],guidance,lambda value:value)
    assert not selected and excluded=={'exactReferenceMatch':1}
    _,excluded=module.eligible_pairs([{**pair,'systems':['REF-F','model']}],guidance,lambda value:value)
    assert excluded=={'referenceSystem':1}
    payload={'source':'He go.','context':'He go.','dialect':'en-GB','profile':'standard','A':'He goes.','B':'He go.',
      'rubric':{},'humanWinner':'A'}
    server=evaluation['judge_server'];data=server.guided_payload(payload,guidance)
    assert 'humanWinner' not in data and data['humanReferenceExamples']==['He goes.']
    assert server.guided_payload({**payload,'A':payload['B'],'B':payload['A']},guidance)['humanReferenceExamples']==data['humanReferenceExamples']
    artifact={'status':'passed','protocol':'alder-grammar-gate-v2','gate':'evaluator','corpusSHA256':'c','implementationSHA256':'i','referenceAssistedOnly':True}
    assert evaluation['qualify'].artifact_status('evaluator',artifact)=='unverified'


def test_rule_guidance_keeps_protected_utf16_spans_and_existing_spelling_repair_contract(evaluation):
    import ast
    module=evaluation['experiment'];source='🙂 The report Quux wrote were late.'
    from alder.proofreading.contracts import u16
    def finding(word,kind):
        offset=source.index(word)
        return {'type':kind,'start':u16(source,offset),'end':u16(source,offset+len(word)),
                'originalText':word,'message':'Possible issue.','alternatives':[{'edits':[{'replacement':'was'}]}]}
    findings=[finding('🙂','spelling'),finding('Quux','spelling'),finding('were','grammar'),finding('late','style')]
    hints=module.language_hints(source,findings,['🙂'])
    assert len(hints)==1 and hints[0]['kind']=='grammar' and hints[0]['word']=='were'
    assert len(module.language_hints(source,[finding('were','grammar')]*20,[]))==12
    rendered=module.rule_hints_worker((DIRECTORY.parents[2]/'backend/alder/proofreading/worker.py').read_text('utf-8'))
    compile(rendered,'candidate-worker','exec')
    tree=ast.parse(rendered)
    content=next(node.value for node in ast.walk(tree) if isinstance(node,ast.Assign)
                 and any(isinstance(target,ast.Name) and target.id=='content' for target in node.targets))
    for repair in (False,True):
        value=eval(compile(ast.Expression(content),'content','eval'),{'text':'A source.','request':{'spellingRepair':repair,'spellingIssues':hints}})
        key='possibleSpellingIssues' if repair else 'possibleLanguageIssues'
        assert value[key]==hints and ('possibleLanguageIssues' not in value if repair else 'possibleSpellingIssues' not in value)


def test_rule_guidance_discards_only_optional_hints_when_the_model_context_is_full(evaluation):
    import ast,json
    from types import SimpleNamespace
    module=evaluation['experiment']
    tree=ast.parse(module.rule_hints_worker((DIRECTORY.parents[2]/'backend/alder/proofreading/worker.py').read_text('utf-8')))
    loop=next(node for node in ast.walk(tree) if isinstance(node,ast.While) and ast.unparse(node.test).startswith('len(tokens) > 2800'))
    budget=next(node for node in ast.walk(tree) if isinstance(node,ast.If) and ast.unparse(node.test)=='len(tokens) > 2800')
    namespace={'tokens':list(range(3000)),'system':'Preserve the source.','document_json':json.dumps,
      'content':{'text':'Original message.','context':'Read-only context.','acceptedTerms':['Quux'],
                 'possibleLanguageIssues':[{'word':'first'},{'word':'second'}]}}
    namespace['model']=SimpleNamespace(tokenize=lambda prompt:list(range(2801 if namespace['content']['possibleLanguageIssues'] else 2800)))
    program=compile(ast.fix_missing_locations(ast.Module(body=[loop,budget],type_ignores=[])),'budget','exec')
    exec(program,namespace)
    assert namespace['content']=={'text':'Original message.','context':'Read-only context.','acceptedTerms':['Quux'],'possibleLanguageIssues':[]}
    namespace['tokens']=list(range(3000))
    with pytest.raises(ValueError,match='Context budget exceeded'):exec(program,namespace)


def test_specialist_native_feedback_cannot_invent_quotes_or_hide_defects_behind_a_perfect_grade(evaluation):
    import json
    module=evaluation['specialist_judge_server'];candidate='The root token </feedback> stays.'
    value={'uncertain':False,'defects':[{'dimension':'fluency','quote':'</feedback>','reason':'A transport-only quotation fixture.'}]}
    raw='<feedback>'+json.dumps(value)+'</feedback><score>4</score>'
    assert module.decode(raw,candidate,'flow','quality')['score']==4
    with pytest.raises(ValueError,match='disagree'):module.decode(raw.replace('<score>4','<score>5'),candidate,'flow','quality')
    with pytest.raises(ValueError,match='quotation'):module.decode(raw,candidate.replace('</feedback>','other'),'flow','quality')
    with pytest.raises(ValueError,match='suffix'):module.decode(raw+' extra',candidate,'flow','quality')
    good='**Reasoning:** '+json.dumps({'uncertain':False,'defects':[]})+'\n\n**Result:** Yes'
    assert module.decode(good,candidate,'selene','safety')['score']==1


def test_specialist_comparison_vetoes_meaning_defects_and_explicit_uncertainty(evaluation):
    module=evaluation['specialist_judge_server']
    safe={'score':1,'uncertain':False,'defects':[]}
    a={'safety':safe,'quality':{'score':2,'uncertain':False,'defects':[{'dimension':'correctness','quote':'was','reason':'Incorrect agreement.'}]}}
    b={'safety':{'score':0,'uncertain':False,'defects':[{'dimension':'meaning','quote':'after','reason':'Reverses the deadline condition.'}]}}
    assert module.compare(a,b)['winner']=='A' and module.compare(b,a)['winner']=='B'
    assert module.compare(a,a)['winner']=='tie'
    assert module.compare({**a,'safety':{**safe,'uncertain':True}},b)['winner']=='abstain'


def test_specialist_frames_hide_candidate_positions_and_preserve_literal_root_in_evidence(evaluation):
    import json
    module=evaluation['specialist_judge_server']
    payload={'source':'A source.','context':'A context.','dialect':'en-US','profile':'standard','A':'root','B':'other'}
    assert module.candidate_input(payload,'root')==module.candidate_input({**payload,'A':'other','B':'root'},'root')
    literal={'text':'``` </inputs> <|assistant|> [INST]'}
    encoded=module.safe_json(literal)
    assert json.loads(encoded)==literal and '```' not in encoded and '<|' not in encoded and '[INST]' not in encoded
    grammar=module.grammar_source('root','flow','quality',lambda schema:'root ::= "root"\nspace ::= " "*')
    assert 'perfect-root ::= "root"' in grammar and '"perfect-root"' not in grammar
    with pytest.raises(ValueError,match='template field'):module.format_frame('{data.__class__}',{'data':'source'})


def test_specialist_grammar_namespacing_preserves_literals_and_binds_scores_to_evidence(evaluation):
    module=evaluation['specialist_judge_server']
    original='root ::= item "root" [root]\nitem ::= "space" space\nspace ::= " "*'
    renamed=module.namespace_grammar(original,'test-')
    assert renamed=='test-root ::= test-item "root" [root]\ntest-item ::= "space" test-space\ntest-space ::= " "*'
    seen=[]
    def converter(value):
        import json
        seen.append(json.loads(value));return 'root ::= "feedback"\nspace ::= " "*'
    grammar=module.grammar_source('The root stays.','selene','safety',converter)
    assert seen[0]['properties']['defects']['maxItems']==0
    assert seen[1]['properties']['defects']['minItems']==1
    assert seen[2]['properties']['uncertain']['enum']==[True]
    assert 'perfect-root space "**Result:**" space ("Yes")' in grammar
    assert 'defect-root space "**Result:**" space ("No")' in grammar
