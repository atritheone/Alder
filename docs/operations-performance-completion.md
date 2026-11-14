# Operating optimisation follow-through

Release 0.13, 14 November 2026. This follows the initial delivery in
[operations-performance-implementation.md](operations-performance-implementation.md)
and the original [P0–P8 plan](operations-performance-plan.md).

Status: P0–P8 execution complete, including implementation, measured conditional
decisions and qualification. Ten-sequence native comparisons, exact layout checks,
the 30.5-minute mixed session and final native Save follow-up checks passed.
The proposed latency targets and the remaining platform limits are reported
explicitly below; completion does not imply every operation meets every target.

## Implementation and decisions

| Plan | Delivered work and conditional decisions |
| --- | --- |
| P0 | Linked save-operation identifiers and numeric spans across renderer, Electron and Python; bounded startup/recent telemetry; transaction/layout and opt-in React/CPU profiling; independent and alternating native sequences; service factorial probes; process-tree, heap, DOM, database/WAL and idle samples. Diagnostics use synthetic documents and disposable data. |
| P1 | Explicit narration demand shared across readers and backend callers, with at most two distinct preparations in flight. Saves/controls take priority at cooperative checking/publication boundaries. Passage caches have byte and entry budgets. Global/context-sensitive rules keep their full context. Unchanged checking sequences no longer republish React state. Unsaved checking context, cancellation and quality protections from the initial delivery remain. |
| P2 | Text-only changes are validated against an owned, trusted canonical base; every other change uses full validation. Validation/encoding precede the writer lock; revision is checked again inside the transaction. Copy-on-write patches, one base read, identity-aware corrections and exact raw-size checks remove redundant work. Native plain TXT avoids full body publication preparation, and its expected-byte fingerprint survives disk-identity changes. Complete durable snapshots, 201 history entries, SQLite FULL synchronisation, final-character barriers and conflict recovery remain. |
| P3 | Existing incremental TXT records, immutable projections, chapter counters and timeline accounting are retained. TXT caret metadata no longer serialises the document; hashes are shared by immutable rope identity. Rich document parsing is cached by immutable source ownership. Cached editor state is rebound before creating the view, avoiding a second state/DOM construction. Profiling did not justify a wholesale editor or React architecture replacement. |
| P4 | Ordinary rich-prose reflow uses cancellable approximately 6 ms slices, with document/layout epoch checks and no partial page-map publication. Styled keep chains retain unchanged distant spacers. Coordinate/DOM shortcuts are restricted to ordinary prose. Print and commands requiring complete geometry drain current work. Tables, notes, columns and initial/font invalidations keep complete measurement. Exact fresh-layout and frozen-baseline oracles cover the changed paths. |
| P5 | Warm bounded search workers and atomic replacement protections remain. Resident document models/history are reused and released on close. Version-list metadata has a small RAM cache and a revision-checked, disposable disk cache with compatible on-demand backfill; recovery always reads SQLite. Narration library summaries avoid hydrating every recording, and review renders 50 chunks at a time while preserving unsent notes across pages. |
| P6 | Known dirty chunk identities avoid full delta hashing at safe publication boundaries; structural/recovery callers retain complete comparison. Full manifests are still written before events. Audio integrity metadata has a weighted LRU; inactive durable recordings can leave RAM, while active/in-flight/recently accessed work is retained. Waveform display processes one verified PCM chunk at a time with bounded input, cooperative slices and cancellation; it no longer decodes a complete recording. Peak reuse includes audio hashes, selected takes and timeline geometry. Synthesis, recognition and acceptance algorithms are unchanged. Measurements do not justify a new narration journal or audio format. |
| P7 | PDF preview transport can cancel. Semantic walks check cancellation/priority at safe boundaries. A bounded, consumer-aware cache shares exact frozen PDF/layout work, including styles, assets embedded in the snapshot, options, review view, font-catalogue epoch and renderer lifetime. Cancelling one consumer preserves other consumers; abandoned work aborts. Failed/cancelled work is never cached. HTML stays demand-only. The detached renderer is still destroyed after each real render. |
| P8 | Weighted caches, bounded preparation, bounded review DOM, close disposal and coalesced telemetry writes have explicit ownership. Completed rich-document soaks check selection/history and stable retained resources; the final mixed soak additionally includes TXT search, real native PCM/control/playback and idle residency. Full history remains capped at 201 complete snapshots. A new authoritative history/blob format is not warranted by measured commit latency and would introduce compatibility/recovery risk; no such migration is silently introduced in 0.13. |

## Windows attribution and controlled comparisons

Reference machine: Ryzen 9 9950X3D, 32 logical processors, approximately 46.9 GiB
reported RAM. Production and profiling builds are separate. Local evidence is in
`%LOCALAPPDATA%/AlderDiagnostics/operations-full-plan/`; authored user documents
and the installed profile were not used or changed.

For the 1 MiB TXT, pre-change tracing attributed 325–452 ms to save validation,
109–205 ms to cloning, two full base reads, and 43–90 ms to correction traversal.
After the narrow canonical change path, measured validation was 9–32 ms,
serialization 30–65 ms, the base read 34–59 ms, commit 37–46 ms and corrections
approximately 0.0–0.1 ms. These are attribution samples, not p95 estimates.

The rules/revisions/voice-preparation factorial used all eight on/off combinations,
plus a warmed real-voice case. Suppression is explicitly marked diagnostic and
is never used for acceptance. Each factorial cell is one descriptive sequence;
the independent ten-run comparisons are the native baseline/candidate tests.

| Rules | Revisions | Explicit cold voice preparation | Post-burst Saved wait |
| --- | --- | --- | ---: |
| On | On | Off | 803 ms |
| On | Off | Off | 735 ms |
| Off | On | Off | 872 ms |
| Off | Off | Off | 652 ms |
| On | On | On | 884 ms |
| On | Off | On | 721 ms |
| Off | On | On | 785 ms |
| Off | Off | On | 718 ms |

Cold preparation itself took 12.6–17.4 seconds and remains separately reported.
The real-feature warm case waited 30 seconds after preparation and observed
702 ms/2 ms post-burst/paused Saved waits. Normal document opening made no
unsolicited preparation requests. These small factorial samples do not establish
the relative cost of individual engines statistically.

A separate React profiling run found typical commits around 3.3 ms, whereas the
largest active rich-layout pass took approximately 433 ms. The sliced production
probe observed a largest edit of about 152 ms and measured layout slices at most
13 ms. A real PDF export during rich editing completed in 3.63 seconds, preserved
its frozen source revision, and observed a largest edit of 153 ms.

The edit driver waits for two frames and includes automation overhead. The native
harness also records in-page event timings and two-frame input observations.
These measurements must not be described as a 16 ms frame benchmark or an exact
cross-machine input-to-paint guarantee.

## Native repeated authoring comparisons

The [ten-round native qualification](https://github.com/atritheone/Alder/actions/runs/43579513964)
passed Windows x64, Linux x64, Apple Silicon and Intel Mac. Each runner alternated
baseline (`7226aea`) and candidate order across ten independent sequences per
build, using the same three synthetic fixtures. Default checking paths stayed on;
voice preparation was demand-only, with zero unsolicited prepare requests.
The core candidate was `c49e230`; subsequent waveform, manual Save and file-status
follow-ups have separate targeted native qualification below. The later control
sequences do not replace the ten-run comparison with one-run p95 claims.

| Target | 1 MiB TXT post-burst Saved median, before → after | After maximum | Large DOCX edit-driver p95, before → after | After maximum |
| --- | ---: | ---: | ---: | ---: |
| Windows x64 | 2,350 → 972 ms | 1,018 ms | 618 → 168 ms | 208 ms |
| Linux x64 | 1,815 → 917 ms | 1,191 ms | 350 → 136 ms | 161 ms |
| Apple Silicon | 1,719 → 770 ms | 1,070 ms | 373 → 171 ms | 278 ms |
| Intel Mac | 5,973 → 1,019 ms | 2,726 ms | 739 → 441 ms | 1,180 ms |

These improvements concern save latency and edit tails. They do not imply every
metric improved. DOCX edit-driver medians were 109 → 108 ms on Windows, 84 → 100
on Linux, 85 → 91 on Apple Silicon and 167 → 185 on Intel Mac. DOCX post-burst
Saved medians were 537 → 509, 453 → 482, 229 → 539 and 904 → 783 ms respectively.
The previous checker-triggered flush and the normal autosave timer have different
timing, so a shorter old DOCX wait does not establish cheaper persistence.
Small-file measurements were broadly unchanged. Hosted runner power/thermal state
was not controlled; raw reports record CPU, memory, architecture and sample count.

The narrower in-page beforeinput-to-two-frame p95 observations for DOCX were
131 → 105 ms on Windows, 123 → 83 on Linux, 126 → 109 on Apple Silicon and
571 → 326 on Intel Mac (240 typed inputs per build/target). They still include
two frame intervals. Browser EventTiming also records shortcut interactions and
is thresholded/quantised; its distributions are retained in the raw reports,
including slow history interactions. Neither measurement establishes that every
interaction meets the proposed 50/100 ms targets.

The [final waveform and functional matrix](https://github.com/atritheone/Alder/actions/runs/43581148450)
also passed all four targets, including actual available native PCM ingestion,
selected layout equivalence and preview/cancellation checks. Optional word-event
acceptance remains separately recorded below.

A subsequent native TXT Save probe exposed 1.64 seconds of unnecessary publication
preparation for the featureless 1 MiB body. Its fast path now encodes canonical
plain text once while running normal settings/style validation and warnings on a
small featureless body. Rich content, generated glossary, title/contents and
publication overrides retain the full path. Citation-free manual Save avoids a
private project clone and full JSON signature passes; real citation/bibliography
fields keep formatting and stale-source guards. The fingerprint guard also
respects generated glossary and the publisher's default title setting.

On the full-resource Windows machine, ten actual keyboard Save operations per
fixture preserved every byte, final typed character, encoding/BOM and line ending.
Externally modified source files were refused without alteration. The 1 MiB Save
median fell from 2,227 ms to 633 ms (candidate maximum 1,017 ms). Small UTF-8 and
UTF-16 Save medians were both 73 ms, maxima 136 and 120 ms. The earlier
file-content polling ended before
binding publication; the final driver additionally waits for the durable file
identity, then verifies external-change refusal. Its timing includes 10 ms polling
granularity; full byte-oracle assertions occur outside the measured interval.
An intermediate 840 ms result included those assertions and remains labelled
`correctness-inclusive.json`. Results live in `native-save/` with earlier probes.
The initial plain-export shortcut reduced publication request median from 1,636
to about 172 ms. Removing a redundant fingerprint request then reduced the
measurement from 722 to 633 ms: ten saves made eleven fingerprint requests
(including the opening check), versus twenty-one previously. Expected bytes are
reused by project revision/format when only disk identity changes; comparison
still uses the current disk identity. Superseded read transports abort. Unit
checks cover changed external identities, new revisions and cancellation; source
file hashing and atomic writes remain mandatory.

The [final native follow-up](https://github.com/atritheone/Alder/actions/runs/43584042862)
passed all four jobs at `aff7cbf`, including the current fingerprint reuse,
final-character Save, byte oracle, external-change refusal, selected unit/backend
checks and authoring/layout/preview controls. Ten Save operations per fixture
produced these descriptive results on the hosted core-runtime machines:

| Target | Small UTF-8 median | UTF-16 median | 1 MiB median / maximum |
| --- | ---: | ---: | ---: |
| Windows x64 | 27 ms | 27 ms | 663 / 996 ms |
| Linux x64 | 26 ms | 26 ms | 896 / 1,088 ms |
| Apple Silicon | 44 ms | 51 ms | 1,047 / 2,201 ms |
| Intel Mac | 57 ms | 58 ms | 2,027 / 2,979 ms |

All four observed eleven fingerprint requests per ten saves. Hardware and optional
resources differ, so this table is not an OS speed ranking. The Intel/ARM large-file
tails also show why passing correctness checks is separate from satisfying every
latency target. An earlier Intel probe's five-second import-visibility timeout was
replaced with a bounded 60-second import wait; Save timing and byte/external-change
assertions were retained. The failed fixture report remains available separately.

## Publishing, narration and history

An unchanged PDF requested twice produced identical bytes and created only one
detached renderer: 1,420 ms for the first request, 65 ms for the second. Preview
cancellation acknowledged in approximately 57 ms; reading HTML was prepared only
once on demand. Snapshot changes, font epochs, options and review view invalidate
reuse. Publication tests preserve source-revision and structural/output checks.

Synthetic durable-manifest/delta measurements, ten updates at each size:

| Narration chunks | Complete delta comparison median | Known-dirty comparison median |
| ---: | ---: | ---: |
| 10 | 3.02 ms | 2.99 ms |
| 100 | 3.09 ms | 3.05 ms |
| 1,000 | 8.93 ms | 4.99 ms |
| 10,000 | 68.24 ms | 32.97 ms |

These isolate state persistence and event work, excluding synthesis, recognition
and real audio eligibility. Full manifests, durable review decisions and complete
structural fallbacks remain. Separate real Windows system-voice tests passed six
PCM/word-event samples plus pipeline/cancellation checks. The mixed smoke observed
verified native audio in 267 ms, control acknowledgements in 14–43 ms and muted
browser playback advancing normally. Human listening approval is not inferred.

A separate generated ten-minute PCM waveform comparison observed 571 ms before
and 150 ms after the bounded projector. Sampled renderer working-set increase
fell from approximately 224 MiB to 49 MiB. The original display fetched one
complete recording; the new display fetched ten individual passages and created
no AudioContext/whole-recording decoded buffer. Projection checks cancellation
between small batches and yields after approximately 6 ms of work. This does not
claim every first-display UI task is below 50 ms: the observed candidate had one
63 ms long task. Tests also cover exact peak values, malformed/oversized input,
timing mismatch, cancellation, and changed-audio cache invalidation. Actual native
PCM ingestion is checked separately from native word-event acceptance.

A capacity probe retained all 201 history rows for a 1,062,000-byte synthetic TXT.
The authoritative database occupied 485,015,552 bytes. Median update work was
30.6 ms before the persistent metadata cache and 33.2 ms afterwards; this is a
backend fixture, not the full GUI save. A newly constructed Store's version list
fell from approximately 451 ms to 8.5 ms with a 20,454-byte cache. The cache is
non-authoritative, bounded to 64 files of at most 512,000 bytes each, and ignores
missing, stale, malformed or unwritable entries. Its write failure cannot revoke
an already durable authoring acknowledgement. Existing histories backfill on
first listing. Undo/redo, branch truncation, external writers, recovery and cache
failure have focused checks.

## Long sessions

The matched rich-document baseline and candidate each completed seven cycles over
30.36 minutes, importing three large documents per cycle, editing, previewing PDF
and reading HTML, switching caret/reverse selections, undoing/redoing and closing.

| Closed-document observation | Baseline | Candidate |
| --- | ---: | ---: |
| First / last renderer heap | 22.77 / 23.63 MiB | 22.84 / 23.41 MiB |
| DOM nodes after every cycle | 87 | 87 |
| Event listeners after every cycle | 367 | 367 |
| Largest sampled main-loop delay | 11.6 ms | 13.7 ms |
| Final database bytes | 158,449,664 | 158,449,664 |
| Final WAL / SHM bytes | 0 / 0 | 0 / 0 |

These observations demonstrate bounded retention for these workloads, not zero
growth of authored data or a universal memory ceiling. Immediate closed samples
still include warm neural workers; idle process-tree observations are required
to distinguish retained editor state from intentional model residency.

The final mixed session completed seven cycles over 30.5 minutes. Each cycle added
a roughly 0.5 MiB TXT, edit/search/close operations and three rich-document
edit/switch/preview/close workloads; the first also generated real SAPI audio,
exercised controls and advanced muted playback. There were no application,
selection or history failures. Closed DOM nodes stayed at 71, listeners at 377,
and backing storage at approximately 3.624 MiB. Closed renderer heap rose from
24.19 to 25.89 MiB, with the last three increments 0.31, 0.14 and 0.11 MiB. This
is small slowing growth, not proof of a perfectly flat heap.

Immediate closed process-tree working sets were 5.8–6.0 GiB, including the active
neural worker. Five-minute idle observations fell to 1.51–1.60 GiB as that worker
was released; the grammar Java process intentionally remained warm. Idle handles
did not grow monotonically (8,146 initially; 7,534 last), and the largest sampled
main-loop delay was 15.8 ms. The final synthetic database occupied 229,584,896 bytes
with zero WAL/SHM bytes. Data growth includes newly authored synthetic projects;
it is not an editor heap leak. The workload predates the final manual Save-only
shortcut; that shortcut is covered by the separate native Save probe.

Stress switching remains above the proposed target: the mixed run's driver median
was 329 ms/max 483 ms, and its in-page click-to-two-frame median was 269 ms/max
384 ms. Reusing parsed models removes duplicate parsing/state construction, but
view DOM and complete initial layout are still reconstructed. Cross-view layout
reuse or retaining every DOM view would trade correctness and memory for speed;
neither is introduced without evidence sufficient to justify that tradeoff.

The original latency budgets remain engineering targets, not universal pass
thresholds. Intel-host tails, some stress switches, initial/complex layout,
individual first-display long tasks and cold neural preparation still exceed
some targets. The delivered comparisons demonstrate the gains and expose these
limits instead of suppressing checks or changing quality/history guarantees.

## Qualification boundaries

Only relevant build/type, save/validation/recovery, checking/cache, editor/session,
search, narration state, selected layout, PDF lifecycle and operating probes run.
No complete regression suite or long neural-quality corpus is required for the
unchanged synthesis/recognition algorithms.

Automatic pushes run one paired authoring control sequence; intentional performance
qualification uses workflow dispatch with ten alternating pairs. Native Save has
ten operations per encoding/size fixture, exact-byte and external-change checks.
This avoids repeating a statistical performance study after every focused change.

Native targets are Windows x64, Linux x64, Apple Silicon and Intel Mac. The hosted
fixture contains pinned core Python, bundled fonts and audio converters; optional
grammar/neural models are absent. Full-resource Windows runs exercise real normal
checking and explicit neural preparation. Intel Mac retains its existing
rules-only advanced configuration and experimental platform limitations.

Optional native-voice reports remain separate from editor/save qualification:
Windows samples pass; the hosted Linux image lacks eSpeak NG; hosted Mac voices
produce PCM but have not supplied valid native word events in the short probe.
Those reports remain failed/pending for word-highlighting acceptance. No timing
fallback or speech-quality protection is weakened to turn them into successes.
