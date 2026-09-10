"""Offline CPU speech recognition, isolated from Chatterbox's NumPy/Torch stack."""
from contextlib import redirect_stdout
import argparse
import json
from pathlib import Path
import sys
import time
import traceback


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    protocol = sys.stdout
    model = None
    health = None
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            if request.get("operation") != "transcribe":
                raise ValueError("Unsupported verification worker operation.")
            with redirect_stdout(sys.stderr):
                from faster_whisper import WhisperModel
                if model is None:
                    started = time.perf_counter()
                    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=6, local_files_only=True)
                    revision_file = Path(args.model) / "revision.txt"
                    health = {"model": "faster-whisper-base.en", "modelRevision": revision_file.read_text().strip() if revision_file.is_file() else Path(args.model).name, "device": "cpu", "computeType": "int8", "modelLoadSeconds": round(time.perf_counter() - started, 3)}
                started = time.perf_counter()
                # No source-text prompt: the recogniser must independently report
                # audio rather than be biased toward the words being checked.
                segments, info = model.transcribe(request["path"], language="en", beam_size=5, temperature=0, condition_on_previous_text=False, vad_filter=False, word_timestamps=True)
                segments = list(segments)
                pieces = [{"text": segment.text.strip(), "startSeconds": segment.start, "endSeconds": segment.end, "averageLogProbability": segment.avg_logprob, "noSpeechProbability": segment.no_speech_prob} for segment in segments]
                words = [{"text": w.word.strip(), "startSeconds": w.start, "endSeconds": w.end} for segment in segments for w in (segment.words or [])]
                response = {"id": request.get("id"), "ok": True, "transcript": " ".join(piece["text"] for piece in pieces), "segments": pieces, "words": words, "language": info.language, "seconds": round(time.perf_counter() - started, 3), "health": health}
        except Exception as exc:
            traceback.print_exc(file=sys.stderr)
            response = {"id": request.get("id"), "ok": False, "error": f"{type(exc).__name__}: {exc}"}
        protocol.write(json.dumps(response, ensure_ascii=False) + "\n")
        protocol.flush()


if __name__ == "__main__":
    main()
