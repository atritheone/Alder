"""Production acceptance/scheduling tests. Synthetic PCM is explicitly a test fixture."""
import json
import math
import struct
import sys
import threading
import time
import wave
from pathlib import Path

import pytest

from alder.speech_pipeline import SpeechPipeline
from alder.speech_quality import inspect_pcm, projected_sections, valid_timings


def pcm(path, seconds=1., silent=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as f:
        f.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
        f.writeframes(b''.join(struct.pack('<h', 0 if silent else round(4000 * math.sin(i / 20))) for i in range(round(seconds * 24000))))


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setattr('alder.speech.discover_runtime', lambda root: dict(python=sys.executable, pythonPresent=True, source=str(root), sourcePresent=True, sourceRevision='source', model=str(root), modelPresent=True, modelRevision='model', hfHome=str(root), ffmpeg=None, qaPythonPresent=True, qaModelPresent=True, qaModelRevision='qa'))
    monkeypatch.setattr('alder.sapi.voices', lambda: [])
    s = SpeechPipeline(tmp_path, tmp_path)
    s.generated, s.checked, s.texts = [], [], {}
    def generate(p, timeout=90):
        s.generated.append(p)
        pcm(p['output'], max(1, len(p['text'].split()) * .2))
        s.texts[p['output']] = p['text']
        return {'ok': True}
    def check(p, timeout=45):
        s.checked.append(p)
        text = s.texts[p['path']]
        return {'ok': True, 'transcript': text, 'words': [{'text': word, 'startSeconds': i * .2, 'endSeconds': (i+1) * .2} for i, word in enumerate(text.split())]}
    monkeypatch.setattr(s, '_invoke_worker', generate)
    monkeypatch.setattr(s, '_invoke_qa_worker', check)
    yield s
    s.shutdown()


def submit(s, text='Alder reads clearly.', **options):
    return s.submit({'id': 'test', 'revision': 0, 'pronunciation': []}, {'scope': 'selection', 'text': text, 'voiceId': 'default', **options})


def finish(s, job, states=('ready', 'needs_review', 'failed', 'cancelled', 'buffered')):
    end = time.monotonic() + 12
    while time.monotonic() < end:
        result = s.get_job(job['id'])
        if result['status'] in states:
            return result
        time.sleep(.01)
    raise AssertionError(s.get_job(job['id']))


def test_acceptance_required_even_for_legacy_clients(service):
    done = finish(service, submit(service, verify=False))
    assert done['status'] == 'ready'
    assert done['verify'] and done['chunks'][0]['playbackEligible']
    assert len(service.checked) == 1
    assert service.audio_path(done['id']).exists()


@pytest.mark.parametrize('heard', ['', 'Unrelated nonsense.', 'Alder reads reads reads clearly.', 'Alder reads.'])
def test_rejected_audio_cannot_autoplay_or_export(service, monkeypatch, heard):
    monkeypatch.setattr(service, '_invoke_qa_worker', lambda *a, **kw: {'ok': True, 'transcript': heard, 'words': []})
    done = finish(service, submit(service))
    assert done['status'] == 'needs_review'
    assert len(service.generated) == 2
    assert not done['chunks'][0]['playbackEligible'] and not done.get('audioUrl')
    with pytest.raises(KeyError): service.audio_path(done['id'], done['chunks'][0]['id'])
    assert service.audio_path(done['id'], done['chunks'][0]['id'] + '.take-1').exists()


def test_manual_review_is_distinct_and_bound_to_audio(service, monkeypatch):
    monkeypatch.setattr(service, '_invoke_qa_worker', lambda *a, **kw: {'ok': True, 'transcript': 'Other words.', 'words': []})
    done = finish(service, submit(service))
    chunk = done['chunks'][0]
    service.review(done['id'], {'chunkId': chunk['id'], 'accepted': True})
    done = finish(service, done)
    assert done['status'] == 'ready'
    assert done['chunks'][0]['verificationStatus'] == 'needs_review'
    assert done['chunks'][0]['playbackEligible']
    pcm(service.audio_path(done['id'], chunk['id']), seconds=2)
    assert not service.get_job(done['id'])['chunks'][0]['playbackEligible']
    with pytest.raises(KeyError): service.audio_path(done['id'])


def test_checker_failure_retries_checker_not_speech(service, monkeypatch):
    calls = []
    def fail(*a, **kw):
        calls.append(1)
        raise RuntimeError('worker exited')
    monkeypatch.setattr(service, '_invoke_qa_worker', fail)
    done = finish(service, submit(service))
    assert done['status'] == 'failed'
    assert len(calls) == 2 and len(service.generated) == 1
    assert not done['chunks'][0]['playbackEligible']


def test_transient_generation_failure_recovers_once(service, monkeypatch):
    original = service._invoke_worker
    calls = []
    def fail_once(*a, **kw):
        calls.append(1)
        if len(calls) == 1: raise RuntimeError('CUDA out of memory')
        return original(*a, **kw)
    monkeypatch.setattr(service, '_invoke_worker', fail_once)
    done = finish(service, submit(service))
    assert done['status'] == 'ready' and len(calls) == 2


def test_split_recovery_is_bounded_and_covers_source(service, monkeypatch):
    original = service._invoke_qa_worker
    def check(p, **kw):
        if len(service.texts[p['path']]) > 125:
            return {'ok': True, 'transcript': 'Unrelated output.', 'words': []}
        return original(p, **kw)
    monkeypatch.setattr(service, '_invoke_qa_worker', check)
    text = ' '.join(['The quiet reader follows the words through a long passage'] * 3) + '.'
    done = finish(service, submit(service, text))
    assert done['status'] == 'ready', done
    assert len(service.generated) <= 6
    assert ' '.join(c['text'] for c in done['chunks']).split() == text.split()
    assert all(c['playbackEligible'] for c in done['chunks'])


def test_cache_reuses_synthesis_and_check_when_pause_changes(service):
    first = finish(service, submit(service))
    second = finish(service, submit(service, pauseSeconds=.7))
    assert second['status'] == 'ready'
    assert len(service.generated) == 1 and len(service.checked) == 1
    assert second['chunks'][0]['cached'] and second['chunks'][0]['checkCached']


def test_corruption_is_withheld_then_rechecked(service):
    done = finish(service, submit(service))
    chunk = done['chunks'][0]
    pcm(service.audio_path(done['id'], chunk['id']), 2)
    assert not service.get_job(done['id'])['chunks'][0]['playbackEligible']
    service.resume(done['id'])
    done = finish(service, done)
    assert done['status'] == 'ready' and done['chunks'][0]['playbackEligible']
    assert len(service.checked) == 2


def test_stop_during_synthesis_has_no_publication_then_resume(service, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    original = service._invoke_worker
    def delayed(*a, **kw):
        entered.set()
        release.wait(4)
        return original(*a, **kw)
    monkeypatch.setattr(service, '_invoke_worker', delayed)
    job = submit(service)
    assert entered.wait(3)
    started = time.monotonic()
    stopped = service.cancel(job['id'])
    assert time.monotonic() - started < .2 and stopped['status'] == 'cancelling'
    release.set()
    done = finish(service, job)
    assert done['status'] == 'cancelled' and not done['chunks'][0]['playbackEligible']
    service.resume(job['id'])
    assert finish(service, job)['status'] == 'ready'


def test_interactive_buffer_is_bounded_then_demand_advances(service):
    text = ' '.join(f'This is section {i} with several words to read aloud.' for i in range(25))
    done = finish(service, submit(service, text, interactive=True), states=('buffered', 'failed'))
    time.sleep(.2)
    done = service.get_job(done['id'])
    assert sum(c['status'] == 'ready' for c in done['chunks']) < 9
    service.demand(done['id'], {'index': 0, 'mode': 'export', 'speed': 1})
    assert finish(service, done, states=('ready', 'failed'))['status'] == 'ready'


def test_events_reconnect_and_do_not_repeat_order_or_manuscript(service):
    done = finish(service, submit(service))
    snapshot = service.events(done['id'])
    assert snapshot['snapshot']['id'] == done['id']
    with service._lock:
        service._persist(service._jobs[done['id']])
    batch = service.events(done['id'], snapshot['sequence'], 0)
    assert len(batch['events']) == 1
    assert batch['events'][0]['chunks'] == []
    assert 'order' not in batch['events'][0]
    assert 'text' not in batch['events'][0]['header']
    with service._lock:
        for _ in range(130): service._persist(service._jobs[done['id']])
    assert 'snapshot' in service.events(done['id'], 1, 0)


def test_missing_checker_never_downgrades(service):
    service.runtime['qaModelPresent'] = False
    with pytest.raises(ValueError, match='checking is unavailable'): submit(service)


def test_projected_bounds_and_unicode_coverage():
    text = '🌲 OLE follows café. ' * 12
    parts = projected_sections(text, [{'word': 'OLE', 'spoken': 'organic language engine with a longer name'}], 'default')
    assert all(len(p['spokenText']) <= 220 for p in parts)
    assert ''.join(p['text'] for p in parts).replace(' ', '') == text.replace(' ', '')
    assert all(text[p['sourceStart']:p['sourceEnd']] == p['text'] for p in parts)
    with pytest.raises(ValueError): projected_sections('OLE', [{'word': 'OLE', 'spoken': 'long ' * 100}], 'default')


def test_timing_rejects_nan_out_of_bounds_and_overlap():
    words = [{'sourceStart': 0, 'sourceEnd': 4, 'startSeconds': a, 'endSeconds': b} for a,b in [(0,.2),(.1,.3),(float('nan'),.4),(.4,8),(.5,.6)]]
    assert len(valid_timings(words, 'word', 1)) == 2


def test_pcm_silent_truncated_and_clipped_are_not_accepted(tmp_path):
    path = tmp_path/'test.wav'
    pcm(path, silent=True)
    assert not inspect_pcm(path, 'hello')['accepted']
    pcm(path)
    path.write_bytes(path.read_bytes()[:-30])
    with pytest.raises(ValueError): inspect_pcm(path, 'hello')
    with wave.open(str(path), 'wb') as f:
        f.setparams((1,2,24000,0,'NONE','not compressed'))
        f.writeframes(struct.pack('<h',32767)*24000)
    assert not inspect_pcm(path, 'hello')['accepted']


def test_cancelling_job_is_not_rescheduled(service, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    original = service._invoke_worker
    def hold(*a, **kw):
        entered.set(); release.wait(4); return original(*a, **kw)
    monkeypatch.setattr(service, '_invoke_worker', hold)
    job = submit(service, 'First passage is here. Second passage is here. Third passage is here.')
    assert entered.wait(3)
    service.cancel(job['id'])
    time.sleep(.15)
    assert service.get_job(job['id'])['status'] == 'cancelling'
    release.set()
    done = finish(service, job)
    assert done['status'] == 'cancelled'
    assert len(service.generated) == 1


def test_failed_manifest_does_not_kill_scheduler(service, monkeypatch):
    original = service._persist
    fail = {'enabled': False}
    def persist(job):
        if fail['enabled']: raise OSError('disk full')
        original(job)
    monkeypatch.setattr(service, '_persist', persist)
    with service._lock:
        job = submit(service)
        fail['enabled'] = True
    assert finish(service, job)['status'] == 'failed'
    assert service._thread.is_alive()
    fail['enabled'] = False
    assert finish(service, submit(service, 'Another valid passage.'))['status'] == 'ready'


def test_checked_cache_damage_is_recovered(service):
    first = finish(service, submit(service))
    cached_check = next((service.root/'cache').glob('*.check.json'))
    cached_check.write_text('{truncated',encoding='utf-8')
    second = finish(service, submit(service))
    assert second['status'] == 'ready'
    assert len(service.generated) == 1 and len(service.checked) == 2


def test_worker_death_and_token_limit_have_finite_attempts(service, monkeypatch):
    calls = []
    def failed(*a, **kw):
        calls.append(1)
        raise RuntimeError('generation reached token limit without EOS')
    monkeypatch.setattr(service, '_invoke_worker', failed)
    done = finish(service, submit(service))
    assert done['status'] == 'failed' and len(calls) == 2
    assert not done['chunks'][0]['playbackEligible']


def test_windows_atomic_publication_retries_only_transient_lock(tmp_path, monkeypatch):
    from alder.speech import _atomic_json
    import alder.speech as speech
    original = speech.os.replace
    calls = []
    def locked(*args):
        calls.append(1)
        if len(calls) < 3: raise PermissionError('sharing violation')
        original(*args)
    monkeypatch.setattr(speech.os, 'replace', locked)
    path = tmp_path/'manifest.json'
    _atomic_json(path, {'status':'ready'})
    assert json.loads(path.read_text())['status'] == 'ready' and len(calls)==3


def test_event_wait_wakes_on_publication(service):
    job = finish(service, submit(service))
    seq = service.events(job['id'])['sequence']
    results = []
    thread = threading.Thread(target=lambda: results.append(service.events(job['id'],seq,2)))
    thread.start()
    time.sleep(.02)
    with service._lock: service._persist(service._jobs[job['id']])
    thread.join(.5)
    assert not thread.is_alive() and results[0]['sequence'] > seq


def test_pronunciation_rule_crossing_section_boundary_remains_whole():
    text = 'word ' * 39 + 'New York City follows.'
    parts = projected_sections(text, [{'word':'New York City','spoken':'the city'}], 'default')
    assert sum('the city' in part['spokenText'] for part in parts) == 1
    assert 'New York' not in ' '.join(part['spokenText'] for part in parts)


def test_timing_maps_english_spelling_and_integer_variants():
    from alder.reading import word_timings
    words = [{'text':'color','startSeconds':0,'endSeconds':.4}, {'text':'twenty','startSeconds':.4,'endSeconds':.6}, {'text':'four','startSeconds':.6,'endSeconds':.9}]
    mapped = valid_timings(word_timings('colour 24','colour 24',words), 'colour 24', 1)
    assert mapped[0]['text']=='colour'
    assert mapped[-1]['text']=='24'
    assert all(' ' not in word['text'] for word in mapped)


def test_concurrent_identical_requests_share_check(service, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    original = service._invoke_qa_worker
    def slow(*args, **kwargs):
        entered.set()
        assert release.wait(3)
        return original(*args, **kwargs)
    monkeypatch.setattr(service, '_invoke_qa_worker', slow)
    first = submit(service)
    assert entered.wait(3)
    second = submit(service)
    release.set()
    assert finish(service, first)['status'] == 'ready'
    assert finish(service, second)['status'] == 'ready'
    assert len(service.generated) == 1 and len(service.checked) == 1


def test_export_rechecks_acceptance_after_assembly(service, monkeypatch):
    done = finish(service, submit(service))
    job = service._jobs[done['id']]
    def revoked(_self, current):
        current['chunks'][0]['verificationStatus'] = 'needs_review'
        current['status'] = 'ready'
    monkeypatch.setattr('alder.speech.SpeechService._assemble', revoked)
    service._finish_export(job)
    assert service.get_job(job['id'])['status'] == 'needs_review'
    with pytest.raises(KeyError): service.audio_path(job['id'])
