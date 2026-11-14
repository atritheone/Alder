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
