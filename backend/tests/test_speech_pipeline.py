"""Production acceptance/scheduling tests. Synthetic PCM is explicitly a test fixture."""
import copy
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


def test_interactive_lead_preserves_source_and_pronunciation_boundaries():
    text = 'The writer carefully arranges a long sentence about the distant northern mountain range before listening to the complete passage and checking every word.'
    entries = [{'word': 'northern mountain range', 'spoken': 'northern mountain range'}]
    regular = projected_sections(text, entries, 'default')
    fast = projected_sections(text, entries, 'default', lead_chars=100)
    assert len(regular) == 1 and len(fast) == 2
    assert len(fast[0]['text']) <= 100
    assert not fast[0]['paragraphEnd'] and fast[-1]['paragraphEnd']
    assert ''.join(''.join(c['text'].split()) for c in fast) == ''.join(text.split())
    assert all(text[c['sourceStart']:c['sourceEnd']] == c['text'] for c in fast)
    assert any('northern mountain range' in c['text'] for c in fast)


def test_resume_reuses_verified_pcm_but_detects_changed_audio(service, monkeypatch):
    done = finish(service, submit(service))
    with service._lock:
        service._jobs[done['id']]['status'] = 'cancelled'
    def unexpected_scan(*args):
        raise AssertionError('Retained, hash-verified audio should not be decoded again')
    monkeypatch.setattr('alder.speech_pipeline.inspect_pcm', unexpected_scan)
    resumed = service.resume(done['id'])
    assert resumed['chunks'][0]['playbackEligible']
    # Content replacement invalidates the acceptance hash before any playback.
    pcm(service._chunk_path(service._jobs[done['id']], done['chunks'][0]), silent=True)
    assert not service.get_job(done['id'])['chunks'][0]['playbackEligible']


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
    assert done['status'] == 'buffered', done
    time.sleep(.2)
    done = service.get_job(done['id'])
    assert sum(c['status'] == 'ready' for c in done['chunks']) < 9
    service.demand(done['id'], {'index': 0, 'mode': 'export', 'speed': 1})
    done = finish(service, done, states=('ready', 'failed'))
    assert done['status'] == 'ready', done


def test_section_publication_waits_for_job_snapshot(service, monkeypatch):
    copied_take, release, publishing = threading.Event(), threading.Event(), threading.Event()
    original = service._copy_audio

    def copy_audio(source, destination):
        original(source, destination)
        if '.take-' in destination.name:
            copied_take.set()
            assert release.wait(3)
        else:
            publishing.set()

    monkeypatch.setattr(service, '_copy_audio', copy_audio)
    job = submit(service)
    try:
        assert copied_take.wait(3)
        # Snapshotting and manifest serialization both hold this lock. A worker
        # must not alter attempts or add cache fields while either is reading.
        with service._lock:
            current = service._jobs[job['id']]
            snapshot = copy.deepcopy(current)
            release.set()
            assert not publishing.wait(.1)
            assert current == snapshot
    finally:
        release.set()
    done = finish(service, job)
    assert done['status'] == 'ready', done
    assert publishing.is_set()


def test_export_offsets_wait_for_job_snapshot(service, monkeypatch):
    assembling, release, reading = threading.Event(), threading.Event(), threading.Event()
    original = wave.open

    def open_audio(path, mode=None):
        if Path(path).name == 'narration.tmp.wav':
            assembling.set()
            assert release.wait(3)
        elif assembling.is_set() and mode == 'rb':
            reading.set()
        return original(path, mode)

    monkeypatch.setattr(wave, 'open', open_audio)
    job = submit(service)
    try:
        assert assembling.wait(3)
        with service._lock:
            current = service._jobs[job['id']]
            snapshot = copy.deepcopy(current)
            release.set()
            assert not reading.wait(.1)
            assert current == snapshot
    finally:
        release.set()
    done = finish(service, job)
    assert done['status'] == 'ready', done
    assert done['chunks'][0]['startSeconds'] == 0
    assert reading.is_set()


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


def test_interactive_failure_retries_fresh_audio_without_review(service, monkeypatch):
    generate = service._invoke_worker
    def varied(p, **kwargs):
        response = generate(p, **kwargs)
        path = Path(p['output'])
        data = path.read_bytes()
        path.write_bytes(data[:-2] + struct.pack('<h', p['seed'] % 1000))
        return response
    monkeypatch.setattr(service, '_invoke_worker', varied)
    original = service._invoke_qa_worker
    def reject_second(p, **kwargs):
        result = original(p, **kwargs)
        if result['transcript'].startswith('Second'):
            result['transcript'] = 'Wrong words.'
        return result
    monkeypatch.setattr(service, '_invoke_qa_worker', reject_second)
    done = finish(service, submit(service, 'First passage reads clearly. Second passage follows.', interactive=True))
    assert done['status'] == 'failed' and 'Press Play' in done['error']
    assert 'review' not in done['error'].lower()
    assert done['chunks'][0]['playbackEligible'] and not done['chunks'][1]['playbackEligible']
    original_seeds = [p['seed'] for p in service.generated]
    original_first = service.audio_path(done['id'], done['chunks'][0]['id']).read_bytes()
    monkeypatch.setattr(service, '_invoke_qa_worker', original)
    service.resume(done['id'])
    retried = finish(service, done)
    assert retried['status'] == 'ready' and not retried.get('error')
    assert all(c['playbackEligible'] for c in retried['chunks'])
    assert len(service.generated) == len(original_seeds) + 1
    assert service.generated[-1]['seed'] not in original_seeds
    assert service.audio_path(done['id'], done['chunks'][0]['id']).read_bytes() == original_first


def test_production_review_is_not_implicitly_accepted_or_retried(service, monkeypatch):
    monkeypatch.setattr(service, '_invoke_qa_worker', lambda *a, **kw: {'ok': True, 'transcript': 'Other words.', 'words': []})
    done = finish(service, submit(service))
    assert done['status'] == 'needs_review'
    service.resume(done['id'])
    assert service.get_job(done['id'])['status'] == 'needs_review'
    assert not done['chunks'][0]['playbackEligible']


def test_repeated_bad_take_reuses_negative_check_without_accepting(service, monkeypatch):
    calls = []
    def reject(*a, **kw):
        calls.append(1)
        return {'ok': True, 'transcript': 'Other words.', 'words': []}
    monkeypatch.setattr(service, '_invoke_qa_worker', reject)
    first = finish(service, submit(service))
    count = len(calls)
    second = finish(service, submit(service))
    assert first['status'] == second['status'] == 'needs_review'
    assert len(calls) == count
    assert not second['chunks'][0]['playbackEligible']


def test_secondary_checker_failure_is_not_cached_as_final_rejection(service, monkeypatch):
    calls = []
    service.runtime['qaSecondaryModel'] = 'secondary-test-model'
    def unavailable(p, **kwargs):
        calls.append(p)
        if p.get('secondaryModel'):
            raise RuntimeError('temporary checker failure')
        return {'ok': True, 'transcript': 'Other words.', 'words': []}
    monkeypatch.setattr(service, '_invoke_qa_worker', unavailable)
    assert finish(service, submit(service))['status'] == 'needs_review'
    count = len(calls)
    assert not list((service.root/'cache').glob('*.check.json'))
    assert finish(service, submit(service))['status'] == 'needs_review'
    assert len(calls) > count


@pytest.mark.parametrize('good_on', [3, 6])
def test_interactive_recovers_automatically_without_failed_state(service, monkeypatch, good_on):
    original_generate, original_check, persist = service._invoke_worker, service._invoke_qa_worker, service._persist
    states = []
    def generate(p, **kwargs):
        result = original_generate(p, **kwargs)
        path = Path(p['output'])
        data = path.read_bytes()
        path.write_bytes(data[:-2] + struct.pack('<h', len(service.generated)))
        return result
    def check(p, **kwargs):
        result = original_check(p, **kwargs)
        if len(service.checked) < good_on:
            result['transcript'] = 'Wrong output.'
        return result
    def record(job):
        states.append(job['status'])
        persist(job)
    monkeypatch.setattr(service, '_invoke_worker', generate)
    monkeypatch.setattr(service, '_invoke_qa_worker', check)
    monkeypatch.setattr(service, '_persist', record)
    done = finish(service, submit(service, interactive=True))
    assert done['status'] == 'ready' and done['chunks'][0]['playbackEligible']
    assert len(service.generated) == good_on
    assert not {'failed', 'needs_review'}.intersection(states)
    assert len({p['seed'] for p in service.generated}) == good_on


def test_interactive_persistent_mismatch_still_has_finite_budget(service, monkeypatch):
    monkeypatch.setattr(service, '_invoke_qa_worker', lambda *a, **kw: {'ok':True,'transcript':'Different words.','words':[]})
    done = finish(service, submit(service, interactive=True))
    assert done['status'] == 'failed' and len(service.generated) == 6
    assert not done['chunks'][0]['playbackEligible']


def test_spelling_and_compound_variants_do_not_reject_correct_speech():
    from alder.speech import compare_transcript
    assert compare_transcript('The book-shelves were labelled.', 'The bookshelves were labeled.')['matched']
    assert compare_transcript('His waistcoat pocket.', 'His waist coat pocket.')['matched']
    assert not compare_transcript('Orange marmalade.', 'Orange marmalageed.')['matched']
    assert not compare_transcript('His waistcoat pocket.', 'His west coat poke.')['matched']
    assert not compare_transcript('Here are book-shelves.', 'Here are bookshelves. Thanks for watching.')['matched']


def test_long_sentence_prefers_clause_boundaries_without_losing_text():
    text = 'She took down a jar from one of the shelves as she passed; it was labelled orange marmalade, but she found it empty and put it back.'
    parts = projected_sections(text, [], 'default', 100, 22)
    assert parts[0]['text'].endswith('passed;')
    assert ''.join(''.join(c['text'].split()) for c in parts) == ''.join(text.split())
    assert all(len(c['spokenText']) <= 100 and len(c['spokenText'].split()) <= 22 for c in parts)


def test_compound_spelling_keeps_word_highlights_on_the_written_word():
    from alder.reading import word_timings
    from alder.speech import compare_transcript
    assert compare_transcript('She fell down stairs.', 'She fell downstairs.')['matched']
    timings = valid_timings(word_timings('bookshelves', 'bookshelves', [
        {'text':'book','startSeconds':0.,'endSeconds':.3},
        {'text':'shelves','startSeconds':.3,'endSeconds':.8}]), 'bookshelves', 1)
    assert len(timings) == 1 and timings[0]['text'] == 'bookshelves' and timings[0]['endSeconds'] == .8
    timings = valid_timings(word_timings('book-shelves', 'book-shelves', [
        {'text':'bookshelves','startSeconds':0.,'endSeconds':.8}]), 'book-shelves', 1)
    assert len(timings) == 1 and timings[0]['text'] == 'book-shelves'


def test_capitalised_prose_is_spoken_as_words_without_changing_source(monkeypatch):
    monkeypatch.setattr('alder.language._speller', lambda: {'through','curtseying','marmalade','orange','nasa'})
    text = "I fall THROUGH the earth, CURTSEYING with NASA and the FBI."
    part = projected_sections(text, [], 'default')[0]
    assert part['spokenText'] == "I fall through the earth, curtseying with NASA and the FBI."
    assert part['text'] == text and part['sourceEnd'] == len(text)
    mapped = projected_sections('I read OLE.', [{'word':'OLE','spoken':'THROUGH NASA'}], 'default')[0]
    assert 'THROUGH NASA' in mapped['spokenText']


def test_curtsey_variants_do_not_hide_wrong_words_or_repetition():
    from alder.speech import compare_transcript
    assert compare_transcript('She tried to curtsey, fancy CURTSEYING.', 'She tried to curtsy, fancy curtsying.')['matched']
    assert not compare_transcript('She tried to curtsey.', 'She tried to courtesy.')['matched']
    assert not compare_transcript('She tried to curtsey.', 'She tried to curtsy. There you go.')['matched']


def test_saved_failed_reading_applies_current_spoken_normalization(service, monkeypatch):
    original = service._invoke_qa_worker
    monkeypatch.setattr('alder.language._speller', lambda: set())
    monkeypatch.setattr(service, '_invoke_qa_worker', lambda *a, **kw: {'ok':True,'transcript':'Wrong speech.','words':[]})
    done = finish(service, submit(service, text='ALDER READS CLEARLY.', interactive=True))
    assert done['status'] == 'failed'
    chunk = service._jobs[done['id']]['chunks'][0]
    prior = chunk['cacheKey']
    monkeypatch.setattr('alder.language._speller', lambda: {'alder','reads','clearly'})
    monkeypatch.setattr(service, '_invoke_qa_worker', original)
    service.resume(done['id'])
    done = finish(service, done)
    assert done['status'] == 'ready' and chunk['cacheKey'] != prior, done
    assert chunk['spokenText'] == 'alder reads clearly.'
    assert chunk['text'] == 'ALDER READS CLEARLY.'


def test_unambiguous_contractions_expand_for_speech_preserving_source():
    from alder.speech import compare_transcript
    text = "Dinah'll miss me to-night. She'd say Alice's here."
    parts = projected_sections(text, [], 'default')
    assert parts[0]['text'] == "Dinah'll miss me to-night."
    assert parts[0]['spokenText'] == 'Dinah will miss me to-night.'
    assert parts[0]['pronunciationMap'][0]['sourceStart'] == 0
    assert parts[0]['pronunciationMap'][0]['sourceEnd'] == 8
    assert parts[1]['spokenText'] == "She'd say Alice's here."
    assert compare_transcript("Dinah'll miss me to-night.", 'Dinah will miss me tonight.')['matched']
    assert not compare_transcript("Dinah'll miss me.", 'Dinah missed me.')['matched']
    custom = projected_sections("Dinah'll read.", [{'word':"Dinah'll",'spoken':'Dyna will'}], 'default')[0]
    assert custom['spokenText'] == 'Dyna will read.'


def test_contraction_expansion_obeys_final_section_limits():
    text = "They'll read and we'll listen because they'll continue and we'll follow. " * 12
    parts = projected_sections(text, [], 'default', 100, 20)
    assert all(len(c['spokenText'])<=100 and len(c['spokenText'].split())<=20 for c in parts)
    assert ''.join(''.join(c['text'].split()) for c in parts)==''.join(text.split())


@pytest.mark.parametrize('written,heard', [
    ("They’re ready, but we can’t leave.", "They are ready, but we cannot leave."),
    ("The colourful armchair was labelled.", "The colorful arm chair was labeled."),
    ("The archaeologist returned to-day.", "The archeologist returned today."),
    ("Chapter 12 contains 125 observations.", "Chapter twelve contains one hundred and twenty five observations."),
])
def test_varied_source_spellings_share_content_check(written, heard):
    from alder.speech import compare_transcript
    assert compare_transcript(written, heard)['matched']
    assert not compare_transcript(written, heard + ' Extra words.')['matched']


def test_expanded_contraction_highlight_stays_on_original_word():
    from alder.reading import word_timings
    part = projected_sections("Dinah’ll read.", [], 'default')[0]
    timed = word_timings(part['text'], part['spokenText'], [
        {'text':'Dinah', 'startSeconds':0., 'endSeconds':.4},
        {'text':'will', 'startSeconds':.4, 'endSeconds':.6},
        {'text':'read', 'startSeconds':.6, 'endSeconds':1.},
    ], part['pronunciationMap'])
    assert [(w['text'], w['sourceStart'], w['sourceEnd']) for w in timed] == [('Dinah’ll',0,8),('read',9,13)]
    assert timed[0]['startSeconds'] == 0 and timed[0]['endSeconds'] == .6


def test_windows_worker_protocol_preserves_unicode(service, monkeypatch, tmp_path):
    # Run the actual QA worker protocol through the service's actual pipes, with
    # recognition stubbed so no model or GPU is needed. Parent locale is hostile.
    import subprocess
    from alder import speech_qa_worker
    runner = tmp_path / 'qa_protocol.py'
    runner.write_text("""import sys, types, runpy
class Model:
 def __init__(self, *args, **kwargs): pass
 def transcribe(self, path, **kwargs):
  assert path == 'Zo\u00eb.wav', repr(path)
  word = types.SimpleNamespace(word='cr\u00e8me br\u00fbl\u00e9e', start=0, end=1)
  segment = types.SimpleNamespace(text=word.word, start=0, end=1, avg_logprob=0, no_speech_prob=0, words=[word])
  return iter([segment]), types.SimpleNamespace(language='en')
sys.modules['faster_whisper'] = types.SimpleNamespace(WhisperModel=Model)
runpy.run_path(WORKER, run_name='__main__')
""".replace('WORKER', repr(str(Path(speech_qa_worker.__file__)))), encoding='utf-8')
    original = subprocess.Popen
    def launch(command, **kwargs):
        return original([command[0], '-u', str(runner), *command[3:]], **kwargs)
    monkeypatch.setenv('PYTHONIOENCODING', 'cp1252')
    monkeypatch.setenv('PYTHONUTF8', '0')
    monkeypatch.setattr('alder.speech.subprocess.Popen', launch)
    service.runtime.update(qaPython=sys.executable, qaModel=str(tmp_path))
    response = type(service)._invoke_qa_worker(service, {'operation':'transcribe', 'path':'Zoë.wav'}, timeout=10)
    assert response['ok'] and response['transcript'] == 'crème brûlée'
    assert response['words'][0]['text'] == 'crème brûlée'


def test_ambiguous_and_nested_contractions():
    from alder.speech_comparison import expand_contraction
    assert expand_contraction("ain't") == "ain't"
    assert expand_contraction("she'd") == "she'd"
    assert expand_contraction("we'll've") == 'we will have'


def test_english_recognition_may_omit_accents_but_not_change_names_or_words():
    from alder.speech import compare_transcript
    assert compare_transcript('Zoë read her résumé at the café.', 'Zoe read her resume at the cafe.')['matched']
    assert not compare_transcript('Zoë read her résumé.', 'Zoey read her racemate.')['matched']
    assert not compare_transcript('Zoë read her résumé.', 'Zoe read her racemé.')['matched']
    source = 'Zoë read her résumé at the café.'
    assert projected_sections(source, [], 'default')[0]['spokenText'] == source


def test_sapi_overlapping_progress_is_accepted_without_regenerating(service, monkeypatch):
    monkeypatch.setattr('alder.sapi.voices', lambda: [{'id':'sapi-test','name':'Test','kind':'sapi','hash':'test'}])
    calls=[]
    def render(voice, text, path, *args):
        calls.append(text)
        pcm(path, 2)
        return {'words':[
            {'text':'Alder','start':0,'length':5,'seconds':0},
            {'text':'Alder reads','start':0,'length':11,'seconds':.5},
            {'text':'clearly','start':12,'length':7,'seconds':1},
        ]}
    monkeypatch.setattr('alder.sapi.render', render)
    done=finish(service, service.submit({'id':'test','revision':0,'pronunciation':[]},
        {'scope':'selection','text':'Alder reads clearly.','voiceId':'sapi-test','interactive':True}))
    assert done['status']=='ready', done
    assert calls==['Alder reads clearly.'] and not service.checked
    assert [w['text'] for w in done['chunks'][0]['wordTimings']]==['Alder','reads','clearly']


def test_spoken_ranges_preserve_source_mapping_and_explicit_pronunciation():
    from alder.speech_quality import speech_projection
    text = 'Between 1914–1925, things changed.'
    spoken, mapping = speech_projection(text, [], 'default')
    assert spoken == 'Between 1914 to 1925, things changed.'
    assert text[mapping[0]['sourceStart']:mapping[0]['sourceEnd']] == '1914–1925'
    assert spoken[mapping[0]['spokenStart']:mapping[0]['spokenEnd']] == '1914 to 1925'
    spoken, _ = speech_projection(text, [{'word': '1914–1925', 'spoken': 'the early period'}], 'default')
    assert spoken == 'Between the early period, things changed.'
