# Reading performance

The Write reader prepares the selected voice after opening and when the voice
changes. Preparation loads the existing local runtime; it does not synthesize
the manuscript. Idle workers still release their resources after five minutes.
An immediate Play on a cold runtime can still wait for model loading.

Interactive Chatterbox reading begins with a short clause (up to 80 source
characters where complete words and pronunciation rules permit). Following
sections use the normal bounds. SAPI and authored exports retain their normal
segmentation. Chatterbox starts with approximately 20 seconds of buffered listening
time (up to 45 seconds after slow generation), scaled by playback speed. Generation
keeps a bounded 45–90 second reserve ahead and tops it up as playback advances.
It does not render the entire document before starting. Once playback starts,
section boundaries do not trigger another startup wait; a real underrun refills
the reserve before restarting. Short remaining passages start when ready.
SAPI retains its immediate first-section start. Pausing during buffering prevents
autoplay; resuming uses the retained audio.
Content checks, pronunciation mappings, audio integrity checks, and durable saves
remain active.

The visual reading clock leads the audio clock by 40 milliseconds of wall time
to compensate for display scheduling. It scales with playback rate, applies to
both voices, and is disabled while paused; stored alignment timestamps are unchanged.

Normal reading and narration default to advisory wording verification. Healthy,
intact audio remains playable and exportable after a transcription mismatch;
normal reading shows no wording warning and does not interrupt playback. Such
mismatches do not trigger repeated synthesis, splitting or secondary recognition.
Unavailable recognition also produces a warning; highlighting uses only available
matched word timings. Empty, silent, clipped, truncated or damaged audio still
fails the audio checks. Actual generation failures remain errors.

Speech options includes an optional **Strict wording verification** checkbox,
saved with the project and copied into each new job. Strict mode retains bounded
retries, secondary recognition and the narrow spelling-hint recovery introduced
for the September 19 "thebaine" incident. Unresolved strict-mode mismatches still
require listening review before export. Existing jobs retain their saved policy;
legacy jobs without a policy retain strict behavior. Cache identities separate
strict and advisory checks, and wording warnings never become false "matched"
results. Audio hashes remain mandatory in both policies.

SAPI retains its synthesizer between requests, resets rate/volume and output per
render, and detaches each word-event handler after use. Resume verifies retained
audio against its acceptance hash without decoding every saved WAV again. New
jobs publish one fully initialized, compact manifest before entering the queue.

The reader samples the audio clock every 16 ms, updating React at word boundaries.
Text-position mappings have a bounded document cache; unchanged annotations and
word counts are reused. Scrolling occurs only when the spoken word leaves the
viewport. These changes also reduce the main-thread delay before playback
controls can respond.

## Observations on Windows, 19 September 2026

These are local regression measurements, not cross-platform guarantees.

| Measurement | Before | After |
| --- | ---: | ---: |
| Pause / resume / stop on 142 pages | 63 / 55 / 67 ms | 5 / 4 / 6 ms |
| 95th-percentile renderer sampling interval | 32 ms | 18 ms |
| Warm SAPI first accepted audio, short passage | 63 ms | 47 ms |
| Warm Chatterbox first accepted audio, short passage | 4.31 s | 0.81 s |

The neural opening section is intentionally shorter (2.04 seconds of audio,
versus 8.6 previously). In the prepared run, model preparation took 13.36 seconds
before Play; the first uncached take then took 2.67 seconds. Preparation is not
included in the warm result. Renderer measurements use deterministic audio and
measure media events/DOM highlights, not acoustic output latency. Engine timings
use actual SAPI and Chatterbox generation and acceptance.

## Reproduce

With the normal desktop test environment and resource paths configured, run
`node scripts/test-write-reading-desktop.mjs` for caret, progress, page tracking,
spellcheck, and Justify checks. Set `ALDER_READING_PERFORMANCE=1` for the 142-page
playback benchmark and `ALDER_ASSERT_READING_PERFORMANCE=1` to enforce its latency
limits. The fixture and profile use a new temporary directory.

With `PYTHONPATH=backend`, run `python scripts/benchmark-reading-start.py --data
<fresh-external-directory> --engine sapi` or `--engine chatterbox`. `--prepared`
reports preparation separately, and `--paragraphs 1000` exercises job submission
for long manuscripts. Each run preserves its JSON results and generated audio
in the specified directory.
