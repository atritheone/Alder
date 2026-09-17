"""Speech orchestration tests use an explicit PCM fixture, never a model substitute.

Real CUDA synthesis is separately recorded in docs/speech-baseline.md.
"""
import copy
import json
import math
from pathlib import Path
import struct
import sys
import threading
import time
import wave

import pytest

from alder.speech import SpeechService, compare_transcript, discover_runtime, pronunciation_projection, split_narration


def write_fixture(path, seconds=.1):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(24000)
        file.writeframes(b"".join(struct.pack("<h", round(4000 * math.sin(i / 20))) for i in range(round(seconds * 24000))))


def wait_for(service, job_id, states=("ready", "failed")):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        result = service.get_job(job_id)
        if result["status"] in states:
            return result
        time.sleep(.01)
    raise AssertionError(service.get_job(job_id))


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setattr("alder.speech.discover_runtime", lambda root: {"python": sys.executable, "pythonPresent": True, "source": str(root), "sourcePresent": True, "sourceRevision": "test-source", "model": str(root), "modelPresent": True, "modelRevision": "test-model", "hfHome": str(root), "ffmpeg": None})
    instance = SpeechService(tmp_path, tmp_path)
    instance.calls = []
    def fixture_worker(payload, timeout=600):
        instance.calls.append(payload)
        write_fixture(payload["output"])
        return {"ok": True}
    monkeypatch.setattr(instance, "_invoke_worker", fixture_worker)
    yield instance
    instance.shutdown()


def project():
    return {"id": "project", "revision": 4, "tracks": [{"id": "track", "voiceId": "default"}], "clips": [{"id": "clip", "trackId": "track", "text": "Alder holds an idea. Another sentence follows."}], "pronunciation": []}


def test_splitter_preserves_words_spans_abbreviations_and_paragraphs():
    text = 'Dr. Alder meets A. B. Smith. “Yes!” she says.\n\nA new paragraph carries 🌲 and café.'
    chunks = split_narration(text)
    assert " ".join(c["text"] for c in chunks).split() == text.split()
    assert chunks[0]["text"] == "Dr. Alder meets A. B. Smith."
    assert sum(c["paragraphEnd"] for c in chunks) == 2
    for chunk in chunks:
        assert " ".join(text[chunk["sourceStart"]:chunk["sourceEnd"]].split()) == chunk["text"]


def test_long_sentence_splits_without_losing_words():
    text = " ".join(["word"] * 140)
    chunks = split_narration(text)
    assert all(len(c["text"]) <= 240 and len(c["text"].split()) <= 45 for c in chunks)
    assert " ".join(c["text"] for c in chunks) == text
    with pytest.raises(ValueError, match="exceeds"):
        split_narration("x" * 241)


def test_word_offsets_preserve_spaces_line_breaks_and_unicode():
    from alder.reading import word_timings
    import re
    text = "🌲 Start   here\tand continue\nwithout drifting.  " * 8
    for chunk in split_narration(text):
        assert chunk["text"] == text[chunk["sourceStart"]:chunk["sourceEnd"]]
        assert len(chunk["text"]) <= 240
        words = [{"text": m.group(), "startSeconds": i, "endSeconds": i + .8}
                 for i, m in enumerate(re.finditer(r"\w+", chunk["text"]))]
        timings = word_timings(chunk["text"], chunk["text"], words)
        for word in timings:
            start = chunk["sourceStart"] + word["sourceStart"]
            end = chunk["sourceStart"] + word["sourceEnd"]
            assert text[start:end] == word["text"]


def test_cursor_before_punctuation_skips_empty_speech_chunks():
    text = ".  Alder starts here."
    chunks = split_narration(text)
    assert [chunk["text"] for chunk in chunks] == ["Alder starts here."]
    assert chunks[0]["sourceStart"] == 3


def test_pronunciation_is_nonrecursive_and_voice_specific():
    text = "OLE stays OLE; whole stays whole."
    entries = [{"word": "OLE", "spoken": "Alder"}, {"word": "Alder", "spoken": "tree"}, {"word": "whole", "spoken": "hole", "voiceId": "other"}]
    result, mappings = pronunciation_projection(text, entries)
    assert result == "Alder stays Alder; whole stays whole."
    assert text == "OLE stays OLE; whole stays whole."
    assert len(mappings) == 2
    assert pronunciation_projection("i I", [{"word": "I", "spoken": "eye", "caseSensitive": True}])[0] == "i eye"


def test_job_freezes_source_produces_assembly_and_reuses_cache(service):
    source = project()
    job = service.submit(source, {"scope": "clip", "clipId": "clip", "seed": 42})
    source["clips"][0]["text"] = "Changed later."
    done = wait_for(service, job["id"])
    assert done["status"] == "ready", done
    assert done["sourceRevision"] == 4 and done["text"].startswith("Alder holds")
    assert len(service.calls) == 2
    assert done["chunks"][1]["startSeconds"] == pytest.approx(.28)
    assert done["seconds"] == pytest.approx(.38)
    assert service.audio_path(job["id"]).is_file()
    second = service.submit(project(), {"scope": "clip", "clipId": "clip", "seed": 42})
    assert wait_for(service, second["id"])["status"] == "ready"
    assert len(service.calls) == 2
    assert all(c["cached"] for c in service.get_job(second["id"])["chunks"])


def test_unchanged_sentences_keep_seed_and_cache_after_early_insertion(service):
    first = service.submit(project(), {"scope": "clip", "clipId": "clip"})
    wait_for(service, first["id"])
    changed = project()
    changed["clips"][0]["text"] = "An opening. " + changed["clips"][0]["text"]
    second = service.submit(changed, {"scope": "clip", "clipId": "clip"})
    done = wait_for(service, second["id"])
    assert len(service.calls) == 3
    assert [c["seed"] for c in first["chunks"]] == [c["seed"] for c in done["chunks"]][1:]


def test_cancel_at_chunk_boundary_then_resume_completed_audio(service, monkeypatch):
    entered, proceed = threading.Event(), threading.Event()
    original = service._invoke_worker
    def delayed(payload, timeout=600):
        entered.set()
        assert proceed.wait(3)
        return original(payload)
    monkeypatch.setattr(service, "_invoke_worker", delayed)
    job = service.submit(project(), {"scope": "clip", "clipId": "clip"})
    assert entered.wait(2)
    assert service.cancel(job["id"])["status"] == "cancelling"
    proceed.set()
    cancelled = wait_for(service, job["id"], ("cancelled",))
    assert cancelled["chunks"][0]["status"] == "ready"
    assert cancelled["chunks"][1]["status"] == "queued"
    assert service.audio_path(job["id"], cancelled["chunks"][0]["id"]).is_file()
    service.resume(job["id"])
    assert wait_for(service, job["id"])["status"] == "ready"
    assert len(service.calls) == 2


def test_failure_retry_retains_successful_chunks(service, monkeypatch):
    original = service._invoke_worker
    def failing(payload, timeout=600):
        if payload["text"].startswith("Another"):
            raise RuntimeError("Deliberate worker failure fixture")
        return original(payload)
    monkeypatch.setattr(service, "_invoke_worker", failing)
    job = service.submit(project(), {"scope": "clip", "clipId": "clip"})
    failed = wait_for(service, job["id"])
    assert failed["status"] == "failed" and failed["chunks"][0]["status"] == "ready"
    monkeypatch.setattr(service, "_invoke_worker", original)
    service.resume(job["id"])
    assert wait_for(service, job["id"])["status"] == "ready"
    assert len(service.calls) == 2


def test_saved_manifest_restart_is_resumable(service):
    job = service.submit(project(), {"scope": "clip", "clipId": "clip"})
    done = wait_for(service, job["id"])
    service.shutdown()
    manifest_path = service.root / "jobs" / job["id"] / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["status"] = "generating"
    manifest["chunks"][1]["status"] = "generating"
    manifest_path.write_text(json.dumps(manifest))
    reopened = SpeechService(service.root.parent, service.project_root)
    try:
        recovered = reopened.get_job(job["id"])
        assert recovered["status"] == "interrupted"
        assert recovered["chunks"][0]["status"] == "ready"
        assert recovered["chunks"][1]["status"] == "queued"
        reopened.resume(job["id"])
        assert wait_for(reopened, job["id"])["status"] == "ready"  # cache needs no worker
    finally:
        reopened.shutdown()


def test_collation_order_frozen_wording_voice_inheritance_and_source_immutability(service, monkeypatch):
    p = project()
    p["clips"].append({"id": "other", "trackId": "track", "text": "Other."})
    p["sections"] = [{"id": "later", "order": 1}, {"id": "early", "order": 0}]
    p["placements"] = [{"id": "b", "clipId": "other", "sectionId": "later", "order": 0}, {"id": "a", "clipId": "clip", "sectionId": "early", "order": 0, "frozenText": "A frozen OLE."}, {"id": "skip", "clipId": "clip", "sectionId": "early", "order": 1, "include": False}]
    p["pronunciation"] = [{"word": "OLE", "spoken": "ole"}]
    before = copy.deepcopy(p)
    job = service.submit(p, {"scope": "collation"})
    done = wait_for(service, job["id"])
    assert done["text"] == "A frozen OLE.\n\nOther."
    assert done["chunks"][0]["spokenText"] == "A frozen ole."
    assert p == before


def test_bad_audio_access_and_unsupported_controls(service):
    with pytest.raises(KeyError):
        service.audio_path("../voices")
    with pytest.raises(ValueError, match="does not support"):
        service.submit(project(), {"scope": "clip", "clipId": "clip", "cfgWeight": .2})
    with pytest.raises(ValueError, match="unavailable"):
        service.submit(project(), {"scope": "clip", "clipId": "clip", "format": "mp3"})
    with pytest.raises(ValueError, match="voice"):
        service.submit(project(), {"scope": "clip", "clipId": "clip", "voiceId": "../elsewhere"})
    with pytest.raises(ValueError, match="finite"):
        service.submit(project(), {"scope": "clip", "clipId": "clip", "temperature": float("nan")})


def test_selected_variant_is_the_narration_source(service):
    p = project()
    p["clips"][0]["variants"] = [{"id": "take", "text": "The accepted take."}]
    p["clips"][0]["activeVariantId"] = "take"
    job = service.submit(p, {"scope": "clip", "clipId": "clip"})
    assert job["text"] == "The accepted take."
    assert wait_for(service, job["id"])["status"] == "ready"


def test_voice_reference_validation(service, tmp_path):
    short = tmp_path / "short.wav"
    write_fixture(short, .2)
    with pytest.raises(ValueError, match="longer than 5"):
        service.add_voice(short, "Too short")
    assert [(v["id"], v["kind"]) for v in service.voices() if v["kind"] != "sapi"] == [("default", "builtin")]
    reference = tmp_path / "reference.wav"
    write_fixture(reference, 5.1)
    voice = service.add_voice(reference, "Fixture voice")
    assert voice["id"] in [v["id"] for v in service.voices()]
    assert voice["seconds"] == 5.1


def test_resource_bundle_discovery_precedes_development_paths(tmp_path, monkeypatch):
    root = tmp_path / "resources/speech"
    paths = ["python/python.exe" if sys.platform == "win32" else "python/bin/python3", "chatterbox/src/chatterbox/tts_turbo.py", "models/turbo/ve.safetensors", "models/turbo/t3_turbo_v1.safetensors", "models/turbo/s3gen_meanflow.safetensors", "models/turbo/conds.pt", "models/turbo/tokenizer_config.json", "models/turbo/vocab.json", "models/turbo/merges.txt", "ffmpeg/ffmpeg.exe"]
    for relative in paths:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()
    (root / "models/turbo/revision.txt").write_text("original-snapshot")
    monkeypatch.setenv("ALDER_RESOURCES_DIR", str(root.parent))
    for key in ("ALDER_SPEECH_PYTHON", "ALDER_CHATTERBOX_MODEL", "ALDER_FFMPEG"):
        monkeypatch.delenv(key, raising=False)
    result = discover_runtime(tmp_path)
    assert result["modelPresent"] and result["pythonPresent"] and result["sourcePresent"]
    assert result["modelRevision"] == "original-snapshot"
    assert str(root) in result["python"] and str(root) in result["source"]
    # A source-testing workspace must use current speech code with bundled tools.
    development = tmp_path / "chatterbox/src/chatterbox/tts_turbo.py"
    development.parent.mkdir(parents=True)
    development.write_text("# current checkout")
    current = discover_runtime(tmp_path)
    assert current["source"] == str(tmp_path / "chatterbox/src")
    assert current["sourceRevision"] != result["sourceRevision"]
    assert current["python"] == result["python"]


def enable_qa_fixture(service):
    service.runtime.update({"qaPythonPresent": True, "qaModelPresent": True, "qaModelRevision": "qa-fixture"})
    source = project()
    source["clips"][0]["text"] = "I see the path."
    return source


def test_qa_comparison_does_not_hide_meaning_or_spelling_changes():
    assert compare_transcript("Hello, CAFÉ!", "hello café")["matched"]
    assert not compare_transcript("I need patience at the site.", "Eye need patients at the sight.")["matched"]
    assert not compare_transcript("It's its colour.", "Its it's color.")["matched"]
    assert compare_transcript("He paid 12.", "He paid twelve.")["matched"]
    assert not compare_transcript("He paid 12.", "He paid thirteen.")["matched"]
    assert compare_transcript("Favourite colour at the theatre.", "Favorite color at the theater.")["matched"]
    assert not compare_transcript("", "")["matched"]
    result = compare_transcript("One two three.", "One three four.")
    assert result["wordErrorRate"] == pytest.approx(2 / 3)
    assert result["differences"]


def test_verification_retries_retains_takes_and_preserves_source(service, monkeypatch):
    source = enable_qa_fixture(service)
    before = copy.deepcopy(source)
    transcripts = iter(["Eye see the path.", "I see the path."])
    monkeypatch.setattr(service, "_invoke_qa_worker", lambda *a, **k: {"ok": True, "transcript": next(transcripts)})
    job = service.submit(source, {"scope": "clip", "clipId": "clip", "verify": True})
    done = wait_for(service, job["id"])
    assert done["status"] == "ready", done
    assert done["reviewStatus"] == "content_checked"
    assert done["verificationSummary"]["matched"] == 1
    chunk = done["chunks"][0]
    assert len(chunk["qaAttempts"]) == 2 and chunk["selectedAttempt"] == 1
    assert chunk["qaAttempts"][0]["qa"]["differences"][0]["heard"] == "eye"
    assert chunk["qaAttempts"][0]["seed"] != chunk["qaAttempts"][1]["seed"]
    assert all((service.root / "jobs" / job["id"] / a["file"]).is_file() for a in chunk["qaAttempts"])
    assert service.audio_path(job["id"], chunk["qaAttempts"][0]["audioUrl"].split("/")[-1]).is_file()
    assert source == before
    assert len(service.calls) == 2


def test_verification_bounded_retries_selects_best_unresolved_take(service, monkeypatch):
    source = enable_qa_fixture(service)
    transcripts = iter(["I see.", "I see path.", "Other words."])
    monkeypatch.setattr(service, "_invoke_qa_worker", lambda *a, **k: {"ok": True, "transcript": next(transcripts)})
    job = service.submit(source, {"scope": "clip", "clipId": "clip", "verify": True, "verificationRetries": 2})
    done = wait_for(service, job["id"])
    assert done["status"] == "ready", done
    assert done["reviewStatus"] == "needs_review"
    chunk = done["chunks"][0]
    assert len(service.calls) == 3 and len(chunk["qaAttempts"]) == 3
    assert chunk["selectedAttempt"] == 1
    assert chunk["qa"]["transcript"] == "I see path."
    assert service.audio_path(job["id"]).is_file()


def test_verification_failure_requires_review_without_regeneration(service, monkeypatch):
    source = enable_qa_fixture(service)
    monkeypatch.setattr(service, "_invoke_qa_worker", lambda *a, **k: {"ok": False, "error": "Recognition fixture failure"})
    job = service.submit(source, {"scope": "clip", "clipId": "clip", "verify": True, "verificationRetries": 2})
    done = wait_for(service, job["id"])
    assert done["reviewStatus"] == "needs_review"
    assert done["chunks"][0]["qa"]["status"] == "error"
    assert len(service.calls) == 1


def test_cancellation_during_verification_resumes_remaining_attempt(service, monkeypatch):
    source = enable_qa_fixture(service)
    entered, proceed = threading.Event(), threading.Event()
    calls = []
    def delayed(*a, **k):
        calls.append(True)
        if len(calls) == 1:
            entered.set()
            assert proceed.wait(3)
            return {"ok": True, "transcript": "Eye see the path."}
        return {"ok": True, "transcript": "I see the path."}
    monkeypatch.setattr(service, "_invoke_qa_worker", delayed)
    job = service.submit(source, {"scope": "clip", "clipId": "clip", "verify": True})
    assert entered.wait(2)
    assert service.cancel(job["id"])["status"] == "cancelling"
    proceed.set()
    cancelled = wait_for(service, job["id"], ("cancelled",))
    assert not cancelled["chunks"][0]["qaComplete"]
    assert len(cancelled["chunks"][0]["qaAttempts"]) == 1
    service.resume(job["id"])
    done = wait_for(service, job["id"])
    assert done["reviewStatus"] == "content_checked"
    assert len(calls) == 2
    assert len(service.calls) == 2


def test_qa_availability_and_retry_bounds(service):
    with pytest.raises(ValueError, match="missing"):
        service.submit(project(), {"scope": "clip", "clipId": "clip", "verify": True})
    enable_qa_fixture(service)
    with pytest.raises(ValueError, match="0 to 2"):
        service.submit(project(), {"scope": "clip", "clipId": "clip", "verify": True, "verificationRetries": 3})


def test_listening_acceptance_persists_without_changing_recognition(service, monkeypatch):
    source = enable_qa_fixture(service)
    monkeypatch.setattr(service, "_invoke_qa_worker", lambda *a, **k: {"ok": True, "transcript": "Eye see the path."})
    job = service.submit(source, {"scope": "clip", "clipId": "clip", "verify": True, "verificationRetries": 0})
    done = wait_for(service, job["id"])
    original_check = copy.deepcopy(done["chunks"][0]["qa"])
    accepted = service.review(job["id"], {"chunkId": done["chunks"][0]["id"], "accepted": True, "note": "Listened: the first word sounds correct."})
    assert accepted["manualReviewStatus"] == "accepted"
    assert accepted["manualReviewSummary"] == {"accepted": 1, "total": 1}
    assert accepted["reviewStatus"] == "needs_review"
    assert accepted["chunks"][0]["qa"] == original_check
    record = accepted["chunks"][0]["manualReview"]
    assert record["sourceRevision"] == source["revision"] and len(record["audioHash"]) == 64
    assert record["selectedSeed"] == accepted["chunks"][0]["selectedSeed"]
    service.shutdown()
    restarted = SpeechService(service.root.parent, service.project_root)
    try:
        restored = restarted.get_job(job["id"])
        assert restored["chunks"][0]["manualReview"] == record
        assert restored["manualReviewStatus"] == "accepted"
        revoked = restarted.review(job["id"], {"accepted": False, "note": "A second listening is needed."})
        assert revoked["manualReviewStatus"] == "unreviewed"
        assert len(revoked["chunks"][0]["reviewHistory"]) == 2
        assert revoked["chunks"][0]["qa"] == original_check
    finally:
        restarted.shutdown()


def test_listening_review_validates_targets_and_does_not_apply_to_changed_takes(service):
    job = service.submit(project(), {"scope": "clip", "clipId": "clip"})
    done = wait_for(service, job["id"])
    first = done["chunks"][0]
    with pytest.raises(ValueError, match="true or false"):
        service.review(job["id"], {"accepted": "yes"})
    with pytest.raises(ValueError, match="2000"):
        service.review(job["id"], {"accepted": True, "note": "x" * 2001})
    with pytest.raises(KeyError, match="Unknown narration chunk"):
        service.review(job["id"], {"accepted": True, "chunkId": "../outside"})
    partial = service.review(job["id"], {"accepted": True, "chunkId": first["id"]})
    assert partial["manualReviewStatus"] == "partial"
    assert partial["reviewStatus"] == "unreviewed"
    with service._lock:
        service._jobs[job["id"]]["chunks"][1]["status"] = "checking"
    with pytest.raises(ValueError, match="Wait"):
        service.review(job["id"], {"accepted": True})
    assert service.get_job(job["id"])["manualReviewSummary"]["accepted"] == 1
    with service._lock:
        service._jobs[job["id"]]["chunks"][0]["selectedSeed"] = first["seed"] + 1
    changed = service.get_job(job["id"])
    assert changed["manualReviewStatus"] == "unreviewed"
    assert changed["chunks"][0]["manualReview"]["superseded"]
    with service._lock:
        service._jobs[job["id"]]["chunks"][1]["status"] = "ready"
    all_accepted = service.review(job["id"], {"accepted": True, "note": "Reviewed both selected chunks."})
    assert all_accepted["manualReviewSummary"] == {"accepted": 2, "total": 2}
    assert all_accepted["reviewStatus"] == "unreviewed"


def test_voice_library_names_removal_and_restore_keep_saved_references(service, monkeypatch, tmp_path):
    windows = [{"id": "sapi-test", "name": "System Voice", "kind": "sapi"}]
    monkeypatch.setattr("alder.sapi.voices", lambda: windows)
    reference = tmp_path / "library-reference.wav"
    write_fixture(reference, 6)
    voice = service.add_voice(reference, "Reference Voice")
    service.update_voice(voice["id"], name="Reading Voice")
    assert service._voice(voice["id"])["name"] == "Reading Voice"
    service.update_voice(voice["id"], removed=True)
    assert voice["id"] not in {v["id"] for v in service.voices()}
    assert service._voice(voice["id"])["removed"] is True
    assert (service.root / "voices" / voice["id"] / "reference.wav").is_file()
    service.update_voice("sapi-test", name="Windows Alias", removed=True)
    assert windows[0]["name"] == "System Voice"
    assert "removed" not in windows[0]
    with pytest.raises(ValueError, match="at least one"):
        service.update_voice("default", removed=True)
    service.update_voice(voice["id"], removed=False)
    assert voice["id"] in {v["id"] for v in service.voices()}
    preferences = json.loads((service.root / "voices" / "library.json").read_text())
    assert preferences[voice["id"]] == {"name": "Reading Voice", "removed": False}
    with pytest.raises(ValueError):
        service.update_voice(voice["id"], name=" ")
    with pytest.raises(ValueError):
        service.update_voice("../outside", removed=True)


def test_ranges_and_negative_numbers_keep_their_meaning():
    for written, spoken in [('1914–1925', '1914 to 1925'), ('1914-1925', '1914 to 1925'),
                            ('Pages 10–20.', 'Pages ten to twenty.'), ('1.5–2.5', 'one point five to two point five')]:
        assert compare_transcript(written, spoken)['matched']
    assert not compare_transcript('-5', 'five')['matched']
    assert not compare_transcript('3-5', 'three to five')['matched']
    assert not compare_transcript('1914–1925', '1914 to 1926')['matched']
    assert not compare_transcript('1914–1925', '1914 1925')['matched']


def test_numbered_heading_stays_with_its_text_and_separate_from_citation():
    text = '([Museum][2])\n2. 1914–1925: A new period\nThe story continues.'
    chunks = split_narration(text)
    assert chunks[0]['text'] == '([Museum][2])'
    assert chunks[1]['text'].startswith('2. 1914–1925:')
    assert ' '.join(c['text'] for c in chunks).split() == text.split()
    assert all(text[c['sourceStart']:c['sourceEnd']] == c['text'] for c in chunks)


@pytest.mark.parametrize('written,spoken', [('20th','twentieth'), ('21st','twenty-first'), ('112th','one hundred and twelfth'), ('1000th','one thousandth'), ('99th','ninety ninth')])
def test_ordinal_spellings_are_equivalent(written, spoken):
    assert compare_transcript(written, spoken)['matched']
    assert compare_transcript(spoken, written)['matched']


def test_ordinal_normalization_does_not_hide_changed_numbers():
    for a,b in [('20th','twenty'), ('20th','nineteenth'), ('11st','eleventh'), ('021st','twenty first')]:
        assert not compare_transcript(a,b)['matched']


def test_numbered_heading_does_not_merge_with_following_prose():
    text = '1. The trade and the maritime scene were separate\nA new paragraph explains the history.'
    chunks = split_narration(text)
    assert [c['text'] for c in chunks] == text.split('\n')


def test_recognisable_spelling_does_not_trigger_new_speech():
    assert compare_transcript('a recognisable economy', 'a recognizable economy')['matched']
    assert not compare_transcript('a recognisable economy', 'an unrecognizable economy')['matched']
