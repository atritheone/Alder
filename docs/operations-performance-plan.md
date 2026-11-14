# Plan: optimise Alder during everyday work

Date: 14 November 2026. Source reviewed: `57c564b`; installed application measured:
`2ed7b7c`, release 0.13. This is an implementation plan, not a claim that the
proposed operating improvements have already been made.

Implementation is now recorded in
[operations-performance-implementation.md](operations-performance-implementation.md), including
delivered changes, native checks, repeated measurements and unmet/deferred gates.
The investigation and sequence below preserve the original planning evidence.
The subsequent full-plan follow-through is recorded in
[operations-performance-completion.md](operations-performance-completion.md).

## Objective and priorities

Keep writing, selecting, navigating, saving, reviewing and listening responsive
throughout a session, including while background services and exports run.
Optimise the common Windows/Linux/Mac code first, with native qualification on
Windows x64, Linux x64, Apple Silicon and Intel Mac. Preserve document contents,
formatting, history, native-file protections, and acknowledged durable saves.

The first priorities are **save latency and background-work contention**, followed
by **work repeated on every edit and rich-document layout**. Search, narration
throughput, publishing and long-session memory need their own measurements before
large changes. A faster launch does not establish acceptable operating performance.

No application code, settings, dependency pins or installed payload were changed
for this investigation. Diagnostics used synthetic documents and disposable data.
A saved narration manifest was inspected read-only from the existing backup.
No original project was edited, no narration was generated for this study, and
no diagnostic logs or document contents were uploaded. Only relevant operating
probes were run; no full regression suite was run for this planning task.

## 1. Evidence collected

### Interactive Windows baseline

The packaged app opened a small Unicode TXT, a 1 MiB TXT, and a DOCX containing
1,002 paragraphs/approximately 246,000 text characters. After a three-second
settle, the driver typed 18 characters with short gaps, then six characters with
650 ms pauses. It also exercised history and observed subsequent activity.
These runs allow the normal automatic cold services to overlap early document
work; they do not by themselves establish warm steady-state performance.

The following edit timings run from the automation key call to completion of two
animation frames. They include driver and frame overhead; they are **not precise
input-to-paint measurements**. Samples are short diagnostic runs, not reliable
p95 estimates or an OS comparison.

| Scenario | Short-gap edit median / maximum | Paused edit median / maximum | Wait for “Saved” after short-gap loop |
| --- | ---: | ---: | ---: |
| Small TXT | 33 / 44 ms | 37 / 46 ms | 0.82 s |
| 1 MiB TXT, normal services | 70 / 95 ms | 88 / 93 ms | 8.07 s |
| Large DOCX | 176 / 985 ms | 142 / 179 ms | 0.90 s |

The normal 1 MiB TXT also needed 9.28 s for “Saved” after the paused loop. Its
completed project PUTs took approximately 4.18–8.23 s to receive HTTP headers.
One initial probe exceeded its five-second save-status expectation; a follow-up
with a longer allowance observed completion. This was a latency threshold failure,
not evidence that saving failed or that text was lost.

A further **real-feature warm-session** run waited 30 seconds before typing.
The 1 MiB TXT's short-gap edits had a 74 ms median/101 ms maximum, and paused edits
81/96 ms. “Saved” followed the short-gap loop after 1.95 s, but the paused loop
still needed **10.65 s**. The issue therefore cannot be dismissed as launch or
initial model warm-up alone. These few sequences still need the larger P0
baseline and per-stage attribution before a single root cause is asserted.

The rich-document history calls took approximately 510 ms for undo and 546 ms for
redo. A lowercase shifted shortcut in the TXT timing driver did not issue the
intended redo, so that TXT redo timing is excluded. A separate check verified TXT
undo and restoration using `Ctrl+Shift+Z`, `Ctrl+Y`, and the Redo button.

### Controlled background-work isolation

In a **diagnostic-only** run, the main-process fetch wrapper supplied completed
empty proofreading results and suppressed voice preparation. This changed neither
installed code nor user preferences and is not a proposed product solution.

For the same 1 MiB TXT and typing sequence:

- The post-loop “Saved” waits fell to 2.03 s and 1.44 s.
- Completed project PUT header times were approximately 0.95–1.94 s.
- Short-gap edit median/maximum were 60/70 ms; paused edits were 80/92 ms.

This implicates background-work contention/publication as well as the save path.
It does **not** distinguish proofreading from voice preparation, or isolate CPU,
GIL, request scheduling and annotation-rendering contributions. A factorial
comparison and per-stage timings are required before assigning that cost to one
component. Merely bypassing response encoding will not explain an eight-second
save or deliver the entire improvement.

The normal runs also recorded automatic `/api/speech/prepare` calls lasting
approximately 14.1–16.6 s without a request to play audio. Code inspection confirms
that `DocumentReader` schedules preparation 400 ms after voices become ready;
it already has separate preparation hooks on user focus/hover/play actions.

### Data movement and storage

The edited 1 MiB TXT sent approximately **9.33 million characters per project
PUT**. A separately prepared canonical snapshot occupied **9.60 million JSON
characters**. Its seven stored history rows contained about **67.2 million JSON
characters**. This is logical JSON volume, not a measurement of physical disk
allocation or network bytes.

Unprofiled direct `Store.update` calls using the installed Python had medians of
approximately 13 ms for the small TXT, 522 ms for the 1 MiB TXT, and 94 ms for the
large DOCX. These were five metadata updates per case without the normal UI and
background service workload. The canonical DOCX snapshot was 1.62 million JSON
characters. The UI's rich-editor snapshots were about 2.10 million characters,
so these are complementary tests, not identical payloads.

A profiled update attributes substantial cost to complete-project validation,
document migration/normalisation and deep copying. Profiling inflated elapsed
time and is used only for attribution. The current full snapshot is written to
both `projects` and `history`; up to 201 full snapshots can be retained. At this
TXT sample size that can approach 1.9 billion JSON characters per project before
database/WAL overhead. This is an extrapolation, not a measured filled history.

An isolated serializer check on the canonical TXT snapshot measured about 177 ms
for FastAPI's recursive `jsonable_encoder` pass versus about 32 ms for a direct
`JSONResponse`. The resulting JSON values matched. That is a useful smaller
opportunity, not the main explanation for the observed multi-second delay.

### Existing mechanisms to keep

The audit found useful work already implemented. Extend these mechanisms instead
of replacing them with generic suggestions:

- Editor changes use guarded drafts and structural sharing; they do not simply
  deep-copy every old document tree on each key. Other project mutations still
  use full private clones, and autosave still clones the full project. Rich
  `documentJSON` already memoises unchanged ProseMirror branches with a WeakMap.
- CodeMirror renders a viewport, but its update callback converts the whole rope
  to a string and calls `plainTextDocument`, which splits/scans every line while
  reusing unchanged paragraph objects.
- Rich layout already has caches and an unchanged-page-boundary reuse path.
  Establish where those paths miss before rewriting pagination.
- Pattern search already runs in a terminable worker with cancellation and a
  1.5-second timeout. Reuse must preserve the ability to terminate a runaway regex.
- Narration already has bounded delta-event history and a single outstanding
  long poll; publication already uses a serial detached renderer; export jobs
  already have a bounded queue and cancellation/publication handoff.
- Advanced proofreading is already serial, uses a maximum of four inference
  threads, has cancellation checks and releases its worker after inactivity or
  narration demand. Inspect remaining contention rather than proposing those
  mechanisms as new features.

A read-only **base** narration projection for a saved 412-chunk job took a median
of about 3.6 ms and produced roughly 405,000 JSON characters. Full pipeline
eligibility checks, manifest persistence, playback, synthesis and recognition were
not benchmarked. This evidence does not justify making narration projection the
first optimisation target.

### Evidence and code map

Raw local evidence is in `%LOCALAPPDATA%/AlderDiagnostics/operations-20261114/`:
`report.json`, `report-txt-followup.json`, `report-txt-isolation.json`,
`report-txt-warm.json`,
`backend-report.json`, `serialization-report.json`,
`speech-projection-report.json`, and `history-driver-check.json`.
Probe scripts are in ignored `work/operations-investigation-20261114/`.

Primary implementation locations:

| Area | Files |
| --- | --- |
| Project changes, autosave, history and sessions | `frontend/src/useProject.ts`, `editorDraft.ts`, `projectTimeline.ts`, `editorSessions.ts`, `plainTextSessions.ts` |
| TXT edits, counters, metadata and search | `PlainTextEditor.tsx`, `plainTextTools.ts`, `textCounts.ts`, `runPatternSearch.ts`, `patternSearch.worker.ts` |
| Rich editing, layout and derived book state | `Editor.tsx`, `pageFlow.ts`, `columnLayout.ts`, `documentNotes.ts`, `BookWorkspace.tsx`, `App.tsx` |
| Checking and model work | `useProofreading.ts`, `useSentenceRevisions.ts`, `backend/alder/proofreading/{service,engines,worker}.py` |
| Save/API/file binding | `frontend/src/api.ts`, `electron/main.ts`, `electron/documentFiles.ts`, `backend/alder/{app,store,models,document_schema}.py` |
| Narration | `DocumentReader.tsx`, `useSpeechJob.ts`, `speechTransport.ts`, `backend/alder/{speech,speech_pipeline}.py` |
| Publishing | `PublicationPreview.tsx`, `electron/publication.ts`, `backend/alder/{document_exports,publishing}.py` |

## 2. Proposed performance budgets

These are engineering targets to validate, not achieved results or universal
promises. Establish matched baselines on each native runner/device. Cold first
use of a model or Java service needs a separate progress/cancellation budget.

| Operation | Target |
| --- | --- |
| Ordinary typing and selection | In-page input-to-paint p95 ≤50 ms; stress documents ≤100 ms; investigate every repeatable >200 ms stall |
| UI while saving/checking/exporting | Same input budget; no repeated tasks >50 ms caused by background completion callbacks |
| Autosave after a pause, 1 MiB TXT / large DOCX | Latest revision durably acknowledged and UI settled within 1 s on the reference Windows machine; ≤2 s initial cross-platform engineering budget |
| Continuous typing | Add a bounded maximum dirty age instead of an indefinitely reset idle timer; aim for ≤2 s with cheap durable work, without increasing the existing loss window |
| Native Save | Small files ≤250 ms warm; 1 MiB TXT ≤1 s; protect external-change checks and atomic replacement |
| Warm document/chapter/tab switch | Typical ≤100 ms; stress ≤250 ms, with preserved caret, scroll and undo |
| Search | First useful result ≤150 ms typical / ≤500 ms stress; immediate cancellation; no UI thread regex execution |
| Fast proofreading | Warm changed-passage feedback ≤500 ms; whole-document coverage can progress in the background with honest coverage reporting |
| Narration control | Play/pause/stop/cancel acknowledgement ≤100 ms; cached audio start ≤300 ms warm; separately measure cold preparation and first generated audio |
| Preview/export | Progress/cancel acknowledgement ≤100 ms; no editing regression; reduce repeated unchanged-preview work substantially against its own baseline |
| Session resources | Stable memory after repeated open/close/switch cycles; inactive tabs do no checking/layout polling; model workers follow explicit demand and measured idle policy |

Do not enforce the two-frame diagnostic timing as a 16 ms frame benchmark: the
driver itself waits roughly two frames. Collect in-page event/transaction/paint
timestamps for the production acceptance harness.

## 3. Implementation sequence

### P0 — Make the operating baseline reproducible

**First deliverable; small-to-medium effort. Required before performance changes.**

1. Turn the successful diagnostic scenarios into a developer-only operating
   harness. Add exact text/revision assertions before/after edits and history,
   correct platform shortcuts, bounded waits with partial-result capture, and
   clean normal shutdown. Keep driver mistakes distinct from product failures.
2. Add bounded, opt-in operation spans with a common operation/request identifier:
   input/transaction, project change, derived data, React commit, layout, snapshot
   creation, IPC, JSON encode/decode, request queue wait, validation, DB lock wait,
   transaction/fsync, response processing, and “Saved” publication. Record sizes,
   cache hits, queue lengths and cancellation acknowledgement; exclude contents,
   filenames and authored text. Keep normal production collection cheap/local.
3. Measure Electron main/renderer/backend event-loop responsiveness plus CPU,
   process-tree RSS, JS heap, model residency, disk/WAL growth and queue backlog.
   JS heap alone misses Python, Java, inference workers, audio and GPU allocations.
4. Run the factorial baseline: rules on/off, revisions on/off, voice warming
   on/off, cold/warm resources, and typing during export. Diagnostic suppression
   is only an attribution tool; all final acceptance runs use real features.
5. Profile the largest delays with separate CPU/tracing runs. Use a profiling
   build for React commit attribution, and production builds for headline latency.
   React documents the extra overhead of its [Profiler](https://react.dev/reference/react/Profiler).
6. Establish native baselines on all four targets and a 30–60 minute mixed session.
   Keep machine specifications, sample counts, power/thermal state and cold/warm
   status in reports. The existing startup CI cannot stand in for operating tests.

**Exit gate:** identify which stages explain the 8–9 s TXT save, the DOCX tail
stalls and unsolicited voice preparation. Capture at least ten independent
interaction sequences per selected comparison; do not infer p95 from six keys.

### P1 — Stop background work from competing unnecessarily with the author

**Highest measured contention opportunity; several small, reviewable changes.**

1. Replace `DocumentReader`'s unconditional voices-ready preparation with explicit
   demand: entering narration controls, focusing/hovering a relevant play control,
   or a deliberate play/review request. An optional idle warm-up must yield to
   typing/saving and respect CPU/memory pressure. Deduplicate demand for the same
   voice, reference and model across readers; cancel/release unused preparation.
   Preserve existing warm reuse and do not make cold first-use regress invisibly.
2. Introduce a small common job policy: interactive controls and durable saves
   first; current visible-passage checking next; background whole-book analysis,
   previews and speculative preparation last. Bound queues and replace superseded
   jobs by target/revision. Reuse existing serial model and speech coordination.
3. Decouple automatic checking from a mandatory full-project save. Currently
   `useProofreading` waits 350 ms and then calls `flush`, ahead of the 500 ms
   autosave timer; sentence revisions also flush before submission. Submit a
   validated immutable language/configuration snapshot and source version/hash
   instead, so unsaved vocabulary/style changes are represented correctly.
   Removing `await flush()` alone would be unsafe because the backend currently
   reads saved project configuration.
4. Recheck only changed passages plus the context their rules require. Cache by
   passage text, language, dictionaries, rules and model/resource version. Rebase
   valid findings through edit mappings; keep global rules such as bracket or
   document-wide consistency checks correct. Report incomplete coverage honestly.
5. Carry cancellation through the API/IPC layer for read-only requests, polls and
   queued computation. Existing hooks discard obsolete results and issue DELETEs,
   but `api()` does not accept a transport abort signal. Use bounded request IDs
   and cleanup; never treat a disconnected save as proof it did not commit.
6. Coalesce progress/annotation publication, skip unchanged sequences, and suspend
   invisible consumers. Keep precise UTF-16 ranges, language spans, generated-text
   exclusions and stale-source protections.

**Validation:** repeat the default-feature and isolated cases; type during cold
voice preparation/rule startup/model work; switch and close documents mid-job;
verify current dictionary/configuration and cancellation. No quality gate is
relaxed and no feature is silently disabled to obtain better timings.

### P2 — Make saves smaller, shorter and independent of presentation work

**Highest measured data-volume opportunity; staged medium effort.**

**P2a: improve the existing protocol before changing storage formats.**

- Return canonical JSON without FastAPI recursively rebuilding an already JSON
  project tree. First prove response equivalence for normalisation, errors and
  Unicode. Prefer reusing bytes already produced for persistence where practical.
- Instrument and reduce full snapshot clones, JSON passes and cross-process
  transfers. One immutable snapshot per save generation; one save in flight per
  project; coalesce newer dirty work without losing an acknowledged revision.
  Preserve the existing serial/expected-revision guards when older replies arrive.
- Move expensive validation outside the writer's critical section where safe,
  then recheck expected revision and asset/reference invariants inside the short
  commit. Measure before adding a dedicated writer queue or connection reuse.
- Replace `txt-file-fingerprint`'s temporary full TXT export with the same canonical
  byte-encoding path used by actual TXT export, hashed without an intermediate
  temporary document. Cache by content/encoding/BOM/EOL/options revision and
  coalesce obsolete requests. Preserve native-file external-change hashing;
  modification time or byte length alone is not a sufficient replacement.
- Add a maximum dirty-age policy, explicit latest-revision barriers for manual
  Save, tab transitions, export and close, and idempotent request recovery where
  needed. “Saved” must mean the newest acknowledged durable revision.

**P2b: introduce a smaller update contract only if P2a leaves material cost.**

- Submit changed chapters/blocks or validated editor operations against a known
  base revision, not nine million characters for one character edit. The server
  retains canonical unchanged subtrees and validates changed values plus global
  identity/reference invariants.
- Return an acknowledgement with revision/normalisation changes instead of the
  entire project. A bare revision-only response is insufficient if the server
  has assigned block IDs or otherwise canonicalised content. Apply canonical
  patches without resetting the editor or overwriting newer local edits.
- Keep the complete-snapshot route for recovery, older clients, imports and
  fallback. Compare patch results byte-for-byte/structurally with the current
  full validation path before enabling it by default.

Do not use `synchronous=OFF/NORMAL`, omit fsync, shorten history, or weaken
validation to make saving appear fast. SQLite's existing WAL mode already has
concurrency benefits and a single-writer/checkpoint trade-off; tune from measured
lock/checkpoint evidence, not generic advice. See [SQLite WAL](https://sqlite.org/wal.html).

**Validation:** final-character save and close; concurrent edits and stale replies;
retry after uncertain commit; revision conflicts; disk-full/permission failures;
UTF-8/UTF-16/Windows-1252, BOM/EOL; native external modifications; assets and
recovered projects. Simulate interruptions only against disposable profiles.

### P3 — Make the edit path proportional to the change

**High impact for both text engines; medium-to-large effort.**

1. For TXT, consume CodeMirror change ranges. Update affected line records and
   stable block identities rather than splitting and walking the entire string
   on each key. Avoid repeated `doc.toString()` calls in the same transaction.
   Generate a contiguous export/IPC string at deliberate snapshot boundaries.
2. For rich text, measure remaining text projection, ancestor-array scans and
   project-history traversals on transactions. Preserve the existing immutable
   node/`documentJSON` cache, and carry known changed paths through downstream
   consumers using transaction mappings and stable identities. Keep a full
   recomputation path as a correctness oracle and fallback.
3. Cache counts, sentence/word indexes, heading context, reference summaries and
   review maps by unchanged chapter/node and configuration revision. Update only
   affected boundaries; do not rerun all-chapter counts on a one-character edit.
4. Use known changed paths for project history where available, and account for
   retained editor states, ropes and closed tabs in memory budgets. Preserve
   operation grouping and cross-editor/project undo semantics.
5. Use the React measurements to split high-frequency editor/selection/progress
   state from unrelated App panels and inactive workspaces. Supply stable props
   and selectors. Add memoisation at measured boundaries rather than blanket
   `memo` wrappers or expensive deep comparison of whole projects.
6. Consolidate caret, selection, marker and position notifications per frame.
   Small caret movement should not trigger manuscript conversion, full metadata
   serialisation or a whole-workspace rerender.

**Validation:** exact insert/delete/paste/replace results and undo/redo; IME and
Unicode boundaries; newline insertion near large-document beginnings; bookmarks,
notes, comments and tracked changes; raw/rich TXT preservation; unchanged chapter
and block identity. Profile both the editor transaction and downstream callbacks.

### P4 — Complete rich layout incrementally and preserve exact output

**Important for the observed DOCX tail latency; larger effort, after P0/P3.**

- Add cache-hit and invalidation-reason counters to the existing flow cache and
  stabilised-boundary reuse path. Distinguish reflow from annotation-only updates,
  native selection synchronisation and page-thumbnail/snapshot generation.
- Key measurements by node identity/revision, font metrics, layout geometry,
  styles/language, image dimensions and relevant numbering/note state. Batch DOM
  reads and writes and deduplicate invalidations per frame.
- Reflow from the earliest affected block with its previous carry state; stop
  when both physical boundaries and inherited layout state match. Notes, tables,
  section columns, running headings, numbering and page fields can propagate
  beyond the next page and must participate in the stabilisation test.
- Prioritise caret and visible pages, then process remaining pages in cancellable
  slices. Reject work from an older document/layout epoch. Keep selection,
  hit-testing and scroll anchors stable while off-screen layout catches up.
- Avoid rebuilding all preview thumbnails or sheet DOM on ordinary keystrokes.
  Final print/export must wait for the correct complete layout; it must never
  export a provisional viewport-only result.

**Validation:** existing page/caret/scroll oracles plus tables across pages,
columns and continuous sections, footnotes/endnotes, mirrored margins, fields,
font/image changes, zoom/DPI and multi-monitor transitions. Use selected layout
tests matching the changed invalidation paths, not every publishing test.

### P5 — Keep navigation, search and multi-document work responsive

**Medium effort; prioritise from P0 navigation measurements.**

- Switch resident tabs without reparsing unchanged content or recreating their
  editor state. Preserve the dirty-save contract and exact selection/scroll.
  Hydrate nonresident chapters/tabs on demand with bounded concurrency.
- Virtualise long chapter, result, version and narration lists where DOM/profile
  evidence warrants it. Large file syntax/annotation work should follow visible
  ranges, including partially visible long lines.
- Reuse a warm search worker/index by document version where profitable. Apply
  incremental changes or transfer immutable buffers once; hard-abort/reset the
  worker on timeout or cancellation. Retain protections for catastrophic regex.
- Index results and paginate their UI. Preserve atomic replace-all: validate every
  target against its source snapshot before applying any replacement. Group it
  into one recoverable history operation.
- Avoid scanning JSON history snapshots merely to populate version metadata;
  consider indexed version name/time/revision metadata with compatible backfill.

**Validation:** rapid switches during save/checks; restored mixed TXT/DOCX tabs;
long-line search, zero-width regex and catastrophic regex cancellation;
stale results; all-or-nothing multi-chapter replacement and undo.

### P6 — Optimise narration work where measurement warrants it

**Demand scheduling belongs in P1; throughput and library changes follow evidence.**

- Measure cold/warm prepare, first playable verified chunk, real-time synthesis
  factor, recognition/verification time, buffering, pause/seek/stop and cancellation
  while editing. Compare built-in/local neural voices and each OS's system voices.
- Retain delta events. Update only changed chunk identities in the UI instead of
  rebuilding a map/order for the entire job for each small event. Publish playback
  position to the active reader without rerendering unrelated chapter editors.
  Preserve the existing adaptive word timer.
- Measure `_persist`: it currently writes a complete manifest and hashes all
  chunks to produce deltas. Track dirty chunk IDs directly. Coalesce only
  noncritical progress; accepted review decisions, verified audio and event
  sequence acknowledgements must remain crash-consistent and durable.
- Consider a recoverable per-job journal plus periodic manifest checkpoints only
  if large-job write amplification warrants the compatibility complexity.
- Return lightweight job-list summaries and hydrate selected chunk details on
  demand. Bound completed-job residency without evicting in-flight, playing,
  unsaved-review or required reconnect state.
- Keep audio decoding/prefetch bounded. Cache by the complete voice/model/text/
  pronunciation/settings identity, preserving verification and stale-audio guards.

**Validation:** synthetic voice/job fixtures first; short native system-voice
samples; selected real model runs only for throughput changes. Include cancellation,
resume, interrupted manifests, missing chunks, review identity and timing accuracy.
Do not run long model-quality suites for unrelated UI or event-merging changes.

### P7 — Reuse publishing work and propagate cancellation

**Medium effort, measured separately from typing and saving.**

- Retain bounded export queues and the single detached publication renderer.
  Cache reusable semantic/layout preparation by exact source revision, fonts,
  assets, options, review view and rendering/resource version.
- Deduplicate repeated preview requests for the same snapshot. A superseded or
  closed preview should cancel queued/preparing work, not merely discard a late
  result. Preserve the existing asset lease and final publication handshake.
- Profile hidden renderer creation, semantic preparation, PDF generation and
  PDF.js display separately. Reuse a renderer only if gains justify lifecycle,
  isolation, font-cache and memory complexity; always reset document state.
- Load/render the current PDF page and nearby pages rather than large numbers of
  canvases. Reuse immutable PDF data and release workers/canvases promptly.
- Export a frozen revision while editing continues; make revision identity clear
  and reject mismatched layout-field results. Bound CPU/I/O against live editing.

**Validation:** repeated unchanged preview; cancellation at each stage; edit during
export; selected rich DOCX/PDF fixtures with images, fields, notes and tracked
review; output text, pagination and structural fidelity. No full export-format
matrix unless shared publishing code changes.

### P8 — Bound long-session memory and history growth

**Measure early; separate low-risk cleanup from optional storage redesign.**

- Run repeated open/edit/check/preview/close cycles and a longer mixed session.
  Attribute retained heap/native memory by owner: active/resident editors,
  recently closed documents, timelines, DOM snapshots, narration jobs/audio,
  PDF workers, model workers and caches.
- Use weighted, bounded cache residency and explicit disposal. Keep inactive tabs
  free of polling/layout work; release listeners, observers, object URLs, canvas
  backing stores and abandoned worker requests. Extend the existing model idle
  release policy based on measured reuse and memory pressure.
- If full-snapshot history remains a disk/memory bottleneck, design content-addressed
  immutable document/source blobs or a checkpoint-plus-delta history. Preserve
  imported reference content and every promised recovery boundary; never solve
  amplification by silently deleting history or source drafts.
- Keep the current archive/JSON representation as an interchange boundary where
  possible. Any SQLite schema, job-manifest or document compatibility change
  needs an explicit version/migration/rollback design, crash tests and a complete
  verified backup before normal use. Do not assume a particular compatibility
  number or bypass the existing guards.

**Decision gate:** defer a storage-format migration if P1–P5 meet the targets with
acceptable session growth. Its extra risk is justified only by measured remaining
cost. The Electron guidance recommends [profiling resource use and blocking
work](https://www.electronjs.org/docs/latest/tutorial/performance); it is not a
reason to perform a speculative rewrite.

## 4. Native acceptance matrix and workload design

Qualify shared changes on real native runtimes, not platform-name conditionals
or Windows-only elapsed times:

| Target | Required distinctions |
| --- | --- |
| Windows x64 | Native menu/hotkeys, SAPI/system voices, file sharing/locks, high DPI and atomic Save; existing C++ prerequisite stays Windows-only |
| Linux x64 | Native Electron under a graphical session/Xvfb, system voice availability, process-group cancellation and file permissions; no Windows module |
| Apple Silicon | Native ARM64 Electron/Python/models; Cmd shortcuts, App activation, APFS replacement and memory pressure; no Windows module |
| Intel Mac | Native x64 opening/editing/saving/publishing and system-voice paths; explicit rules-only advanced configuration and existing experimental support limitation |

Dataset tiers:

1. Small everyday Unicode TXT/DOCX and a short book.
2. The 1 MiB many-line TXT and 1,002-paragraph DOCX used here.
3. Long-line TXT, mixed EOL/BOM/legacy encodings, larger **supported** documents,
   and books with many chapters/tabs. Retain current import/structured-size guards.
4. Rich tables/images/notes/columns/fields/review fixtures selected for changed
   layout paths; synthetic narration jobs at 10/100/1,000/10,000 chunks.
5. Sustained typing, pauses, large paste, selection, undo/redo, formatting,
   switch/search/replace, background checks, listening, preview/export and idle.

For each meaningful optimisation, run its unit/contract checks plus the affected
operating scenario and native platform checks. Keep model tests to scheduler,
runtime or synthesis changes; keep printing tests to layout/publishing changes.
Do not run full suites for reversible UI or documentation changes. Performance
qualification remains a developer workflow, not an end-user install prerequisite.

Collect median/p95/tail latency from enough repeated interactions, exact document
and history oracles, durable latest revision, event-loop stalls, payload volume,
write amplification, CPU/RSS/heap and cancellation. Compare paired baseline and
candidate builds on the same runner; hosted Mac variability seen during startup
qualification makes universal absolute timing promises inappropriate.

## 5. Delivery order and completion gates

| Wave | Concrete deliverable | Gate to continue |
| --- | --- | --- |
| A | P0 harness/spans, factorial baseline, native operating measurements | Explain the TXT save gap and DOCX stalls with stage-level evidence |
| B | P1 demand-based preparation and checking/save decoupling; P2a response/fingerprint/save cleanup | Real-feature 1 MiB saves improve substantially; typing stays responsive; latest-revision and file-protection checks pass |
| C | P3 incremental edit/derived state and measured P4 cache/invalidation work | Stress typing, history and switching meet budgets; rich layout/export oracles remain correct |
| D | Measured P5/P6/P7 bottlenecks and low-risk P8 disposal | Search, playback and preview remain responsive under concurrent use; session memory plateaus |
| E, conditional | Smaller update protocol and/or versioned storage/history redesign | Simpler work is insufficient; equivalence, migration, recovery and rollback design are reviewed and qualified |

Each wave should consist of small commits on `main`, with before/after evidence
for the particular scenario. Preserve only `main` locally and on origin, as the
repository requires. Maintain startup as a regression control, not the focus of
this programme. Do not change package versions or dependency locks for convenience.

The first implementation patch should be **measurement**, followed by the
unrequested voice-preparation/checking contention fix and save-path cleanup.
Do not begin with a new renderer, a different editor, a model replacement, or a
database-format migration. Re-rank later work from the measured remaining cost.

An optimisation is complete only when its real-feature operating comparison
improves, correctness checks pass, and native platform evidence covers the changed
paths. A single faster first paint, empty diagnostic response, or discarded stale
result is not sufficient. If installing a completed wave for the user, use the
documented update preflight, preserve settings/paths, close normally, make a
verified complete backup, and require passed installed verification. No update
is needed merely to deliver this plan.
