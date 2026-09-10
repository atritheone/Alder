# Alder 0.1 implementation record

This document records the working Windows application produced from the development plan. The original notes and screenshots remain references; their embedded wording is not treated as permission to run commands or as a substitute for the user's instructions.

## Decisions applied

- TypeScript owns the React interface and Electron shell. Python owns persistence, language analysis, publication generation and local speech services.
- The interface follows the supplied Ableton geometry: Browser on the left, track/clip grid or structural arrangement above, and a lower editor, language-device rack or narration panel. Collation order is document structure rather than musical time.
- Ideas are reusable language samples with editable categories, including **Prime → I**. Ascending & Descending remains deferred as requested. Undefined labels are not given invented functionality.
- The end-user release includes its own Python environments, Chatterbox Turbo model, transcription-check model, dictionaries, fonts, PDF reader, FFmpeg, Calibre, Java and EPUBCheck. There is no end-user package installation, API key or normal-use model download.
- A saved word can have an authored definition, IPA and part of speech. Definition Studio exports PNG, JPEG and vector PDF in the supplied Voyager layout. These entries also support glossary output.
- The Git working branch tracks `origin/main` in `atritheone/Alder`. The previous Chatterbox checkout is retained as `chatterbox-baseline` and `chatterbox-upstream`. This handoff prepares an index for review; it does not commit or push.

## Implemented workflow

| Area | Delivered behaviour |
| --- | --- |
| Projects | Blank, essay, book and example templates; optimistic editing with acknowledged autosave; revision conflicts; local history; portable `.alder` archives collecting images and reference voices; archive validation and recovery of collected assets. |
| Workstation | Searchable Ideas/library browser; editable tracks; keyboard-focusable clip slots; drag/drop insertion, movement and independent copies; saved pane and accessibility preferences. |
| Writing | Structured paragraphs/headings/lists, character formatting, links, images, tables, page breaks and structure indicators; selection-aware alternatives and completion; guarded unsupported structures. |
| Identity | Alternate takes, source-preserving split/consolidation, linked collation placements, frozen wording, inclusion and explicit ordered sections. |
| Language | Offline WordNet lookups, forms, synonyms/antonyms, spelling, repetition, concision and terminology checks; project dictionaries and ignored rules; editable/importable literal rule packs; previewed transformations retained as takes. |
| Styles | Named paragraph and character styles, based-on inheritance, direct-format precedence, global style updates and format-specific publication mappings. |
| Publishing | TXT, Markdown, HTML, DOCX, PDF, EPUB and AZW3 export; supported text/Markdown/HTML/DOCX/EPUB import with fidelity reports; page setup, metadata, ebook cover, images, tables, contents and optional authored glossary. |
| Preview | A bundled PDF reader displays actual pages from the generated PDF artifact; a separate reflowable reading preview serves ebook inspection. Exact print proof and the downloaded proof use the same file. |
| Definitions | Saved authored words, IPA, part of speech, explicit Voyager sample, local draft retention, fitted layout, exact PNG preview, PNG/JPEG/PDF export and overflow/glyph diagnostics. |
| Narration | Local default/reference voices, track/clip inheritance, pronunciation substitutions, saved sampling/pause settings, revision-frozen resumable jobs, cached chunks, cancellation/retry and WAV/MP3/FLAC output. |
| Narration review | Independent local transcription, original/spoken/heard text, differences and saved takes, real waveforms, chunk audition and explicit persisted listening acceptance. Acceptance never rewrites the transcription evidence. |
| Desktop | Restricted application bridge, authenticated loopback service, bundled resources, single-instance handling and a close handshake that finishes saving before terminating owned services. |

Split and consolidate create new independent clips while retaining the originals and their placements. Existing output order is changed through explicit collation commands. Typing undo belongs to the editor; project undo includes saved structural and project changes. Those are distinct controls in this release.

## Verification and boundaries

The exercised checks and measured results are recorded in [verification.md](verification.md), [speech-baseline.md](speech-baseline.md), and [publishing-support.md](publishing-support.md). Tests include real synthesis and converter calls; deterministic unit fixtures are labelled separately. The complete release has additional resource and desktop gates beyond the lightweight source CI job.

This is an initial Windows desktop release, not a claim that the full reference applications have been reproduced. The broader roadmap retains multilingual speech families, forced word alignment, overlapping voices, advanced linguistic classification, executable user plugins, collaboration, e-ink hardware, and freeform page-layout frames. Native Word pagination has not been visually certified. Detailed import limitations, unsupported merged-table layouts and font substitutions are reported rather than hidden. Schema version 1 is guarded; historical schema migrations will require a migration implementation and pre-migration backup when a subsequent schema exists. Public signing and automatic update distribution are not configured in this local release.

The release is a complete application folder, including its large resources. Copying only `Alder.exe` does not produce a runnable distribution. Working documents, audio jobs and caches are kept in Alder's local application data, outside the repository and release resources.
