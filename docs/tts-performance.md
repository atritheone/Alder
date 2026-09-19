# Reading performance

The Write reader prepares the selected voice after opening and when the voice
changes. Preparation loads the existing local runtime; it does not synthesize
the manuscript. Idle workers still release their resources after five minutes.
An immediate Play on a cold runtime can still wait for model loading.

Interactive Chatterbox reading begins with a short clause (up to 80 source
characters where complete words and pronunciation rules permit). Following
sections use the normal bounds. SAPI and authored exports retain their normal
segmentation. Playback starts as soon as the first section is accepted, while
bounded lookahead generates and preloads the next sections. Content checks,
pronunciation mappings, audio integrity checks, and durable saves remain active.

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
