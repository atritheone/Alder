"""Private JSON-lines process for the local Chatterbox model; never an HTTP server."""
from __future__ import annotations

import argparse
from collections import OrderedDict
from contextlib import redirect_stdout
import json
import os
from pathlib import Path
import random
import sys
import time
import traceback


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    protocol = sys.stdout
    model = None
    default_conditionals = None
    conditionals = OrderedDict()
    health = None
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            if request.get("operation") != "generate":
                raise ValueError("Unsupported worker operation.")
            with redirect_stdout(sys.stderr):
                import numpy as np
                import soundfile as sf
                import torch
                from chatterbox.tts_turbo import ChatterboxTurboTTS
                if model is None:
                    started = time.perf_counter()
                    device = os.environ.get("ALDER_SPEECH_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
                    if device not in ("cpu", "cuda", "mps"):
                        raise ValueError("ALDER_SPEECH_DEVICE must be cpu, cuda, or mps.")
                    model = ChatterboxTurboTTS.from_local(Path(args.model), device=device)
                    default_conditionals = model.conds
                    revision_file = Path(args.model) / "revision.txt"
                    model_revision = revision_file.read_text().strip() if revision_file.is_file() else Path(args.model).name
                    health = {"device": device, "torch": torch.__version__, "gpu": torch.cuda.get_device_name(0) if device == "cuda" else None, "sampleRate": model.sr, "modelLoadSeconds": round(time.perf_counter() - started, 3), "modelRevision": model_revision}
                reference = request.get("referencePath")
                voice_key = request.get("voiceHash", "default")
                if not reference:
                    model.conds = default_conditionals
                elif voice_key in conditionals:
                    model.conds = conditionals[voice_key]
                    conditionals.move_to_end(voice_key)
                else:
                    model.prepare_conditionals(reference)
                    conditionals[voice_key] = model.conds
                    if len(conditionals) > 8:
                        conditionals.popitem(last=False)
                seed = int(request["seed"])
                random.seed(seed)
                np.random.seed(seed)
                torch.manual_seed(seed)
                if torch.cuda.is_available():
                    torch.cuda.manual_seed_all(seed)
                settings = request.get("settings", {})
                started = time.perf_counter()
                with torch.inference_mode():
                    wav = model.generate(request["text"], temperature=settings.get("temperature", .8), top_p=settings.get("topP", .95), top_k=settings.get("topK", 1000), repetition_penalty=settings.get("repetitionPenalty", 1.2))
                samples = wav.squeeze(0).detach().cpu().numpy()
                if samples.ndim != 1 or not len(samples) or not np.isfinite(samples).all() or np.max(np.abs(samples)) < .00001:
                    raise RuntimeError("Chatterbox returned empty, silent, or invalid audio.")
                output = Path(request["output"])
                output.parent.mkdir(parents=True, exist_ok=True)
                temporary = output.with_name(output.name + ".tmp")
                sf.write(temporary, samples, model.sr, subtype="PCM_16", format="WAV")
                with temporary.open("rb+") as handle:
                    os.fsync(handle.fileno())
                os.replace(temporary, output)
                response = {"id": request.get("id"), "ok": True, "seconds": len(samples) / model.sr, "generationSeconds": round(time.perf_counter() - started, 3), "health": health}
        except Exception as exc:
            traceback.print_exc(file=sys.stderr)
            response = {"id": request.get("id"), "ok": False, "error": f"{type(exc).__name__}: {exc}"}
        protocol.write(json.dumps(response) + "\n")
        protocol.flush()


if __name__ == "__main__":
    main()
