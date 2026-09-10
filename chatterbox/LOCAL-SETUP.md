# Local Chatterbox

Double-click `Start-Chatterbox.cmd`, wait for the model to load, then open
http://127.0.0.1:7860 in your browser. Keep the launcher window open while using
Chatterbox. Press Ctrl+C in that window to stop it.
If the server is already running, the launcher opens its browser page instead.

This installation uses the official Chatterbox source, Python 3.11, CUDA-enabled
PyTorch 2.6, and Chatterbox Turbo for English voice previews. It runs on the NVIDIA
GPU. The browser interface listens only on this computer; public sharing is off.

- Environment: `%LOCALAPPDATA%\chatterbox\venv`
- Downloaded models: `%LOCALAPPDATA%\chatterbox\huggingface`
- Browser audio cache: `%LOCALAPPDATA%\chatterbox\gradio`
- Portable FFmpeg and ffprobe: `%LOCALAPPDATA%\chatterbox\ffmpeg`
- Installation audio check: `outputs\installation-test.wav`

The environment and models are outside OneDrive. The source and saved output in
this project follow this folder's OneDrive settings. First use downloads model
files; synthesis runs locally. Generated audio retains Chatterbox's built-in
watermark.

For a voice preview, upload approximately 10 seconds of clean speech from one
speaker. The recording must exceed 5 seconds. Leave the recording empty to use the
built-in voice. The interface accepts up to 20,000 characters and automatically
splits the text at sentence boundaries into sections of at most 240 characters
and 45 words. Oversized sentences are split at word boundaries. It prepares the
voice reference once, generates each section independently, and joins the audio
with a 0.18-second pause between sections. This reduces the long-generation drift
observed when a whole passage was sent to Turbo in one call.

The combined WAV, individual section WAVs, and a manifest containing text and seeds
are saved under `outputs\narrations\<timestamp-id>`. A displayed seed lets you repeat
a generation with the same inputs. Individual sections can be reviewed separately;
automatic splitting cannot guarantee every pronunciation or delivery is correct.
For a whole audiobook, work through the chapters and review the results.

MP3 and other compressed reference recordings are converted to WAV with FFmpeg.
The launcher adds the bundled audio tools to its own PATH without changing the
Windows-wide PATH. Both `ffmpeg` and `ffprobe` must be available; the app checks
this at startup. Runtime errors are displayed in the browser's error alert.

FFmpeg uses the Windows essentials build from https://www.gyan.dev/ffmpeg/builds/,
linked by https://ffmpeg.org/download.html. Its archive was checked against the
publisher's SHA-256 checksum before extraction.
Installed audio-tools version: 9.0.1 essentials. Verified compressed-reference
generation through the same API used by the browser: a 9.20-second, 24 kHz WAV
was saved to `outputs\mp3-reference-test.wav`. A reference shorter than 5 seconds
was also checked to ensure the client receives the explanatory error message.

To repeat the GPU and audio check from PowerShell in this folder:

```powershell
& "$env:LOCALAPPDATA\chatterbox\venv\Scripts\python.exe" local_app.py --smoke-test
```

Upstream: https://github.com/resemble-ai/chatterbox

Installed source revision: `5de7a54aa4e5e2baadb0182dde554908b48b85c2`.
Exact installed dependencies are recorded in `local-installed-packages.txt`.
Validation passed: dependency compatibility, CUDA recognition, a 4.76-second
24 kHz speech sample, and generation through the browser interface's API.
The long-passage regression was checked using the same 133-word passage and MP3
reference that previously drifted into gibberish. The four-section result is
46.62 seconds; local Whisper transcription recovered all 133 words, with two
spelling differences (learnt/learned and its/it's) and the final sentence intact.
The splitter tests check text preservation, section bounds, quoted/wrapped prose,
paragraph boundaries, and unusually long words/sentences.

The initial setup started the server in the background (PID saved in
`%LOCALAPPDATA%\chatterbox\server.pid`); its logs are `server.log` and
`server-error.log` in that same directory. This initial process ends on reboot;
use the launcher for later sessions.
