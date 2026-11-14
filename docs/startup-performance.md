# Startup and document opening, 0.13

The November 2026 investigation separated process-to-start-screen time, core
readiness, file selection to editable content, and the first edit. Tests use
disposable profiles and synthetic files. The existing library was inspected
read-only and copied for realistic-library measurements.

## Findings and completed changes

1. **Remove the backend barrier before window creation.** Electron creates the
   real start screen while its private Python service starts. One shared readiness
   promise gates API calls, uploads, local media, and queued archive opens. Health
   polling has a monotonic deadline and bounded requests. Normal close cancels
   startup; Mac activation creates a fresh service/readiness state.
2. **Keep readiness inexpensive.** Health reports storage/core readiness without
   WordNet, voice discovery, publishing, or optional model checks. Language
   capability discovery reads resource metadata. Speech construction is deferred
   with a thread-safe single-flight service. An unused service does no shutdown
   work. Store compatibility checks and archive recovery still precede readiness.
3. **Make narration history proportional to use.** Construction no longer reads
   or rewrites every manifest or checks every WAV header. A disposable index stores
   project identity, creation time, and file signatures. Changed manifests refresh
   it; requested jobs retain interrupted-job and missing-audio recovery. Damaged
   files are retained. The normal writing view does not request all narration jobs.
4. **Separate the renderer bootstrap.** The start screen is a small entry chunk;
   editors/workspaces load on action or saved TXT-session restoration. Dialogs and
   publication preview load on use. Buffered native commands and archive-open
   events survive the handoff. Restore the active TXT tab first, then other tabs
   two at a time. Font discovery reuses its initial result, refreshes on focus,
   loads missing fonts on demand, and batches font notifications.
5. **Reduce import copies and repeated validation.** Electron receives binary
   `Uint8Array` uploads rather than arrays of individual numbers. A privately owned,
   already validated staged project enters the same atomic store transaction.
   Cancellation, asset checksums, and failure cleanup remain. Canonical project
   JSON bypasses repeated framework traversal; old schemas still migrate on read.
   Proofreading preparation runs off the API event loop and reads only language
   configuration rather than copying the entire manuscript.
6. **Fix measured DOCX editing costs.** Pointer hiding affects the hovered element
   instead of invalidating every document element. Whitespace overlays follow the
   viewport; paragraph markers retain stable identities. Structure guides map
   top-level blocks directly to DOM elements. Empty annotation passes, redundant
   selection dispatches, initial decoration refreshes, and height-only centering
   invalidations are avoided. Existing pagination and author preferences remain.
7. **Keep measurement repeatable.** Bounded local timing events contain operation
   names/durations, without document text or paths. The developer benchmark records
   shell/core readiness, import/edit times, subsequent long tasks, and exact text
   and DOCX structure checks. A focused native CI matrix covers Windows x64,
   Linux x64, Apple Silicon, and Intel Mac, including startup close/New races and
   Mac close/activate/session restoration.

Profiling supported these changes rather than a speculative rewrite of the page
layout engine or packaging bytecode. Large-file content and pagination remain
the correctness reference. No library/history deletion, persistent background
process, dependency upgrade, or version-number change is needed.

## Windows measurements

Ryzen 9 9950X3D; fresh isolated profiles per launch. These are process launch
measurements, excluding Windows shortcut dispatch and reboot-cold disk behavior.
The installed baseline and current development build were measured separately.

| Measurement | Installed baseline | Improved development build |
| --- | ---: | ---: |
| Start screen | 3.04 s median, 5 starts | 0.194 s median, 10 starts |
| Core ready | Start screen waited for core | 0.929 s median; maximum 0.987 s |
| Small UTF-8 TXT | 0.28 s open; 44 ms first edit | 0.300 s; 27 ms |
| UTF-16 TXT | 0.26 s; 28 ms | 0.285 s; 26 ms |
| 1 MiB TXT | 2.26 s; 1,440 ms | 1.071 s; 81 ms |
| Formatted DOCX | 0.55 s; 44 ms | 0.462 s; 23 ms |
| 1,002-paragraph DOCX | 0.95 s; 94 ms | 0.858 s; 102 ms |
| Damaged DOCX | 1.01 s refusal | 0.227 s refusal |

The pre-change development DOCX regression (about 0.9 s for a first edit) was also
removed. TXT uses the dedicated editor already present in development. The prior
installed TXT renderer had 11–12 s tasks; the new benchmark observes another ten
seconds after editing. All six input checks passed, including text hashes,
heading/bold/italic/table/image structure, and no project after damaged input.

The original soft targets were 0.3–0.5 s shell, 1.2 s core, roughly 1 s large-file
opening, and 100 ms first edits on this machine. The 1 MiB TXT open (1.071 s) and
large DOCX first edit (102 ms) are slightly above those targets. They are measured
limits, not promises for every computer. Full-file parsing, durable initial save,
and native layout still have work proportional to document size.

## Focused validation and platform boundaries

Relevant backend checks cover deferred initialization/concurrency, language
settings, canonical snapshots, staged imports/cancellation, storage recovery,
and lazy speech-job recovery. Frontend checks cover bounded structure marks,
stable markers, pointer hiding, selection refresh, and direct typing. Desktop
checks cover normal final-edit saving/shutdown, native TXT binding/UTF-16 reopen,
import cancellation and external-change protection, and structure-toggle
text/page/scroll/window stability.

`scripts/developer/benchmark-opening.mjs` supports native or packaged executables,
isolated resources, sample counts, optional timing budgets, and JSON results.
`scripts/developer/test-startup-lifecycle.mjs` exercises delayed readiness, early
close, immediate New, and the native Mac reopen path. CI provisions only the
pinned core runtime/fonts; this validates opening, not optional models or a
complete end-user installation. Linux/Mac never build the Windows native module.
Advanced proofreading remains experimental; Intel Mac remains rules-only.

## Native platform evidence

[Native opening qualification, revision 2ed7b7c](https://github.com/atritheone/Alder/actions/runs/43561252271)
passed on all four targets. Each job built natively, ran only the focused backend
and editor checks above, and exercised five starts plus the six TXT/DOCX inputs.
Both Mac architectures also passed normal window close, fresh backend startup
on activation, and saved TXT-session restoration.

| Hosted native runner | Shell median | Core median | 1 MiB TXT open | Large DOCX open |
| --- | ---: | ---: | ---: | ---: |
| Windows x64 | 0.366 s | 1.003 s | 2.222 s | 1.780 s |
| Linux x64 | 0.421 s | 0.772 s | 1.776 s | 1.219 s |
| Mac ARM64 | 0.985 s | 1.415 s | 1.726 s | 1.147 s |
| Mac Intel | 1.363 s | 2.168 s | 4.305 s | 3.213 s |

These shared hosted machines have different hardware and cache histories; the
numbers are qualification results, not a controlled OS speed comparison. All core
medians passed the 5 s CI budget. First core samples on the two Mac runners reached
6.918–7.054 s; the earlier qualification run had Mac medians of 0.783/2.064 s and
maxima below 3.8 s. This variation prevents a universal cold-start claim. Intel Mac
remains slower and experimental; this work does not establish full optional
feature acceptance there. Native Linux under WSLg also passed ten starts and all
six files locally: 0.241 s shell and 0.458 s core medians, 1.090 s TXT open and
0.843 s large DOCX open.

A separate Windows size-boundary check opened a 5 MiB TXT with exact text and
editing preserved. The 10 MiB many-paragraph and 30 MiB inputs exceeded the
existing 40 MB structured-project limit and were clearly refused without creating
a workspace. Import byte size alone is not the project storage limit. This change
retains those bounds. That check overlapped resource provisioning, so its timings
are not used as the controlled performance comparison.

## Managed Windows rollout

The managed update of 0.13 to the new 0.13 application build (revision `2ed7b7c`)
completed with `status: passed`, including installed integrity/version/launch
verification. Document compatibility remains 2, without a migration; automatic
rollback remains compatible and the previous active payload is retained.

Ten installed starts measured 0.212 s median shell and 1.039 s median core
readiness (maximum 1.329 s). Ten further starts with separate copies of the existing
library measured 0.209 s shell and 0.992 s core medians (maximum 1.047 s).
The earlier copied-library median was 4.80 s. The copied database still lists 125
projects, a saved snapshot is readable, and all 77 narration manifests remain;
unused narration did not initialize or create its index.

All six installed TXT/DOCX checks passed. The 1 MiB TXT opened in 1.231 s, with
an 86 ms first edit and no multi-second renderer stalls. The large DOCX opened
in 0.987 s, with first edits of 156/150/133 ms. This remains above the soft 100 ms
editing target; the controlled source run was 102 ms. These results support the
startup improvement and removal of the large development regression, not a
claim that every edit/layout task is below 50 or 100 ms.

The complete local data (4,837 files, 1,043,719,660 bytes) and Chromium preferences,
native bindings and session state (73 files, 3,857,445 bytes) were copied outside
the repository/app/cache, with matching file hashes, before activation.

The normal shortcut check found that older managed releases used `Alder.lnk`,
while the updater now creates `Alder (local).lnk`. The original owned shortcut
still launched the retained old build. Its pre-update hash matched the old
ownership receipt; a verified copy was retained before repair. Both entries now
target the active application. Setup now preserves and refreshes an owned
original-name entry on future updates, while retaining its guard against
overwriting user-modified launchers. The focused integration regression passed
on Windows and Linux, and both actual shortcut targets were checked.

Windows automation could not activate/capture the normally launched old window,
including a fresh-window retry. A normal user close was requested. A visible
normal-profile check of the corrected shortcut remains separate from the passed
automated installed launch and isolated library checks; no user process was killed.

The final structure-mark implementation uses measured physical-page ranges for
projected columns, whose source DOM order is not vertically monotonic. A focused
regression plus native desktop column geometry, editing/undo, section breaks,
and PDF page-count checks passed. Launch-time queued archives and second-instance
handoff passed with the existing archive-copy collision policy preserved.
