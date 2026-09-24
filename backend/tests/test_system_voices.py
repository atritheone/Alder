"""Provider contracts; native acceptance is scripts/verify-system-voices.py."""
import json
from pathlib import Path
from zipfile import ZipFile

import pytest

from alder import system_voices as native
from alder.store import Store
from alder.speech import SpeechService
from alder.speech_quality import inspect_pcm, valid_timings
from test_speech_pipeline import service, pcm, finish


def voice(provider="macos", culture="en-GB"):
    return {"id": native.identity(provider, "native-id"), "nativeId": "native-id", "name": "System Voice",
            "provider": provider, "engine": provider, "kind": "system", "system": True,
            "available": True, "hash": "engine-version-one", "culture": culture}


@pytest.mark.parametrize("provider", ["sapi", "macos", "espeak"])
def test_archive_system_voice_round_trip_without_reference_audio(tmp_path, provider):
    first = Store(tmp_path / "first")
    row = voice(provider)
    native.references(first.data_dir / "speech", [row])
    project = first.create(template="blank")
    project["tracks"][0]["voiceId"] = row["id"]
    saved = first.update(project["id"], project, project["revision"])
    archive = first.save_archive(project["id"])
    with ZipFile(archive) as f:
        assert not any(name.endswith("reference.wav") for name in f.namelist())
        assert json.loads(f.read("project.json")) == saved
        assert json.loads(f.read("system-voices.json"))[0]["nativeId"] == "native-id"
    # Opening an unchanged archive must not fork a duplicate project.
    assert first.open_archive(str(archive))["id"] == saved["id"]
    second = Store(tmp_path / "second")
    imported = second.open_archive(str(archive))
    assert imported["tracks"][0]["voiceId"] == row["id"]
    assert native.references(second.data_dir / "speech")[row["id"]]["name"] == row["name"]
    # A third machine can save again without having the native voice installed.
    third = Store(tmp_path / "third")
    assert third.open_archive(str(second.save_archive(imported["id"])))['tracks'][0]['voiceId'] == row['id']


def test_saved_catalog_is_descriptive_and_cannot_import_paths(tmp_path):
    row = dict(voice(), path="/some/executable", available=True, command="run me")
    saved = native.references(tmp_path, [row, {"id": "../../escape"}, None])
    assert set(saved[row["id"]]) == {"id", "name", "nativeId", "culture", "provider"}
    assert native.provider_id("macos-../../file") == "chatterbox-turbo"


def test_renamed_voice_prepares_native_identity(monkeypatch):
    monkeypatch.setattr(native.sapi, "voices", lambda: [{"id": "sapi-example", "name": "Original", "kind": "sapi"}])
    seen = []
    monkeypatch.setattr(native.sapi, "prepare", seen.append)
    native.prepare("sapi-example")
    assert seen == ["Original"]


def test_timing_bounds_and_unicode():
    events = [{"text": "Alder", "start": 0, "seconds": 0},
              {"text": "café", "start": 9, "seconds": .3},
              {"text": "broken", "start": 15, "seconds": float("nan")}]
    assert [w["text"] for w in native.native_timings(events, 1)] == ["Alder", "café"]
    assert native.native_timings([{ "text": "one", "start": 0, "seconds": .8},
                                 { "text": "two", "start": 4, "seconds": .2}], 1) == []


def test_unspaced_language_duration_is_not_counted_as_one_word(tmp_path):
    path = tmp_path / "chinese.wav"
    pcm(path, 10)
    text = "这是用于测试本地语音的句子我们希望每一个字都能够正确显示"
    assert inspect_pcm(path, text, "cmn")["accepted"]
    assert not inspect_pcm(path, text, "en")["accepted"]


def test_service_refreshes_discovery_on_startup(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(native, "voices", lambda refresh=False: calls.append(refresh) or [])
    s = SpeechService(tmp_path, tmp_path)
    try:
        assert calls == [True]
        s.voices()
        assert calls == [True, False]
    finally:
        s.shutdown()


@pytest.mark.parametrize("provider", ["macos", "espeak"])
def test_pipeline_system_voice_does_not_use_chatterbox_or_recognition(service, monkeypatch, provider):
    row = voice(provider)
    monkeypatch.setattr(native, "voices", lambda refresh=False: [row])
    def render(voice_id, text, output, *args, **kwargs):
        pcm(output)
        return {"words": [{"text": text, "start": 0, "seconds": 0}], "timingSource": provider + "-events"}
    monkeypatch.setattr(native, "render", render)
    job = service.submit({"id": "p", "revision": 1}, {"text": "Alder reads clearly.", "voiceId": row["id"], "strictVerification": True})
    result = finish(service, job)
    assert result["status"] == "ready", result
    assert result["engine"] == provider
    assert result["chunks"][0]["provider"] == provider
    assert result["chunks"][0]["buffering"] == "immediate"
    assert result["chunks"][0]["wordTimings"]
    assert result["chunks"][0]["qa"]["evidence"] == "synthesis-events"
    assert not service.generated and not service.checked


def test_absent_voice_retains_alias_and_does_not_silently_substitute(service, monkeypatch):
    row = voice()
    monkeypatch.setattr(native, "voices", lambda refresh=False: [row])
    service.update_voice(row["id"], name="My narrator")
    monkeypatch.setattr(native, "voices", lambda refresh=False: [])
    missing = next(v for v in service.voices() if v["id"] == row["id"])
    assert missing["available"] is False and missing["name"] == "My narrator"
    with pytest.raises(ValueError, match="not installed"):
        service.submit({"id": "p", "revision": 0}, {"text": "Alder reads clearly.", "voiceId": row["id"]})
    service.update_voice(row["id"], removed=True)
    assert row["id"] not in {v["id"] for v in service.voices()}
    service.update_voice(row["id"], removed=False)
    assert row["id"] in {v["id"] for v in service.voices()}


@pytest.mark.parametrize("provider", ["sapi", "macos", "espeak"])
def test_non_english_missing_timings_never_calls_english_recognition(service, monkeypatch, provider):
    row = voice(provider, "fr-FR")
    monkeypatch.setattr(native, "voices", lambda refresh=False: [row])
    def render(voice_id, text, output, *args, **kwargs):
        pcm(output)
        return {"words": [], "timingSource": provider + "-events"}
    monkeypatch.setattr(native, "render", render)
    result = finish(service, service.submit({"id": "p", "revision": 0}, {"text": "Bonjour le monde.", "voiceId": row["id"]}))
    assert result["status"] == "ready", result
    assert result["chunks"][0]["verificationStatus"] == "warning"
    chunk = result["chunks"][0]
    timings = chunk["wordTimings"]
    # Missing native events use labelled duration estimates, not English ASR.
    assert [word["text"] for word in timings] == ["Bonjour", "le", "monde"]
    assert all(word["estimated"] for word in timings)
    assert valid_timings(timings, chunk["text"], chunk["seconds"]) == timings
    assert timings[0]["startSeconds"] == 0
    assert timings[-1]["endSeconds"] == chunk["seconds"]
    assert [(word["sourceStart"], word["sourceEnd"]) for word in timings] == [(0, 7), (8, 10), (11, 16)]
    assert not service.checked
    strict = finish(service, service.submit({"id": "p", "revision": 0}, {"text": "Bonjour le monde.", "voiceId": row["id"], "strictVerification": True}))
    assert strict["status"] != "ready"
    assert not service.checked


def test_voice_refresh_is_explicit_and_identity_is_stable(service, monkeypatch):
    calls = []
    row = voice()
    monkeypatch.setattr(native, "voices", lambda refresh=False: calls.append(refresh) or [row])
    service.voices(refresh=True)
    assert calls == [True]
    service.update_voice(row["id"], name="New alias")
    assert service._voice(row["id"])["hash"] == row["hash"]


def test_updated_native_voice_cannot_regenerate_an_old_job(monkeypatch, tmp_path):
    row = voice()
    monkeypatch.setattr(native, "voices", lambda refresh=False: [row])
    with pytest.raises(ValueError, match="voice changed"):
        native.render(row["id"], "Alder reads clearly.", tmp_path / "audio.wav", expected_hash="older-voice-revision")


def test_mixed_provider_job_preserves_per_chunk_routing(service, monkeypatch):
    row = voice("espeak")
    monkeypatch.setattr(native, "voices", lambda refresh=False: [row])
    monkeypatch.setattr(service, "_enqueue", lambda job: None)
    p = {"id": "p", "revision": 0, "tracks": [{"id": "t", "voiceId": "default"}],
         "clips": [{"id": "a", "trackId": "t", "text": "First voice."},
                   {"id": "b", "trackId": "t", "text": "Second voice.", "voiceId": row["id"]}]}
    p["placements"] = [{"id": "pa", "clipId": "a"}, {"id": "pb", "clipId": "b"}]
    job = service.submit(p, {"scope": "collation"})
    assert job["engine"] == "mixed"
    assert {c["provider"] for c in job["chunks"]} == {"chatterbox-turbo", "espeak"}
