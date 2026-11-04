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

The word scheduler uses the audio clock directly, waking at the next word
boundary with a 16 ms watchdog. Highlight updates bypass React; stored alignment
timestamps are unchanged. Seeks and paused positions update explicitly.

Normal reading and narration default to advisory wording verification. Healthy,
intact audio remains playable and exportable after a transcription mismatch;
normal reading shows no wording warning and does not interrupt playback. Such
mismatches do not trigger repeated synthesis, splitting or secondary recognition.
Unavailable recognition also produces a warning; unmatched words use bounded
timing estimates between available alignment anchors. Empty, silent, clipped, truncated or damaged audio still
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

The reader samples the audio clock at word boundaries, at least every 16 ms.
Precise playback position is retained outside React; the status bar rerenders
when its displayed percentage, time estimate or physical page changes.
Text-position mappings have a bounded document cache; unchanged annotations and
word counts are reused. Scrolling occurs only when the spoken word leaves the
viewport. These changes also reduce the main-thread delay before playback
controls can respond. Native and neural generation have separate locks, so loading
Chatterbox for Sandbox cannot hold up SAPI. Identical native takes still serialize
and reuse their verified cache entry.

## Concurrent reading, 3 November 2026

An isolated Windows x64/Ryzen 9 9950X3D/Cambria run used a 125-page, 500-paragraph
document, actual Microsoft David SAPI audio at 1.5× and 222 native keystrokes in
Sandbox while Write narrated. Audio was muted; these are media-clock and DOM
measurements, not acoustic latency or cross-platform certification.

Play to first media playback improved from 43.38 s to 0.89 s. Two independent
causes were removed: sentence splitting repeatedly scanned the entire preceding
paragraph (41.41 s to 0.02 s for the same 4,500 chunks), and neural preparation
held the native generation lock. Voice preparation was measured separately at
109 ms. Job submission took 330 ms. Typing latency was 32.3 ms p95, frame intervals
16.9 ms p95, and pause/resume/stop 10.4/3.1/9.3 ms. Eight audio sections played.
Of 1,403 sampled highlighted words, 1,380 matched the current engine interval;
boundary samples and alignment gaps require interpretation. Exact acoustic word
alignment and complete underrun qualification remain open.

The reproducible fixture is `scripts/test-native-reading-performance.mjs`.
It uses a fresh external profile and records timings, media events, word samples
and limitations under `work/native-reading-performance`. Set
`ALDER_READING_ENGINE=chatterbox` to exercise the neural engine separately.

The extended Chatterbox run uses varied sentences (126 pages) and
`ALDER_READING_SAMPLE_SECONDS=60`: 666 native keystrokes overlap 25 audio sections.
Preparation takes 15.90 s separately; Play then waits 12.75 s for the rolling
reserve. Typing p95 is 32.2 ms, frames 16.8 ms, and pause/resume/stop
9.7/2.6/12.3 ms. There are no in-section media waits. The 24 section transitions
take at most 154 ms, including the configured 180 ms pause divided by 1.5× speed;
the maximum additional delay is 34 ms. 3,600 of 3,687 sampled words match the
engine interval. This is a local, approximately one-minute concurrency sample,
not a guarantee of indefinite generation throughput or perfect acoustic alignment.

## Large-document qualification, 4 November 2026

Production narration plans detailed metadata in batches of 64 source spans above
250,000 characters. This removes the former two-million-character rejection in
the production pipeline, while preserving the 40 MB authored-text envelope.
Only lightweight source boundaries are collected up front. The durable planning
cursor preserves pronunciation boundaries, voice assignments, seeds and Unicode
positions; event updates distinguish a batch boundary from the end of the text.
The existing rolling audio reserve still limits synthesis. Export explicitly
requests the full recording and waits until all remaining source is processed.

On the Windows/Ryzen/Cambria baseline, a 1,001-page hyphenated manuscript with
479,959 words opens in about 38 seconds. SAPI submission takes 568 ms and Play
starts in 1.66 seconds. Chatterbox submission takes 514 ms and Play waits 10.50
seconds for its reserve. During 222 native Sandbox keystrokes, SAPI/Chatterbox
typing p95 is 50.8/49.8 ms and frame p95 16.9/16.8 ms. Neither run has mid-section
media waits (nine and eleven played sections respectively). Pause/resume/stop
measure 85.8/9.7/50.6 ms for SAPI and 82.4/12.4/56.6 ms for Chatterbox.

These runs use `ALDER_READING_PARAGRAPHS=4000` and
`ALDER_READING_HYPHENATION=1`. They are short concurrency samples with muted
media-clock measurements, not cold-model or acoustic certification. Sampled
highlights match engine intervals on 1,789/1,825 SAPI frames and 1,375/1,461 neural
frames; boundary/gap discrepancies and exact acoustic alignment remain open.
With `ALDER_READING_BATCH_BOUNDARY=1` and `ALDER_READING_SAMPLE_SECONDS=55`, a
separate 128-page native fixture plays 87 sections across the initial 64-section
plan without mid-section waits; the largest delay beyond the configured pause
is 35 ms.

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
