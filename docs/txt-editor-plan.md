# TXT Write-mode implementation for Alder 0.13

The implementation preserves Alder's existing Write workspace, paper, typography,
toolbar, tabs, recovery, reader and publication paths. TXT uses a plain-text editing
engine inside that workspace. DOCX and books retain their rich editor. This is not
a claim of full Notepad++ parity or cross-platform certification.

## User requirements

- Keep TXT, DOCX and books visually similar at a glance.
- Put TXT additions in the existing Write toolbar and Text tools overflow.
- Show format-specific toolbar options only for applicable formats.
- Keep the gutter inside the white page's left edge, matching the user's approved
  14 November screenshot, with labels vertically aligned to their logical lines.
- Run targeted checks for changed behavior; avoid unnecessary entire suites.
- Work on and push main. Keep the package version at 0.13.0.

## Delivery and acceptance

| Milestone | Delivered behavior |
| --- | --- |
| Foundation | Plain TXT Write; stable paragraph identities and project undo; exact text projection; existing recovery and publication; explicit plain-copy conversion retaining the original rich TXT workspace. |
| Core editing | Logical line gutter/current line; whole-file word completion; case/whole-word occurrence matches; wrapping, whitespace, display font, indentation, brackets, insert/overwrite and read-only controls. |
| Search/navigation | Literal, escaped and JavaScript-regex search; selection/document/open-TXT scopes; history; indexed excerpts; guarded replacement; worker timeout/match limits; line/column navigation; persistent bookmarks and colored marks. |
| Bulk editing | Duplicate/move/delete/join lines; cleanup, case conversion, explicit sorts and duplicate removal; multiple cursors/rectangular selection; column insertion/numbering; clipboard/date/surround tools; undoable tool transactions. |
| File workflows | Separate recovery/file status; Save All TXT; pin/bulk-close/reopen tabs; path/reveal; external-change/missing-file conflicts; reload in another workspace; readonly comparison; restart selections/marks; shared-history clone view; synchronized scrolling; monitoring. |
| Folder workflows | Explicit roots and filters; bounded cancellable search; result opening; verified replacement preview; source digest guards; backups verified before writes; restore retaining newer work; partial/crash recovery. |
| Advanced tools | Relative edit/selection macros; bounded cancellable replay and one undo; snippets/placeholders; saved-line markers; folding; JSON/log syntax; command palette/custom shortcuts; manual filesystem completion; optional overview. |
| Integration | Native binding/byte-preserving save; proofreading popup/correction/undo; audio following with code-point/UTF-16 mapping; existing PDF publication; composition/international input; common Write appearance and scoped controls. |

## Verification — Windows, 14 November 2026

- Production TypeScript/frontend/Electron/native-menu builds succeeded. Generated
  license notices include new production dependencies.
- Focused byte-format/import/export/plain-copy/reopen/API checks passed: UTF-8,
  BOM/no BOM, UTF-16 LE/BE, Windows-1252, mixed endings, final newlines, emoji,
  malformed metadata and refusal of lossy encoding.
- Pure checks cover transformations, full-file indexing, columns, marks, macros,
  escaped search, history, shared views, sessions, metadata, shortcuts, native
  file services and toolbar capabilities.
- Edge workflows passed actual completion, matches, macro undo, open-document
  replacement/independent undo, custom shortcuts, split/shared history, exact
  export and restart restoration of bookmarks and full selections.
- Gutter labels align within one pixel with wrapping/scrolling in Cambria and
  Consolas at 50%, 80%, 125% and 200% zoom. TXT/DOCX have the same 32-pixel toolbar,
  rendered font size and A4 width. Books retain their existing default page size.
  TXT buttons are absent from rich toolbars.
- Composition, combining accents, emoji, Arabic and Hebrew entry/export/undo
  passed. Controls expose labels, textbox/toolbar roles and keyboard navigation.
  An actual screen-reader listening session has not been performed.
- Native checks passed source binding, CRLF/final-newline save, undo/redo after
  save, path completion, external changes, comparison, safe reload, monitoring,
  spelling hover/correction/undo and explicit BOM-less UTF-16 reopen.
- Folder replacement retained BOM, Windows-1252 and CRLF; restore refused newer
  work. Focused services cover junction/traversal/stale previews and interrupted
  backup manifests. Catastrophic folder regex timed out in its worker.
- Deterministic audio exercised the actual desktop reader, with correct following
  after emoji and pause/stop retaining text. TXT PDF publication passed. This
  verifies integration rather than requalifying speech model quality.
- Two open/switch/edit/close cycles of two 1 MiB files retained 64 DOM nodes and
  358 listeners after each cycle. Heap grew from 37.3 to 60.5 MiB, within the
  30 MiB additional-cycle budget. Closed-tab snapshots are intentionally bounded
  and retained for reopening. This is not an indefinite leak proof.
- Before the targeted-test instruction, 730 frontend tests across 155 files
  passed. A broad backend run was stopped at the user's request; it is not
  reported as a passing qualification. Subsequent checks are targeted.

## Measured limits and boundaries

- Alder's existing 40 MB structured-workspace guard remains. Compatible paragraph
  JSON, reference content and format metadata can exceed the source byte size.
  Representative 10 and 30 MiB files were safely refused; those source sizes are
  not established as supported by this change. The guard was not bypassed/raised.
- On the Windows Ryzen 9 9950X3D test machine, 1 MiB multiline input opened in
  3.0 s and 1 MiB single-line input in 0.55 s. Five measured edits took 62–84 ms,
  including two animation frames and driver overhead. The targeted 5 s open /
  100 ms edit budgets passed for these fixtures, not every possible file.
- Folder limits: 8 MB per read, 256 MB per search, 10,000 files/matches; previews
  allow 200 files and 64 MB total original/replacement bytes. Regex uses JavaScript
  syntax and refuses empty matches.
- Native reopen/monitor is bounded to 30 MB; workspace limits can be lower.
  Comparisons and monitoring are readonly. Split view clones the same document;
  two independently editable documents in separate panes are outside this scope.
- Preserve source endings uses the imported/reopened source baseline. Explicit
  conversion remains selected until changed. Reopen a normalized saved file in a
  new tab to use that file as the preservation baseline.
- Advanced tools are hidden by default. Clipboard history is opt-in and records
  only copies made through Alder's text tools. Preference/session failure does
  not replace the autosaved project with an empty draft.
- Native qualification was on Windows. Linux/macOS packaging and assistive
  technology have not been independently certified here.
- This development work does not update the user's managed installation or
  migrate their data. Version/compatibility remain 0.13.0 and 2.

See [TXT Write tools](txt-write-tools.md) for controls and shortcuts.
