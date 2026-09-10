# Alder speech implementation and verified baseline

Verified 10 September 2026. Alder uses the existing local Chatterbox Turbo source through `backend/alder/speech_worker.py`. The writing service imports no Torch or speech model. It starts one owned, hidden worker only when an uncached narration chunk needs generation.

## Implemented behaviour

- Persistent JSON job snapshots freeze the source project revision, accepted clip variant, ordered/frozen collation placements, selected voice, source wording, narration substitutions, segmentation version, model/source fingerprints, supported sampling settings and per-content seed.
- Sentence and paragraph segmentation preserves every token, conservatively handles English abbreviations and initials, splits oversized sentences at word boundaries, and rejects oversized tokens. Source spans use Unicode code-point offsets, explicitly declared in the job. Exact word timestamps are not claimed.
- Pronunciation replacements are applied once to narration text with source/replacement maps; manuscript text is unchanged. Longest overlapping source phrase wins. Profiles can be scoped to a voice.
- Default voice, immutable imported reference profiles, and clip/track voice inheritance are supported. The worker caches up to eight reference conditionings and explicitly restores built-in conditioning when switching back.
- Every completed PCM WAV and manifest is replaced atomically. Chunk keys include speech content, voice hash, segmentation version, source/model identity, seed and settings. Inserting an earlier sentence retains cache identities and seeds of unchanged sentences.
- Cancellation takes effect at a chunk boundary and preserves completed chunks. Reopening interrupted work requires an explicit Resume. Failed workers are discarded and restarted on retry. Missing saved chunks are detected on reopen and regenerated or recovered from cache.
- Interactive jobs are selected before collation jobs at safe chunk boundaries. A job can be auditioned chunk by chunk before its whole render completes.
- Combined output uses a configurable inter-chunk pause, defaults to 0.18 seconds, and retains Chatterbox's generated watermark. WAV is native; bundled FFmpeg produces MP3 and FLAC. Combined audio exposes chunk start times for playback highlighting.
- Optional automatic content checking uses a second isolated, bundled CPU Whisper worker. Recognition differences can trigger a bounded number of new seeded takes; every take and transcript is retained, and unresolved differences are presented for listening review.
- Worker health records the actual device, Torch version, model load duration and sample rate. Model loading uses a local snapshot with Hugging Face and Transformers offline modes enabled. Opening a document does not start inference or download a model.

Turbo supports voice, variation seed, temperature, top-p, top-k and repetition penalty. Exaggeration, CFG, min-p, SSML/phonemes, exact WPM, model-native streaming and word timestamps are explicitly unavailable. Playback speed belongs to the player rather than generation settings. CPU execution is selected automatically if CUDA is unavailable; `ALDER_SPEECH_DEVICE` is an internal development override.

## Preserved installation and repair

The original Chatterbox environment is `%LOCALAPPDATA%/chatterbox/venv`. Its editable `.pth` and `direct_url.json` referenced the absent former `reference/projects/chatterbox` folder. They now point to `reference/projects/alder/chatterbox`. Exact former files are backed up under `work/speech-baseline/`. The environment had no `pip` module, so only these two path metadata files were repaired; no dependency was installed or upgraded in that environment.

The verified source resolves inside this project's `chatterbox/src`. Its upstream base revision remains `5de7a54aa4e5e2baadb0182dde554908b48b85c2`; Alder also computes a hash of the complete local Python source when forming caches, so local changes are represented independently of Git.

| Component | Verified value |
| --- | --- |
| Python | 3.11 standalone base from the existing uv-managed runtime |
| Chatterbox package | 0.1.7 |
| Torch / torchaudio | 2.6.0+cu124 |
| Transformers | 5.2.0 |
| NumPy / SoundFile | 1.26.4 / 0.14.0 |
| GPU | NVIDIA GeForce RTX 4070 SUPER |
| Turbo snapshot | `749d1c1a46eb10492095d68fbcf55691ccf137cd` |
| Synthesised audio | Mono, 24,000 Hz, PCM 16-bit WAV |

## Actual model checks

The primary fixture was: “Alder brings words to life. Collect an idea, shape a sentence, and hear your language.” Genuine Turbo inference produced two chunks of 2.20 and 3.68 seconds; with a 0.18-second pause the assembled result is **6.06 seconds**. Initial model loading measured **4.972 seconds** on the observed GPU. The first attempted run uncovered Windows rejecting `fsync` on a read-only file descriptor; the worker was corrected to use a writable descriptor and the saved failed job was resumed successfully.

A separate long-lived worker generated built-in voice → imported reference voice → built-in voice. The final built-in WAV was **byte-identical** to the first at the same seed and text, confirming restoration after mutable reference conditioning. The three samples were 2.00, 2.26 and 2.00 seconds. The warm generations measured 0.411 and 0.396 seconds for this small fixture; these are observations rather than throughput guarantees.

MP3 (54,164 bytes) and FLAC (150,457 bytes) were then assembled through the installed FFmpeg binary from the real cached fixture. Both completed successfully and reused every synthesis chunk.

Machine-readable evidence and audio remain under `work/speech-baseline/result.json`, `extended-result.json`, `voice-switch/`, and `data/speech/jobs/`. These are development verification assets, not samples masquerading as live synthesis. Delivery/pronunciation quality still requires listening review. Jobs without automatic content checking remain `reviewStatus: unreviewed`; forced word alignment remains deferred and `alignment` is always `chunk`.

## Optional automatic speech-content checks

Submit narration with `verify: true` to check each generated chunk with the bundled `faster-whisper-base.en` model. `verificationRetries` is an integer from 0 to 2, default 1. Existing requests remain unchanged and default to no automatic check. The availability and actual worker health are reported under `capabilities.verification`.

The worker recognises audio independently, without supplying the expected wording as a prompt. It uses CPU int8, beam size 5, temperature zero, no previous-text conditioning, and local files only. The expected text is the explicit pronunciation projection, while authored wording remains frozen and unchanged.

Comparison ignores casing, Unicode presentation differences and sentence punctuation. It preserves apostrophes, numbers, spelling variants and homophones. The prior audiobook's replacements such as eye → I, site → sight and patients → patience are deliberately absent: a recognition difference remains visible rather than being treated as a meaning-preserving substitution. This conservative policy can flag valid readings such as “12” versus “twelve”; listening review resolves those cases.

Each chunk's `qa` reports `status` (`matched`, `needs_review`, `error`, or `pending`), expected and recognised text, word error rate, token differences, model/comparison versions and timestamps. `qaAttempts` retains each tested take's seed, audio filename and full check. `selectedAttempt` and `selectedSeed` identify the retained take. Recognition segment times are observations from ASR, not forced alignment or word timestamps.

An unmatched first take can trigger up to the requested number of new generations. Attempts have deterministic separate seeds and persistent cache identities. All audio and results are retained atomically; the take with the smallest observed word error rate is selected. A recogniser error immediately requires review and does not provoke speculative synthesis. Cancellation during a check preserves completed attempts, and Resume continues the remaining bounded work.

The combined job remains playable with `status: ready`. `reviewStatus: content_checked` means every recognised word matched the spoken projection under the declared comparison. `reviewStatus: needs_review` means a difference or recogniser error remains. `verificationSummary` counts both outcomes. Neither status establishes natural delivery or correct prosody, and ASR cannot disambiguate all homophones. User listening review remains part of production.

Listening decisions are saved through `POST /api/speech/jobs/{jobId}/review` with `{chunkId?, accepted: boolean, note?: string}`. Omit `chunkId` to review all selected chunks together. Acceptance requires completed audio and any requested content checks. The review panel asks the author to confirm listening, permits a note and supports revocation. Every decision records its timestamp, frozen source revision, selected take/seed, audio SHA-256 and render identity, with the latest 50 decisions retained per chunk. `manualReviewStatus` (`unreviewed`, `partial`, `accepted`) and `manualReviewSummary` remain separate from the unchanged ASR result. Accepting a differing take does not turn its recognition check into a match. Decisions survive reopening; replacement takes with different identities are not covered by old acceptance.

The narration panel exposes boundary pause (0–5 seconds), the bounded content-check retry count (0–2), and an advanced Turbo sampling panel for temperature, top P, top K and repetition penalty. These settings are saved with the project and frozen into each request. A separate playback-speed control changes audition speed; it does not promise model-native exact WPM or prosody.

The actual packaged base.en worker checked the previous 1.60-second CPU smoke WAV, “An idea takes shape.” It recovered all four words with **word error rate 0**, no differences and no synthesis retry. Total time was **1.41 seconds**, including **0.272 seconds** model loading and **0.359 seconds** recognition. Evidence is `work/speech-baseline/portable-qa-result.json`.

## Self-contained application resources

The prepared `work/bundle-resources/speech/` tree includes:

| Relative path | Included content |
| --- | --- |
| `python/` | Standalone Python 3.11 base and the complete verified speech dependency environment; no external Python or pip required |
| `chatterbox/src/` | Existing project source with a portable relative editable-package path |
| `models/turbo/` | Required Turbo weights, built-in voice conditioning, tokenizer files and original `revision.txt`; no first-use model download |
| `ffmpeg/` | FFmpeg, ffprobe and distributed license/readme |
| `qa/python/` | Separate standalone Python and the verified Faster Whisper/CTranslate2/PyAV environment, avoiding Chatterbox's incompatible NumPy constraints |
| `qa/models/base.en/` | Offline base.en model snapshot `3d3d5dee26484f91867d81cb899cfcf72b96be6c` |
| `bundle-manifest.json` | Build details and byte size |

The initial synthesis resource tree is **8,600,938,896 bytes**; the QA addition is **459,660,444 bytes**, approximately **9.06 GB** combined before installer compression. Synthesis deliberately excludes the unrelated 1.056 GB `s3gen.safetensors` checkpoint, which Turbo's `from_local` does not load. Python, Chatterbox and FFmpeg license files plus dependency package metadata are retained. The repeatable production helper is `scripts/prepare-speech-resources.py --verify`; installer assembly owns final compression and placement. It accepts explicit source environment/model paths, copies the verified versions offline, records exact package versions, removes local installation URL/egg-link metadata and stale bytecode, rewrites Chatterbox's editable path relatively, and verifies both standalone import trees. Its latest combined resource manifest reports **9,063,634,699 bytes**. It records no private source installation paths. The QA environment preserves Faster Whisper 1.2.1, CTranslate2 4.8.2, PyAV 18.1.0, NumPy 2.4.6, ONNX Runtime 1.29.0 and Tokenizers 0.23.2.

The standalone executable was launched with an empty `PYTHONPATH` and user-site imports disabled. Its Python base, imported Chatterbox and imported Torch all resolved inside the prepared resource tree. A genuine **CPU-only** synthesis using this tree produced **1.60 seconds** of audio for “An idea takes shape.” in **22.02 seconds** total including startup and a 4.713-second model load. It used the packaged weights and executable, with no model download. The machine-readable result is `work/speech-baseline/portable-cpu-result.json`.

When `ALDER_RESOURCES_DIR` is set, speech resolves exclusively against that resource tree (unless an explicit development override is supplied). Missing packaged resources cannot be silently concealed by the developer's original installation. Worker child processes have user-site imports disabled. Source and weights are read-only at runtime; voice profiles, cache, job manifests and logs go under Alder's writable application data directory.

## Focused regression checks

`backend/tests/test_speech.py` has 21 passing checks covering token/span preservation, long sentence bounds, nonrecursive voice-scoped pronunciation, revision freezing, selected variants, real PCM assembly semantics, stable cache reuse, cancellation/resumption, worker failure recovery, restart recovery, frozen collation ordering, invalid media access/settings, voice reference bounds, packaged resource discovery, conservative ASR comparison, bounded retry selection, recogniser failure, cancellation/resumption during verification, and persistent listening acceptance/revocation without rewriting recognition evidence. The unit suite injects explicitly labelled PCM fixtures at the worker boundary; it does not substitute fake audio for application inference.

The six real-browser workflows cover authoring/alternate takes/reopening/export, project dictionary persistence, frozen placements, definition-card PNG production, rejected voice references, and actual local narration with independent recognition, waveform decoding and WAV download. The review panel shows original, spoken and recognised wording, all saved take checks and playable take audio. Exact word alignment, other Chatterbox model families/languages, simultaneous speech and chaptered/loudness production profiles remain later features as specified in the plan.

The final six-workflow run passed in 37.8 seconds. Its narration workflow also verified saved boundary-pause/retry settings, explicit listening acceptance with note and audio hash, unchanged recognition evidence, reopening and revocation. The inspected expanded review screenshot is retained at `work/speech-baseline/narration-review.png`.
