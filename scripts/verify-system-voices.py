"""Render real optional native voices into isolated test storage; never substitute a model."""
import argparse
import json
from pathlib import Path
import sys
import time
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from alder import system_voices


def verify(output, ffmpeg=None, required=False):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    report = {"providers": system_voices.status(refresh=True), "renders": [], "humanListeningApproval": False}
    voices = system_voices.voices()
    try:
        if not voices:
            report.update(status="unavailable", reason="No compatible optional system voices are installed.")
            native_provider = {"darwin": "macos", "linux": "espeak", "win32": "sapi"}.get(sys.platform)
            failure = next((p['reason'] for p in report['providers'] if p['id'] == native_provider and p['reason']), "")
            if failure and not (native_provider == "espeak" and failure.startswith("eSpeak NG is not installed.")):
                raise RuntimeError(failure)
            if required:
                raise RuntimeError(report["reason"])
            return report
        english = [v for v in voices if v.get("culture", "").lower().startswith("en")]
        chosen = english[:2] or voices[:1]
        for v in chosen:
            for index, (text, rate, pitch) in enumerate([
                ("Alder reads clearly. In 1898, Dr. Smith paid $12.50 for café supplies.", 0, 0),
                ("Alder 😀 reads café, naïve words, and repeated repeated words.", 2, 2),
                ("The reader followed each word across the page.", 0, 0),
            ]):
                path = output / f'{v["id"]}-{index}.wav'
                start = time.monotonic()
                response = system_voices.render(v["id"], text, path, rate, 100, pitch, ffmpeg=ffmpeg)
                with wave.open(str(path), "rb") as audio:
                    assert (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) == (24000, 1, 2)
                    duration = audio.getnframes() / audio.getframerate()
                    assert duration > .1
                timings = system_voices.native_timings(response["words"], duration)
                assert timings, "No valid native word events; word highlighting acceptance is pending."
                elapsed = time.monotonic() - start
                report["renders"].append({"voice": v["id"], "culture": v.get("culture"), "file": path.name,
                    "seconds": duration, "generationSeconds": elapsed, "realTimeFactor": elapsed / duration,
                    "words": timings, "nativeEvents": response["words"]})
        report.update(status="passed", scope="native discovery, PCM rendering, controls and word-event bounds; desktop and listening acceptance are separate")
        return report
    except Exception as exc:
        report.update(status="failed", error=str(exc))
        raise
    finally:
        system_voices.shutdown()
        (output / "system-voices.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")


def verify_pipeline(output, ffmpeg):
    from alder.speech_pipeline import SpeechPipeline
    output = Path(output)
    service = SpeechPipeline(output / "pipeline-data", Path(__file__).resolve().parents[1])
    if ffmpeg:
        service.runtime["ffmpeg"] = str(ffmpeg)
    results = []
    try:
        rows = [v for v in service.voices() if v.get("system") and v.get("available")]
        if not rows:
            return {"status": "unavailable"}
        english = next((v for v in rows if v.get("culture", "").startswith("en")), rows[0])
        selected = [english]
        other = next((v for v in rows if v.get("culture", "").startswith("fr")), None)
        if other:
            selected.append(other)
        chinese = next((v for v in rows if v.get("culture", "").split("-")[0] in ("cmn", "zh")), None)
        if chinese:
            selected.append(chinese)
        for row in selected:
            text = ("这是用于测试本地语音的句子我们希望每一个字都能够正确显示。" if row is chinese else
                    "Bonjour le monde. Le café est délicieux." if row is other else
                    "Alder reads clearly. The reader followed every word across the page.")
            for fmt in (["wav", "mp3", "flac"] if ffmpeg else ["wav"]):
                start = time.monotonic()
                job = service.submit({"id": "native-probe", "revision": 1}, {"text": text, "voiceId": row["id"], "format": fmt, "strictVerification": True})
                deadline = time.monotonic() + 60
                while time.monotonic() < deadline:
                    job = service.get_job(job["id"])
                    if job["status"] in ("ready", "failed", "needs_review", "cancelled"):
                        break
                    time.sleep(.02)
                assert job["status"] == "ready", job
                assert all(c["wordTimings"] and c["playbackEligible"] for c in job["chunks"]), job
                assert service.audio_path(job["id"]).stat().st_size > 44
                assert service._process is None and service._qa_process is None, "Native speech launched a model worker."
                results.append({"voice": row["id"], "format": fmt, "secondsToReady": time.monotonic()-start,
                                "job": job["id"], "words": sum(len(c["wordTimings"]) for c in job["chunks"])})
        # A cancellation token must stop a worker and leave it able to restart.
        import threading
        token = output / "cancel.flag"
        token.unlink(missing_ok=True)
        cancelled = None
        started = time.monotonic()
        # Windows SAPI retains its existing bounded-request cancellation behavior.
        if english["provider"] != "sapi":
            timer = threading.Timer(.05, token.touch)
            timer.start()
            cancelled = False
            try:
                system_voices.render(english["id"], "The reader followed every word. " * 10000,
                                     output / "cancelled.wav", ffmpeg=ffmpeg, cancel=token)
            except InterruptedError:
                cancelled = True
            finally:
                timer.cancel()
                token.unlink(missing_ok=True)
            assert cancelled, "Native cancellation did not interrupt rendering."
        system_voices.prepare(english["id"])
        report = {"status": "passed", "jobs": results, "cancellation": cancelled, "cancellationSeconds": time.monotonic()-started}
        (output / "system-voices-pipeline.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        return report
    finally:
        service.shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ffmpeg", type=Path)
    parser.add_argument("--require-voices", action="store_true")
    parser.add_argument("--pipeline", action="store_true")
    args = parser.parse_args()
    try:
        result = verify(args.output, args.ffmpeg, args.require_voices)
        if args.pipeline and result["status"] == "passed":
            verify_pipeline(args.output, args.ffmpeg)
        print(json.dumps({"status": result["status"], "renders": len(result["renders"]), "report": str(args.output / "system-voices.json")}))
    except Exception as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}))
        raise SystemExit(1)
