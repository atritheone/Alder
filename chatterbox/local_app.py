"""Local Chatterbox Turbo launcher and installation smoke check."""
import argparse
import json
import os
from pathlib import Path
import shutil
import time
import secrets
from datetime import datetime

DATA = Path(os.environ["LOCALAPPDATA"]) / "chatterbox"
os.environ.setdefault("HF_HOME", str(DATA / "huggingface"))
os.environ.setdefault("GRADIO_TEMP_DIR", str(DATA / "gradio"))
os.environ.setdefault("GRADIO_ANALYTICS_ENABLED", "False")
# Configure the portable audio tools before Gradio/pydub resolve their executables.
for ffmpeg in sorted((DATA / "ffmpeg").glob("*/bin/ffmpeg.exe"), reverse=True):
    if ffmpeg.with_name("ffprobe.exe").is_file():
        os.environ["PATH"] = str(ffmpeg.parent) + os.pathsep + os.environ.get("PATH", "")
        break

import numpy as np
import soundfile as sf
import torch
from chatterbox.tts_turbo import ChatterboxTurboTTS
from narration import split_narration


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--smoke-test", action="store_true")
    args = parser.parse_args()
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable. Check the NVIDIA driver and GPU PyTorch installation.")
    print(f"GPU: {torch.cuda.get_device_name(0)}; PyTorch: {torch.__version__}", flush=True)
    model = ChatterboxTurboTTS.from_pretrained(device="cuda")
    default_conds = model.conds

    if args.smoke_test:
        torch.manual_seed(42)
        started = time.perf_counter()
        wav = model.generate("The local Chatterbox installation is ready. Our audiobook journey begins here.")
        samples = wav.squeeze(0).numpy()
        assert np.isfinite(samples).all() and np.max(np.abs(samples)) > 0.001
        output = Path(__file__).parent / "outputs" / "installation-test.wav"
        output.parent.mkdir(exist_ok=True)
        sf.write(output, samples, model.sr)
        print(f"PASS: {len(samples) / model.sr:.2f}s audio, {model.sr} Hz, generated in {time.perf_counter() - started:.2f}s. Saved: {output}", flush=True)
        return

    import gradio as gr

    missing_tools = [name for name in ("ffmpeg", "ffprobe") if not shutil.which(name)]
    if missing_tools:
        raise RuntimeError(f"Missing audio tools: {', '.join(missing_tools)}. Install FFmpeg with ffprobe under {DATA / 'ffmpeg'} or add both tools to PATH.")

    def generate(text, reference, seed, progress=gr.Progress()):
        if not text.strip():
            raise gr.Error("Enter some text to narrate.")
        if len(text) > 20000:
            raise gr.Error("Use up to 20,000 characters per narration. Split larger chapters into separate passages.")
        try:
            chunks = split_narration(text)
        except ValueError as exc:
            raise gr.Error(str(exc)) from exc
        seed = int(seed or secrets.randbelow(2**32))
        progress(0, desc="Preparing voice")
        if reference:
            info = sf.info(reference)
            if info.duration <= 5:
                raise gr.Error("Use a reference recording longer than 5 seconds; around 10 seconds works well.")
            model.prepare_conditionals(reference)
        else:
            model.conds = default_conds
        output_dir = Path(__file__).parent / "outputs" / "narrations" / (datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3))
        output_dir.mkdir(parents=True)
        records = []
        audio = []
        for index, chunk in enumerate(chunks):
            progress(index / len(chunks), desc=f"Narrating section {index + 1} of {len(chunks)}")
            torch.manual_seed(seed + index)
            started = time.perf_counter()
            try:
                wav = model.generate(chunk)
                samples = wav.squeeze(0).numpy()
                if not np.isfinite(samples).all() or not len(samples):
                    raise RuntimeError("The model returned invalid audio.")
            except Exception as exc:
                raise gr.Error(f"Section {index + 1} of {len(chunks)} failed: {exc}. Completed sections are saved in {output_dir}.") from exc
            filename = f"section-{index + 1:03d}.wav"
            sf.write(output_dir / filename, samples, model.sr)
            records.append({"text": chunk, "file": filename, "seed": seed + index, "seconds": len(samples) / model.sr})
            print(f"Section {index + 1}/{len(chunks)}: {len(chunk)} chars, {len(samples) / model.sr:.2f}s audio in {time.perf_counter() - started:.2f}s", flush=True)
            if index:
                audio.append(np.zeros(round(model.sr * 0.18), dtype=np.float32))
            audio.append(samples)
            (output_dir / "manifest.json").write_text(json.dumps({"seed": seed, "sections": records}, indent=2, ensure_ascii=False), encoding="utf-8")
        output = output_dir / "narration.wav"
        sf.write(output, np.concatenate(audio), model.sr)
        progress(1, desc="Narration ready")
        return str(output), f"Generated {len(chunks)} sections with seed {seed}. Listen through before using the narration. Each section is also saved separately."

    with gr.Blocks(title="Chatterbox Local") as demo:
        gr.Markdown("# Chatterbox Local\nNarrate an English passage. Longer passages are automatically split into short sections and joined into one audio file. Upload a clean voice recording of about 10 seconds, or leave it empty to use the built-in voice.")
        text = gr.Textbox(label="Text to narrate", lines=6, value="The local Chatterbox installation is ready. Our audiobook journey begins here.")
        reference = gr.Audio(label="Voice reference (optional)", sources=["upload", "microphone"], type="filepath", format="wav")
        seed = gr.Number(label="Seed (0 for a new variation)", value=0, precision=0)
        button = gr.Button("Generate narration", variant="primary")
        output = gr.Audio(label="Narration", format="wav")
        status = gr.Textbox(label="Generation details", interactive=False)
        button.click(generate, [text, reference, seed], [output, status], concurrency_limit=1)
    demo.queue(max_size=10, default_concurrency_limit=1).launch(server_name="127.0.0.1", server_port=7860, share=False, inbrowser=False, show_error=True)


if __name__ == "__main__":
    main()
