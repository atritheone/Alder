# Operating performance implementation record

Release 0.13, 14 November 2026. This records execution of
[the operating performance plan](operations-performance-plan.md). Work is on
`main`; package versions, dependency locks, document compatibility, database
schema and installed user data are unchanged.

## Delivered changes

### Background checking and narration demand

- Removed the unconditional voices-ready preparation in `DocumentReader`.
  Existing focus, hover and deliberate playback preparation remain available.
- Automatic rules and sentence review submit a validated, request-owned language,
  dictionary and rule configuration. They no longer force a complete project save
  before submitting their work. Legacy saved-context requests still work.
- Fixed quadratic UTF-16 conversion in sentence preparation: the manuscript is
  encoded once and sentence slices use that buffer. UTF-16 source coordinates,
  language exclusions and proposal quality checks remain intact.
- Moved sentence preparation into the existing serial advanced-work queue.
  Superseded queued jobs skip preparation; running preparation checks cancellation
  between passages. Preparation no longer runs while holding the job registry
  lock. Whole-document coverage and the existing model verification policy remain.
- Rules/revision polls and narration long polls now carry cancellation through
  the frontend, preload bridge and Electron fetch. Ownership is bounded to 64
  outstanding cancellable requests. Closing the window aborts its observations.
  Job submissions still obtain an identity and explicitly cancel the job, avoiding
  abandoned jobs whose creation response was lost.

### Saving and native TXT fingerprints

- Retain one immutable request snapshot instead of cloning the whole project
  before each autosave. Preserve serial saves and expected-revision guards.
- Cap the idle timer's postponement at two seconds of dirty age. This bounds when
  a save is requested; durable acknowledgement can take longer than two seconds.
- Send at most 64 changed JSON paths against the last acknowledged snapshot.
  Missing bases or larger changes use the full-snapshot route. Stop calculating
  transport differences as soon as the limit is exceeded.
- The backend reconstructs an owned snapshot, validates the **whole project** and
  rechecks the expected revision inside the existing commit transaction. A writer
  racing the reconstruction is rejected; no partial correction is committed.
- Return canonical corrections and the saved revision rather than another whole
  manuscript. Apply them to their exact request snapshot. A newer local edit is
  retained and saved against the acknowledged revision. Large normalisations use
  the complete canonical response; older full-snapshot callers remain supported.
- A local edit followed by its exact reversal before autosave needs no redundant
  database revision. Manual Save/close still await any real dirty work in flight.
- Return project JSON directly instead of recursively rebuilding it through
  FastAPI's generic encoder. Add bounded validation/serialisation timings to the
  existing local performance report.
- Plain text/paragraph nodes without formatting take a specialised path through
  the document validator. Node count/depth/types/text/content checks still run on
  every node, and global move/list/identity checks remain. Formatted/object nodes
  retain the general path. Two hundred generated Unicode documents, malformed
  nodes and limit cases are compared against that general path; a paired native
  benchmark checks the same output on each interpreter.
- Fingerprint eligible plain TXT with the canonical encoding/BOM/EOL byte path,
  without constructing a temporary publication. Rich or unsupported TXT structures
  retain the publisher fallback. External-file content hashing is unchanged.

Full snapshots are still stored durably in projects/history with SQLite
`synchronous=FULL`. This is a transport improvement, **not a storage migration**.
The larger request limit, full validator, assets/source protections, recovery
history and compatibility guards remain in place.

### Editing, derived data, search and retained state

- TXT consumes CodeMirror change ranges and rebuilds touched line records while
  retaining unaffected paragraph identities, including after newline insertion.
- Chapter word/sentence counts and optional reading indexes use weak caches keyed
  by immutable chapter and text. Unchanged chapters avoid repeated scans.
- History size accounting caches immutable subtree weights. Estimates are
  conservative when branches are shared; existing bounded local history remains.
  Identity maps for structural sharing are constructed only when ordering changes.
- Completed pattern-search workers are reused, with at most two idle workers and
  a 30-second expiry. Cancellation, errors and timeouts destroy the worker, retaining
  protection against catastrophic regular expressions.
- Narration delta batches construct one chunk map/order per batch, skip already
  applied sequences and retain audio eligibility protections.
- The recently closed list retains saved project identities, replacing up to
  twenty resident manuscript snapshots. Reopen reads the latest durable revision;
  a failed read stays available for retry. Closing the last project also releases
  the save-base reference. Active document/caret/history behaviour is preserved.

### Publication preview

- Reading HTML is prepared when reading mode is selected and reused when switching
  preview modes. Opening a PDF no longer also requests an unused HTML publication.
- Closing a preview aborts its desktop request. Cancelled queued PDF work skips
  renderer creation; active detached PDF renderers are destroyed and the queue
  remains usable. Save and job-submission requests cannot be transport-aborted.
- Existing frozen publication identity checks, final PDF verification, serial
  renderer ownership, single-page PDF.js canvas and worker disposal remain.
- An already executing Python publication preparation can finish after its HTTP
  consumer disconnects. This change prevents subsequent detached rendering and
  discards the response; it does not claim to interrupt arbitrary Python/library
  calls in the middle of execution.

## Measurement and correctness evidence

`scripts/developer/benchmark-operations.mjs` runs disposable native Electron
profiles with small Unicode TXT, 1 MiB TXT and 1,002-paragraph DOCX fixtures.
It asserts exact durable text after 18 short-gap edits, six paused edits and
undo/redo; checks renderer errors and unsolicited voice preparation; records
save traffic, beforeinput/two-frame observations, long tasks and heap samples.
It supports repeated independent runs and records machine and settle settings.

Ten independent Windows trials for each stress fixture passed during development:

| Observation | 1 MiB TXT | 1,002-paragraph DOCX |
| --- | ---: | ---: |
| Median wait for Saved after short-gap loop | 1,887 ms | 292 ms |
| Range of those waits | 1,759–2,340 ms | 200–383 ms |
| Median remaining wait after paused loop | 959 ms | 3 ms |
| Median automation key-to-two-frames | 84 ms | 124 ms |
| Median in-page beforeinput-to-two-frames | 56 ms | 70 ms |
| Largest observed automation edit | 161 ms | 750 ms |

The original Windows diagnostic observed TXT waits of 8.07/9.28 seconds in an
early session and 1.95/10.65 seconds in a warm session; the rich edit median/max
were 176/985 ms. The earlier probe used a shorter settle and coarser save-status
polling. These are useful directional observations, **not a matched percentage
speedup claim** or a precise OS comparison. Two animation frames are a proxy,
not a measurement of the compositor presenting pixels.

Typical stress TXT update requests fell from about 9.33 million JSON characters
to 1.06 million, with 126-byte canonical correction responses. Warm rich updates
were about 247,000 characters; the initial rich editor normalisation can require
a full approximately 2.10 million-character request. This is why both request and
response fallbacks, and bounded difference calculation, matter.

The repeated rich trials preceded the final bounded difference/no-op-save cleanup.
Final native qualification below exercises those later changes. Short candidate
runs and hosted runners cannot establish universal tail-latency guarantees.

The native preview lifecycle probe passed on Windows with about 38 ms from
Back To Write to observed transport abort. It subsequently rendered a real PDF,
confirmed zero reading-HTML requests in print mode, one request on entering
reading mode, reuse across mode switches, and unchanged source text.

A three-cycle Windows residency probe opened, edited, switched and closed nine
400-paragraph rich Markdown documents. Selection and undo/redo checks passed.
After close, retained renderer JS heap measured 21.68, 22.08 and 22.07 MiB;
DOM nodes (84), listeners (365) and connected elements (36) were unchanged across
the three warmed close points. This is a short renderer-residency check, not proof
of a 30-minute whole-process memory plateau. Its fixture was adjusted for the
current tab bar and text-node splitting before the successful run.

Local raw evidence uses synthetic documents under
`%LOCALAPPDATA%/AlderDiagnostics/operations-*20261114/`. Diagnostic profiling
scripts are ignored under `work/operations-investigation-20261114/`. No original
project was edited and the installed desktop application was not updated by this
implementation task.

## Scope of validation

The focused native workflow is `.github/workflows/operations.yml`, covering
Windows x64, Linux x64, Apple Silicon and Intel Mac. It builds each platform's
native Electron application, runs the changed editor/save/checking contracts,
opens and edits TXT/DOCX, exercises history and exact persistence, checks normal
close/Mac reopen, and runs real PDF-preview demand/cancellation checks.

The workflow uses an isolated core resource fixture. Windows development runs
also used the installed full resource pack with normal automatic checking;
no empty diagnostic checker was substituted for acceptance. The CI fixture does
not qualify neural voice/model throughput on every platform. Intel Mac's existing
rules-only advanced configuration and experimental platform limitations remain.

At application revision `7da8b3d`, all four native jobs passed:
[operating qualification](https://github.com/atritheone/Alder/actions/runs/43570678855).
That report also exposed poor Intel Mac stress-TXT validation: 2.2–7.1 seconds
inside validation and an 8.62-second post-loop save wait. Passing functional
assertions therefore did not establish an acceptable Intel performance budget.
The subsequent plain-validation specialisation addresses that measured CPU work.
On the reference Windows interpreter, paired document validation medians were
105.9 ms through the general path and 43.9 ms through the specialised path;
this is a validator-stage comparison, not a whole-save speedup claim.

The final application revision, `5a86782`, passed the updated
[four-platform qualification](https://github.com/atritheone/Alder/actions/runs/43571310345).
Each runner compared general and specialised validation on identical synthetic
documents, alternating order, with five measured samples after warm-up:

| Native target | General validation median | Specialised median | TXT post-loop Saved wait |
| --- | ---: | ---: | ---: |
| Windows x64 | 132.4 ms | 58.7 ms | 1.66 s |
| Linux x64 | 205.9 ms | 95.7 ms | 2.09 s |
| Apple Silicon | 134.3 ms | 62.7 ms | 1.60 s |
| Intel Mac | 685.8 ms | 276.9 ms | 7.27 s |

The paired validator stage improved by approximately 2.1–2.5 times on every
target, with equal output. The save column is one functional scenario per hosted
runner, with different hardware/load; it is not a paired whole-save speedup
measurement. Intel Mac still misses the save budget substantially. Rich edit
tails also remain: the largest automation edits in this final native run were
328 ms on Windows, 452 ms on Linux, 639 ms on Apple Silicon and 1,082 ms on Intel.

A final full-resource Windows TXT probe with a 30-second settle passed exact text
and history checks, observing 1.90/2.46 seconds for the two post-loop save waits.
This reinforces that improvements to transport and validation have not eliminated
all remaining steady-session save contention.

Relevant unit/contract checks cover:

- UTF-16 offsets and unsaved dictionary/custom-rule context; queued revision
  cancellation and failed-preparation reporting.
- Full versus compact canonical saves, generated identifiers, Unicode, invalid
  data, stale revisions, a concurrent writer, complete durable undo/redo, and
  edits arriving during an in-flight save.
- Incremental TXT results against full reconstruction, shifted paragraph identity,
  chapter cache invalidation and immutable history/correction application.
- Search worker reuse/disposal, narration delta ordering/audio eligibility,
  transport-abort restrictions, PDF queue recovery and close/reopen failures.
- Fingerprint equality with real TXT exports for BOM/EOL/encoding variations and
  the rich-content fallback.

Only relevant checks and build/type checking were run. No full regression,
long model-quality, or complete export-format suite was run.

## Decisions and remaining acceptance work

The plan is a measured programme with conditional redesigns. This implementation
delivers the measured save/background/editing opportunities and targeted search,
narration, preview and lifetime fixes. It does **not** establish every original
performance budget or complete every proposed investigation:

- The Windows sub-second stress-TXT save target is still missed in some sequences.
  Durable full-project validation and full snapshot/history writes remain material
  work. Do not weaken durability or silently remove history to meet a timer.
- Rich edit tail stalls remain in the repeated trials. The renderer profile
  identified history accounting, native selection, DOM geometry and update work.
  History/save traversal was reduced. Existing stabilised pagination and immutable
  document caches were retained; no provisional viewport layout or new pagination
  algorithm was introduced without the required layout/output evidence.
- The complete factorial feature baseline, matched ten-run baseline/candidate
  comparison, 30–60 minute mixed-session soak, full process-tree resource attribution,
  and precise input-to-paint budgets are not established by these short probes.
- Native system-voice playback/recognition throughput, large narration-manifest
  write amplification, and unchanged-preview renderer caching still require their
  own bottleneck evidence. Their engine/storage implementations were preserved.
- A content-addressed or checkpoint/delta history migration is deferred. The
  current full history representation can still amplify disk usage substantially.
  A schema migration would need separate compatibility, crash-recovery and rollback
  qualification; no compatibility number was changed for this work.

These limits are explicit so passing functional/native checks cannot be mistaken
for proof that the entire performance programme, including long-session budgets,
has been completed.
