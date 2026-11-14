import json
import threading
from alder.speech import SpeechService
from alder.speech_library import SpeechLibrary
from alder.speech_pipeline import SpeechPipeline

def fixture(tmp_path):
    s=SpeechPipeline.__new__(SpeechPipeline);s.root=tmp_path;s._lock=threading.RLock();s._event_condition=threading.Condition()
    s._signatures={};s._events={};s._orders={};s._jobs={};s._demand={};s._eligible=lambda *_:False
    job={'id':'fixture','projectId':'p','createdAt':'2026-11-14','status':'queued','chunks':[{'id':str(i),'text':'café 😀','status':'queued'} for i in range(10)]}
    (tmp_path/'jobs'/'fixture').mkdir(parents=True);return s,job

def test_dirty_delta_matches_full_comparison_and_structural_fallback(tmp_path):
    s,job=fixture(tmp_path);s._jobs[job['id']]=job;s._persist(job)
    job['chunks'][3]['status']='checking';s._persist(job,{'3'})
    assert [c['id'] for c in s._events['fixture'][-1]['chunks']]==['3']
    stored=json.loads((tmp_path/'jobs'/'fixture'/'manifest.json').read_text('utf-8'));assert stored['chunks']==job['chunks']
    job['chunks'].append({'id':'new','text':'another','status':'queued'});job['chunks'][5]['status']='checking'
    s._persist(job,{'new'})
    assert [c['id'] for c in s._events['fixture'][-1]['chunks']]==['5','new']
    assert s._events['fixture'][-1]['order']==[c['id'] for c in job['chunks']]

def test_job_summaries_use_derived_index_without_hydrating_recordings(tmp_path):
    s,job=fixture(tmp_path);s._persist(job);s._library=SpeechLibrary(tmp_path/'jobs')
    rows=s.list_jobs('p',summaries=True)
    assert len(rows)==1 and rows[0]['chunkCount']==10 and rows[0]['summary'] and rows[0]['chunks']==[]
    assert 'audioUrl' not in rows[0] and s._jobs=={}
    s._library.load=lambda _:(_ for _ in ()).throw(AssertionError('Unchanged cache should not parse a manifest'))
    assert s.list_jobs('p',summaries=True)==rows
    cold=SpeechLibrary(tmp_path/'jobs');assert cold.ids_for_project('p')==['fixture']
    assert cold.rows['fixture']['summary']==rows[0]

def test_inactive_durable_recordings_are_evicted_without_touching_active_or_inflight(tmp_path):
    import time
    s,_=fixture(tmp_path);now=time.monotonic();s._access={};s._inflight=set();s._assembling=set()
    s._maintenance_at=0;s._last_work=now
    for i in range(40):
        identity=f'job-{i}';directory=tmp_path/'jobs'/identity;directory.mkdir()
        job={'id':identity,'projectId':'p','createdAt':'2026-11-14','status':'cancelled','chunks':[]}
        (directory/'manifest.json').write_text(json.dumps(job));s._jobs[identity]=job
    s._demand['job-0']={'at':now,'mode':'playing'};s._access['job-1']=now
    s._inflight.add(('job-2','chunk'));s._maintenance()
    assert len(s._jobs)==40  # In-flight work always owns its manifests.
    s._inflight.clear();s._maintenance_at=0;s._maintenance()
    assert len(s._jobs)==32 and 'job-0' in s._jobs and 'job-1' in s._jobs
    retired=next(identity for identity in (f'job-{i}' for i in range(40)) if identity not in s._jobs)
    s._library=SpeechLibrary(tmp_path/'jobs');assert s._job(retired)['id']==retired
    assert (tmp_path/'jobs'/retired/'manifest.json').is_file()

def test_backend_preparation_is_shared_bounded_and_retryable(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    import pytest
    s,_=fixture(tmp_path);s._preparations={};s.policy=None;s.runtime={}
    s._voice=lambda identity:{'hash':identity};started=threading.Event();release=threading.Event();calls=[]
    def prepare(identity,voice):
        calls.append(identity);started.set();assert release.wait(2);return {'ready':True}
    s._prepare_voice=prepare
    with ThreadPoolExecutor(4) as pool:
        first=pool.submit(s.prepare,'one');assert started.wait(1)
        duplicate=pool.submit(s.prepare,'one');second=pool.submit(s.prepare,'two')
        # Synchronise the second owner without imposing sleep on the application.
        import time
        deadline=time.monotonic()+1
        while len(calls)<2 and time.monotonic()<deadline:time.sleep(.001)
        with pytest.raises(ValueError,match='current voice preparation'):s.prepare('three')
        release.set();assert first.result()==duplicate.result()==second.result()=={'ready':True}
    assert calls.count('one')==1 and s._preparations=={}
