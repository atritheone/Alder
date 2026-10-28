# Alder word-processing development plan

Status: implementation in progress. The complete plan and its release gates have not been achieved; retain this file until they have.

## Continuation — sections and long-document layout

Implemented top-level next-page, odd-page and even-page sections with their own paper size, orientation, four margins and binding gutter. The existing formatting/context menu opens a compact Insert section break / Section properties dialog; insertion, editing and removal preserve the originating document and selection, reject stale edits and have separate undo events. A section inserted at the end leaves a writable paragraph with focus. Section nodes have stable identities and are excluded from narration/proofreading text.

Write now maintains explicit per-page frames for mixed dimensions. Arrangement snapshots, page focus, cursor navigation, running furniture and the browser publication prototype use those frames. Odd/even starts use the configured starting page number; automatic parity blanks contain no running header/footer. Comparison with Word exposed and fixed the even-start-number case. Section widths use a stylesheet outside the editable DOM, avoiding both repeated node-decoration rebuilding and mutation-observer reparsing. The stylesheet is removed with the editor and cleared when sections are removed.

Paragraphs/sentences move between differently sized pages. Whole-page movement is supported within a section, retaining its boundaries and geometry; context-menu and Alt+Up/Down actions complement dragging. Cross-section whole-page movement is still deliberately unavailable because it needs a defined policy for moving the first section's settings and parity pages. It must not silently flatten layouts.

DOCX exports genuine sections and imports their geometry and ordinary break types, including section boundaries after list paragraphs. The first page number survives import. Continuous/column breaks, section numbering restarts, non-decimal numbering and unsupported running stories still produce conversion notices. PDF switches physical page templates and creates empty parity pages; HTML preserves section metadata and named page styles. EPUB/Markdown report fixed-layout conversion. No production shared typesetting claim is made.

Verification: 183 frontend tests and 380 backend tests pass. Windows desktop checks cover mixed dimensions at UI scales 50/100/150% and Write zooms 50/100/300%, later-page typing/undo, section controls, real save/reopen, sentence moves across sections, page dragging/keyboard movement within sections and repeated table headers. The ordinary table and page-geometry regressions and 16-check editing workflow pass. Word 16.0 opens, renders and resaves the expanded structured fixture; with page numbering starting at 8 its odd section starts on the fourth physical page, matching the corrected numbering policy. This qualifies a semantic subset, not full Word fidelity or macOS/Linux behaviour.

The 1,049-page mixed-section stress fixture completes and incremental/full page maps agree. After replacing repeated top-level DOM lookups with a single indexed pass, the latest Windows run measured approximately 263–323 ms for local edits and 4.6–5.8 seconds for full layout; renderer-only highlight updates peaked at 6.7 ms. Those local edits still miss the plan's target, and the fixture does not certify real concurrent audio. The existing simulated audio/highlight integration also passes. Paragraph backgrounds/borders have not been exposed: painting across split paragraphs and page margins needs qualification first.

The full plan remains incomplete. In particular, continuous sections/columns, rich running stories, section numbering, cross-section whole-page moves, tabs/ruler, paragraph borders, exact mixed-font leading, unified history, wrapped objects/notes/references, review, shared production PDF pagination and specialist/accessibility/international qualification remain. Retain this plan until the stated implementation and release gates are satisfied.

## Implementation record — 29 October 2026

Page geometry now has one shared set of dimensions and limits consumed by the browser and Python exporters. Settings → Page Layout adds custom paper sizes, four independent margins and a left binding gutter. Impossible new margin combinations are rejected. Older documents with impossible uniform margins remain readable using a reported proportional reduction to a 20 mm minimum body, consistently in Write and export. Normal legacy margins are unchanged. DOCX opening retains the first section's dimensions/margins/gutter; importing material into an existing document does not replace its settings. Mixed sections and unsupported mirrored/top binding produce conversion notices; this is not section support.

Write, Arrangement, HTML, DOCX and PDF use these dimensions. The existing simple running-header and numbered-footer settings are now also painted in Write/Arrangement and the browser publication prototype, including the configured starting page number. They remain separate from editable/narrated body text. Rich running stories, section variants and live fields remain open.

Display scaling now transforms a page laid out at its natural scale, compensating for application UI zoom. This fixes a measured defect where a seven-page table became eight pages at 50% UI scale and 50% Write zoom. Display-only changes reuse the logical page map. The seven-page fixture now retains identical boundaries at 50/100/150% UI scale and 50/100/300% zoom. Scaled mouse placement, typing/undo on a later page and scroll extent checks pass.

Ordinary tables repeat their leading header rows in Write, Arrangement and the browser publication prototype. Headers stay with the first body row; complete vertical-merge groups stay together if they fit. Repeated headers are inert visual copies excluded from authored text, narration, proofreading and undo. An oversized row/group keeps the existing line-splitting fallback; repeated headers on such splits, nested/complex merged-table pagination and user row-splitting controls remain unqualified. The rendered prototype PDF was inspected and its extracted text retains each body cell once with the expected repeated headings.

Verification: 173 frontend tests pass; the complete backend suite passes 369 tests, followed by an 89-test geometry/publishing regression after the final DOCX orientation adjustment. The TypeScript/Vite/Electron/Windows-native-menu build passes. New Windows desktop checks cover page settings, invalid combinations, physical geometry, headers/footer numbering, scaled caret placement, Arrangement and reopening; table checks cover scale-invariant page maps, incremental/full agreement, vertical merges, orphan-header prevention and the oversized-row fallback. The existing 16-check editing workflow, declared-subset publication prototype and simulated audio/highlight integration pass. The 59-page Arrangement regression passes; this run measured a 304 ms sentence drop while other tests were running, so it is not a performance improvement claim or the 100 ms target.

`probe-exact-leading.mjs` records a possible baseline-compensation approach across Cambria, Arial and Times New Roman. It is diagnostic only. Production exact leading still expands with large inline fonts, and the approach has not been qualified for nested marks, inline objects, selection/caret behaviour or publication. No complete phase or Word-parity gate is being marked finished. Sections, shared production pagination, notes/references, unified history, review, specialist features and cross-platform/accessibility qualification remain on the plan.

## Implementation record — 28 October 2026

Latest continuation adds **Table properties** in the existing formatting/context menu: table alignment, selected-cell vertical alignment, four padding values, uniform border width/colour, shading, minimum row height and selected-column width. Unchanged or mixed properties are not overwritten. Column widths can be distributed evenly or reset to fit the page. Natural ascending/descending sorting uses the selected column, retains leading header rows and moves row/cell identities and formatting together. Sorting merged tables is disabled. Tab-separated text/table conversion retains inline marks, pads unequal rows, supports Select All and refuses to flatten embedded objects. Commands are undoable; dialogs preserve the originating selection and reject a changed document.

DOCX/HTML retain the table properties; PDF applies them. Word 16.0 opens, renders and resaves the expanded fixture with these properties intact. Visual inspection caught a vertical-merge continuation defect; applying the same margins/borders/shading to continuation cells fixes the stepped outline in Word. Per-edge border variants are converted to uniform cell borders with a warning, and fixed Word row heights import as minimum heights to retain visible content. Repeated headers in the editor, complex merged-table pagination, per-edge editing, content autofit and row-splitting controls remain outstanding.

Find → Advanced adds regular-expression search, numbered/named capture replacements and a replacement preview. It works in the current chapter, original selection, Sandbox and whole-book scope. Pattern execution uses a disposable worker with a 1.5-second deadline, and stale results cannot be applied. Invalid patterns and patterns matching empty positions offer no replacements. A desktop fixture's deliberately pathological expression times out while a 200 ms renderer timer completes in approximately 200 ms; a subsequent search succeeds. Book capture replacements agree with the preview and undo together through project history.

New documents include Cambria Title and Subtitle styles, with Body as their next-paragraph style; existing authored styles are preserved. File-binding records now publish only after a successful durable write and serialize concurrent updates. Failure-injection checks verify that a failed flush preserves external-file bytes, a failed Save As record preserves the prior binding, a database-growth limit leaves the last committed snapshot/history intact, and a child-process exit between history insertion and snapshot update recovers the last committed version.

Latest verification: 167 frontend tests, a 351-test complete backend run, and a subsequent 72-test publishing/Word-processing run including the newly added merged-continuation regression pass. The TypeScript/Vite/Electron/native-menu build passes. Windows desktop checks pass for table properties/conversion (five), pattern search (three), whole-book search including capture replacements (four), and the existing everyday editing workflow (16). The property dialog and both rendered fixture PDFs were visually inspected. These results do not qualify macOS/Linux, shared pagination or the full plan. CSS experiments confirmed that suppressing inline line-box height alone fixes one exact-leading case but fails at larger sizes; no misleading partial layout workaround was applied.

Further continuation adds whole-book find/replace with chapter navigation, inclusion of excluded chapters, original-selection isolation and atomic validation before any chapter is changed. It preserves inline formatting and block identities. Replace-all across chapters uses one durable project-history change; the existing **Undo project change** action restores it. This is still separate from local editor undo, not the pending unified chronological history.

Copy/Paste formatting is available in the existing formatting/context menu and with Ctrl/Cmd+Alt+C/V. It snapshots appearance without copying text, links or document/style identities, so it works between Write, Sandbox and documents. Partial selections receive character formatting; a caret or wholly selected paragraph also receives paragraph formatting. The command is one editor undo operation. AltGr character input is not consumed by these shortcuts.

Image properties provide width in millimetres, original-size reset, alignment, alternative text, title and replacement from collected images. Double-click or the formatting/context menu opens the dialog. Replacing a selected image from a file retains its dimensions and descriptions. DOCX/HTML retain width, alignment, alt text and title; PDF applies block-image alignment. Images remain proportional block images: anchored wrapping, crop/resize handles and captions are not implemented. Uploads now collect bytes before registering metadata through the active editing session, avoiding the stale-project reload that could discard typing during an upload. The originating Write/Sandbox editor is checked explicitly.

Table commands now move rows, split before the selected row and join directly adjacent tables with matching column widths. Rows and headers retain their identities. Vertical merges travel as intact row groups; splitting through a rowspan and joining mismatched widths are disabled. Each action has its own editor undo event. Full table properties, repeated headers and complex multi-page layout remain open.

Arrangement snapshot generation now indexes unit outlines by intersecting page instead of creating and discarding every unit on every page. The same Windows 59-page regression fixture passes; observed sentence drop time fell from approximately 612 ms to 254 ms in this run. That is a fixture result and still exceeds the proposed 100 ms local-update target.

Latest continuation verification: 152 frontend tests, 340 backend tests, the source production build, 16 desktop word-processing checks, three whole-book search checks and five formatting/image checks pass on Windows. The image dialog was visually inspected. The latter workflow checks cross-document formatting, AltGr preservation, Write/Sandbox image targeting, replacement, undo and persistence. Setup checks and Word fixture qualification recorded below were performed in the earlier batch; macOS/Linux and broader Word fidelity have not been newly qualified here.

Continuation adds paragraph flow controls (keep-with-next, keep-together, widow/orphan and page-break-before) and exact/at-least leading properties to the editor, Paragraph dialog, style manager, clipboard and DOCX/HTML/PDF paths. Seven real-editor boundary cases pass, including an oversized kept paragraph and no blank first page. Word 16.0 opens, renders and resaves the expanded fixture, retaining flow semantics; import now resolves Word's implicit flow/document defaults because Word removes redundant explicit flags. Mixed-font exact leading remains a browser-layout limitation: 18 pt requested with 36 pt inline text measures about 35.43 CSS px instead of 24. Preserve the property for DOCX but do not call this layout case qualified.

The paginator now restarts before the affected page/container and reuses the unchanged suffix once a measured boundary stabilises. Full and incremental maps/geometry agree after insertion, deletion across pages and edits near the end. On this Windows x64/Ryzen 9 9950X3D machine, natural-flow fixtures measured 96/478/955 pages. Local edits took approximately 31–42/85–108/177–268 ms, versus 64–79/596–629/2,786–2,831 ms for full remount/reflow. Renderer-only highlight updates on the 955-page case peaked at 3.2 ms. These are bounded fixture measurements, not audio underrun, proofreading concurrency, cross-platform or 50 ms input-latency certification; the largest case still misses the proposed local-update target.

Settings → Writing now provides opt-in smart quotes, double-hyphen conversion, automatic list starts and user-authored whole-word replacements. Defaults stay off; code, links, paste, composition and non-Free case input are excluded. Immediate Backspace restores literal input, and ordinary editor undo is retained. Real desktop checks cover creation, undo and persisted settings after reopening the workspace.

List properties support decimal/alphabetic/Roman markers, three bullet shapes, starting values and restarting from the current item in one undo. Ordinary marker styles survive DOCX/HTML import and DOCX/PDF export; Markdown reports conversion to its ordinary markers. Automatic continuation between separate lists, list definitions linked to headings and complex multilevel labels are still outstanding. HTML import no longer treats a doctype declaration as authored text.

The browser publication prototype uses the measured editing map, masks text outside each page without duplicating it in PDF extraction, and checks all 360 markers on their expected pages across 50/100/150% UI scale and up to 300% zoom. This remains an isolated prototype, not the production PDF exporter. Mixed sections, repeated table headers, wrapped anchors, flowing footnotes, accessibility tagging and the engine decision are still open. The existing backend PDF remains the actual publication proof.

The audit below records the original baseline. These changes have since been implemented:

- Shared formatting commands, mixed selection state, editable font sizes, heading levels 1–6, strike/subscript/superscript/highlight/colour, clear character and reset paragraph formatting. Paragraph controls cover alignment, before/after spacing, left/right and first-line/hanging indents and multiple line spacing. Compact overflow remains available at narrow widths; dialogs follow UI scale.
- Create/update styles from selection, next-paragraph styles and safe replacement of used styles across text, variants, frozen placements and dependent styles. Point-size controls now agree with rendered text, including shared heading defaults. Three paste choices retain source formatting, match destination appearance, or insert plain text. Clipboard HTML is parsed inertly through the supported schema; uncollected/foreign-document images retain alternative text with a notice.
- Find previous/next, counts, case/whole-word options, replace one/all and a mapped original-selection scope in the active chapter or Sandbox. Session caching preserves ProseMirror undo when switching recent documents/chapters.
- Native Save, Save As and Save a Copy with machine-local file identities, atomic writes, cancellation and external-change protection. Imported rich formats initially require a working-copy destination. Plain text saves preserve authored trailing spaces/empty paragraphs and warn only about actual rich-content conversion.
- Versioned project schema 2 migration and stable block identities, with split/copy/move/undo tests. Old schema 1 snapshots migrate deterministically on read without overwriting the original snapshot. Archive-container version remains 1. Older application builds that support only project schema 1 cannot open a schema 2 project.
- Saved-version browsing and recovery as an independent document, using the existing durable history store. Recovery collects and verifies the snapshot's images before creating the document. Session keys include the project identity so recovered copies cannot inherit another document's undo history.
- Configurable table insertion, table keyboard navigation and contextual row/column/delete/merge/split/header commands. DOCX import/export uses genuine list numbering, paragraph metrics, per-run fonts and merged table grids/widths. PDF now preserves table widths and spans too.
- View → Show outline opens the same optional side-panel area as Find. It lists headings across chapters, supports search/collapse/navigation, and moves a heading with its subordinate content within a chapter using drag or keyboard-accessible buttons. Moving retains block identities and is one editor undo event; a queued action verifies its document identity before applying. Headings inside table cells can be navigated but are not offered as independent section moves.
- File → Print opens the generated PDF proof, with a Print this PDF action that opens the actual PDF in the sandboxed desktop viewer. The viewer's print control supplies printer, page and copy selection after loading. The preview file is removed on close. This is deliberately preview-first: an isolated Chromium experiment produced blank output when printing its loading page. Printer hardware and macOS/Linux dialogs are not qualified by the Windows window-lifecycle check.
- Removed ReportLab's implicit frame inset and a phantom empty section heading, so PDF text respects authored margins. Fixed a selection-refresh race that could reinstate Select All after native cursor movement.

The updater declares data compatibility 2 and the implemented forward migration from 1. Preflight reports this change and blocks automatic rollback into an older incompatible build; the existing backup workflow remains required. Application version remains 0.12.0.

Verification includes 128 frontend tests, 315 backend tests, and 55 passing setup/update tests (three platform-specific skips). An isolated Electron desktop workflow covers editing, history, paste, file saves, recovery, outline moves, print-window lifecycle and 50/100/150% UI scale. A separate Arrangement workflow passed on 59 pages; this does not qualify the proposed 500/1,000-page or concurrent narration targets. Its sentence drop took about 487 ms on Windows x64 / Ryzen 9 9950X3D, so further reflow work remains necessary. Installed Word 16.0 opens, paginates, renders and resaves the original structured DOCX fixture. `scripts/word-processing-fixture.py <fixture directory> --verify-word` checks the returned text, paragraph metrics, 4/5 numbering, nested bullet, merged-cell spans/widths and Cambria heading font. Both rendered PDFs were visually inspected. This caught and fixed Word theme aliases overriding authored Cambria and missing list-marker spacing. It also confirms visible differences in table borders and block placement: the limited semantic round trip passes, but layout equivalence and full Word fidelity are **not** certified. Initial automation failures were fixed in the bounded test harness; it now closes only its own Word instance.

**Outstanding:** no complete phase is being marked finished. In particular the shared pagination prototype/decision, sections, advanced paragraph flow/tabs/ruler, editable running matter, remaining style/list/object properties, unified structural undo, references/notes/citations, comments/tracked changes/compare and specialist/accessibility/international qualification remain. The bounded in-memory editor-session cache is not durable unlimited undo. The new source/round-trip fixtures cover a declared subset, not full Word fidelity. Continue with the architecture and qualification gates below; do not delete this plan or advertise Word parity on the basis of this implementation batch.

Audit date: 28 October 2026. Baseline: Alder 0.12, repository revision `bfebbc5`.

## 1. Objective and recommendation

Make Alder a dependable professional word processor for everyday documents, manuscripts, research and editorial exchange, while retaining its compact interface, Arrangement workspace, Sandbox and local speech tools.

The current editor is a useful foundation. The largest gap is the completeness and consistency of the document underneath the interface. Adding buttons alone will not solve Word import losses, different editing/export pagination, limited document structure, or the absence of editorial review.

Retain ProseMirror, React, Electron and the Python services initially. Extend them around a shared document contract, a consistent command system, persistent document sessions and a qualified layout pipeline. Decide any layout-engine replacement through a representative prototype before committing to it.

Deliver in stages. Each supported feature must work through editing, saving, reopening, Arrangement, proofreading, narration and relevant exports. A feature implemented only in an export function does not count as complete.

## 2. Audit scope and evidence

This is a source-code and documentation audit, supplemented by Microsoft's official feature documentation. It is not a fresh runtime benchmark, a visual comparison against installed Word, or certification of the existing tests. No application code was changed or test suite executed for this plan.

Primary implementation evidence:

| Source | What was inspected |
| --- | --- |
| [Editor.tsx](../frontend/src/Editor.tsx) | Document schema, formatting commands, toolbar state, table plugins, keyboard handling, paste/context actions, history and pagination integration. |
| [pageFlow.ts](../frontend/src/pageFlow.ts), [BookWorkspace.tsx](../frontend/src/BookWorkspace.tsx), [PageArrangement.tsx](../frontend/src/PageArrangement.tsx) | Measured page boundaries, layout spacers, chapter editing and movement of document units. |
| [StylesManager.tsx](../frontend/src/StylesManager.tsx), [styleResolution.ts](../frontend/src/styleResolution.ts), [SettingsWindow.tsx](../frontend/src/SettingsWindow.tsx) | Named styles, inheritance, formatting properties and document/application settings. |
| [App.tsx](../frontend/src/App.tsx), [useProject.ts](../frontend/src/useProject.ts), [electron/main.ts](../electron/main.ts) | Menus, find/replace, document tabs, autosave, file save/export and desktop integration. |
| [models.py](../backend/alder/models.py), [store.py](../backend/alder/store.py) | Document validation, schema version, revision conflicts, recoverable history and portable archives. |
| [publishing.py](../backend/alder/publishing.py), [publishing-support.md](publishing-support.md) | Import/export transformations, layout engines and explicit fidelity limitations. |
| [textProjection.ts](../frontend/src/textProjection.ts), [offline-proofreading.md](offline-proofreading.md) | Text-to-document mapping and current proofreading capabilities and limits. |
| Frontend unit tests, backend publishing/book tests and `scripts/test-*-desktop.mjs` | Existing regression coverage and places to extend it. |

Historical documents are useful context but sometimes describe older behaviour. For example, current Open supports independent document tabs, and PDF text extraction is available despite older publishing documentation saying otherwise. Update those contracts alongside implementation.

### Current capability and gap matrix

| Area | What Alder has now | What is incomplete or missing |
| --- | --- | --- |
| Basic editing | Structured rich text, selection, editor undo/redo, shortcuts, case transforms, hard breaks, page breaks and structure indicators. | Consistent mixed-format selection state, full paragraph editing, paste choices, reliable document-session undo across tab/chapter switches and a unified undo policy for structural changes. |
| Character formatting | Bold, italic, underline, font family/size; schema support for colour, highlight, strike, subscript and superscript. | Several schema capabilities lack a normal toolbar/menu command. Font size is a fixed dropdown; heading and size dropdowns use default values rather than fully reflecting selection. No complete clear-formatting or copy-format workflow was found. |
| Paragraphs and styles | Left/centre/right/justified alignment; named paragraph/character styles, inheritance, direct overrides, line-height multiple, space after, left/first-line indentation. | Space before, right indent, exact/at-least line spacing, tab stops/leaders, complete hanging-indent controls, next-paragraph style, outline levels and coherent keep/widow/orphan rules. Some export-only properties are not editor features. |
| Lists | Basic bullets/numbering, nesting and list-item keyboard commands. | List definitions, restart/continue, custom markers, multilevel numbering and numbering linked to headings. DOCX export currently writes list prefixes as text; import does not reconstruct numbering. |
| Tables | ProseMirror tables, column resizing, cell selection, fixed 3×3 insertion, add row/column and delete table. | Complete contextual row/column/cell commands, merge/split UI, table Tab navigation, properties, borders, padding, alignment, repeat-header controls and robust multi-page layout. DOCX export flattens row spans; PDF equalises columns and flattens merges. |
| Images and objects | Collected raster assets, block images, width/alt/title attributes and embedding in exports. | Full resize/crop/replace/position UI, inline images, text wrapping, anchoring, captions, cross-references, text boxes and equations. Import converts inline images to blocks. |
| Editing pages | Measured browser layout, explicit breaks, zoom, continuous chapter editing and Arrangement page depictions. | Section-aware layout, mixed orientation, four independent margins, gutters, columns and full pagination rules. Current pagination clears/rebuilds spacers and measures the chapter; this needs profiling and incremental work. |
| Print and PDF | Real generated PDF preview and downloadable proof. | Write uses browser measurements while PDF uses ReportLab, so editing pages and output are not one layout authority. No normal application Print command was found in the audited menus/bridge. |
| Headers and footers | Export settings for a running header, page numbers and starting number. | Editable rich header/footer content, first/odd/even variants, section links, page-count fields and accurate in-editor presentation. |
| Long documents | Chapters, reorder/include controls, book output, generated contents links/glossary, reading bookmarks and remembered position. | Heading outline, structural bookmarks/cross-references, live heading-based contents with page numbers, captions/list of figures, index, section numbering, footnotes/endnotes and a source/citation library. Reading bookmarks are not general document references. |
| Review | Undo, project history, local spelling/grammar, hover fixes, caret issue display and full review report. | Anchored comment threads, tracked insertions/deletions/formatting/moves, accept/reject, compare/merge and editorial DOCX round trips. Existing history is not Track Changes. |
| Proofreading | Local LanguageTool rules, English dialects, dictionaries, ignored rules and optional experimental model review. | Broader independent quality evaluation, efficient incremental/cross-paragraph checking and platform qualification. The existing proofreading plan explicitly does not establish Grammarly parity. |
| Search/navigation | Find next with wrapping and replace all in the active chapter or Sandbox draft. | Find previous, match count, whole-word/case options, replace one, document/book scope, heading/page navigation and optional advanced patterns. |
| Files and recovery | Multiple document tabs, acknowledged autosave, revision conflicts, bounded snapshot history, validated `.alder` archives and safe export writes. | Conventional file identity and Save/Save As semantics, clear distinction between workspace autosave and saving the external file, external-change handling, visible recovery/version browsing and preserved editor sessions. |
| DOCX compatibility | Body order, basic marks, headings, links, raster images and tables; semantic DOCX export. | Imported styles/fonts/paragraph metrics, numbering, sections, fields, notes, comments, revisions and running matter are incomplete or lost. Some losses are warned about; fidelity is not Word round-trip equivalence. |
| Other formats | TXT, Markdown, HTML, EPUB and extracted text import; PDF/ebook/document exports. | A published per-feature compatibility matrix, explicit PDF extraction versus editable reconstruction, and reliable handling of unsupported content throughout save. |
| Accessibility/international text | Semantic editor foundation, labelled controls, some keyboard support, Unicode text mapping and narration. | Qualified screen-reader editing, accessible generated documents, language/direction per range, comprehensive IME/bidirectional/CJK tests and consistent keyboard access to contextual features. |

The backend accepts some node names such as `footnote` and `crossReference` that the frontend does not implement as editable structures. That is partial groundwork, not delivered functionality. Likewise, CSS widow/orphan declarations do not prove that the custom spacer-based paginator enforces those rules.

## 3. Alder interface contract

### Default workspace

Keep Write, Arrangement and Sandbox. Keep native top menus and the existing light-grey surfaces, dark-blue accent, square geometry and understated separators. Follow the Start → New controls: borderless ordinary buttons and fields, clear hover/focus/selected feedback, no decorative cards or rounded button containers.

Retain one compact formatting row. Use a selection-aware style selector, font, editable size, common emphasis, alignment, lists and an overflow menu. Keep existing frequently used writing and speech actions accessible. Avoid adding a second permanent formatting ribbon.

Move specialist table actions out of the always-visible toolbar. Reveal a small contextual strip or menu when a table, image, note or revision is selected. The toolbar's occupied height must remain stable when selection changes; narrower windows and UI scaling should move actions into overflow instead of wrapping unpredictably.

### Placement of features

| Feature | Minimal entry point and presentation |
| --- | --- |
| Character formatting | Existing toolbar; overflow for strike, sub/superscript, colour, highlight and clear formatting. Keyboard shortcuts and menu alternatives. |
| Paragraph properties and tabs | Text context menu → Paragraph…; also Edit → Format. One compact grouped dialog with a live preview and explicit Apply/Cancel. |
| Styles | Selection-aware toolbar dropdown; Modify style… opens the existing Styles manager. Add Create from selection and Update from selection. |
| Insertions | Extend existing Create with a Document submenu for breaks, table, image, note, field and reference. Use the same command definitions for shortcuts and context menus. |
| Page/section setup | Keep Edit → Settings → Page Layout. Clearly show application, document or current-section scope; changing one must not silently change another. |
| Headers/footers | Double-click the page edge to edit; provide a menu/keyboard route. Small local controls for first/odd/even and section linking. |
| Tables/images | Select or right-click the object for relevant controls. Numeric property dialog for precision; direct manipulation for frequent changes. |
| Find, outline, review | Reuse a single optional side-panel location. Opening one replaces that panel's previous content and preserves its state. No permanent panel stack. |
| Comments/revisions | Small margin indicators and a focused popup; optional full review panel. Unreviewed content remains clearly discoverable. |
| Print | File → Print… with platform printer dialog and a preview from the qualified publication layout. |

Context menus follow the existing dictionary-plus menu style: compact square surfaces, thin dividers, matching type size and UI scaling. Right-click and hover are accelerators, never the only way to use a feature. Provide keyboard focus and dismissal, tooltips and screen-reader names for glyph-only actions.

Preserve Cambria as the authored default. Missing fonts must be identified and substituted for display without rewriting the saved font choice. Persist application preferences and panel sizes globally; persist styles, sections, language and layout inside the document. Document-specific settings must travel with `.alder` and supported DOCX output.

## 4. Engineering foundations

### A. One document contract, separate views

Introduce versioned migrations for the existing schema rather than silently expanding version 1. Define stable identifiers for structural blocks, notes, references, sections and annotation ranges. Use transaction mapping for edits, with explicit split/join/move/copy rules: a move retains identity; a copy receives new identity.

Separate the main text, header/footer content and notes while keeping their relationships in the same document. Define an explicit projection for each consumer: editing, search, counts, proofreading, narration and publication. Keep the original authored content; speech reference suppression must remain a reading policy.

Extend the existing text-position mapping instead of introducing unrelated offsets for each feature. Define UTF-16/code-point/grapheme boundaries, deleted-text behaviour and source-revision checks. An old proofreading result or speech boundary must never apply to different text after a move.

Pages remain derived layout. Do not turn every displayed page into an isolated editor document. Arrangement moves paragraphs, sentences and explicit page ranges through the same command/transaction layer as Write. Page movement should preserve the current explicit-break behaviour until a deliberate alternative is designed, with undo restoring the exact prior structure.

### B. Commands and sessions

Create a shared command registry with availability, selected/mixed state, execution, shortcut and history grouping. Menus, toolbar, keyboard and context menus must invoke the same behaviour.

Keep an editor session per open document/chapter or restore equivalent state without losing history. Unify chronological undo across typing, formatting, Arrangement and structural edits without letting Undo accidentally affect another open document. Distinguish undo from durable version recovery. Bound memory use as more documents are opened.

### C. Layout decision before advanced page features

The existing browser/ReportLab split is the highest architectural risk. Prototype mixed sections, repeated table headers, a split paragraph, wrapped image and flowing footnote using the same sample document.

Evaluate extending the browser paginator with a shared layout model against adopting a dedicated pagination/typesetting component. Score caret accuracy, edit latency, footnotes, table splitting, font metrics, PDF accessibility, Windows/macOS/Linux packaging, licensing and maintenance. Browser printing alone is not evidence that these requirements are solved.

The required outcome is one authoritative page map consumed by Write, Arrangement, page counts, following narration, print preview and PDF generation. It may use multiple rendering components, but those components must agree on line and page boundaries. Reflow should start at the changed region and stop when subsequent layout stabilises; fonts, images and layout settings need explicit invalidation.

Do not replace the current engine until the prototype passes its fixtures. Keep the current PDF proof authoritative during transition and identify any remaining editing-preview differences. Identical pagination to every Word installation is not a realistic blanket promise: fonts and layout implementations differ. Qualify a declared compatibility subset using known fonts and real Word files.

### D. Compatibility is part of each feature

Every feature needs an import rule, editable representation, save rule, export rule and unsupported-content policy. Detect unsupported structures before editing/saving. Preserve the source and offer a working copy or clearly reported conversion where faithful saving is not possible.

Investigate retaining unsupported DOCX package parts only where relationships remain valid after editing. Blindly copying XML parts is not a preservation strategy. Never silently discard notes, tracked deletions, fields or embedded-object content and then overwrite the source as if nothing changed.

## 5. Phased implementation backlog

Effort labels describe relative engineering risk, not delivery promises. Phase 0 should produce measured estimates and small implementation tickets. Compatibility, accessibility and performance work belongs inside every phase.

### Phase 0 — Establish the contract and baseline

**Risk: medium. Prerequisite for architectural changes.**

1. Create a capability matrix separating editable, preserved-only, converted and unsupported features for each format.
2. Assemble legal-to-use fixtures: ordinary letters, essays, reports, books, research papers, tables, images, tracked manuscripts and multilingual text. Include files authored in Word on Windows and Mac, plus malformed/unsupported examples.
3. Capture baseline semantic output, rendered pages, editor caret positions, file sizes, load/save/reflow latency and narration concurrency.
4. Design the schema migration, stable anchors, command registry and session ownership. Prototype the layout choices described above.
5. Specify supported behaviour for `.txt`, Markdown, DOCX and `.alder`; adding rich formatting to plain text must make the required format conversion clear.
6. Correct outdated documentation and link test fixtures to each claimed capability.

**Exit gate:** reviewed architecture decisions, reproducible baseline, tested migration prototype, feature support matrix and a chosen layout approach supported by evidence. Do not schedule full Word compatibility on the basis of basic text extraction tests.

### Phase 1 — Reliable everyday editing and saving

**Risk: medium to high. Depends on Phase 0 contracts.**

1. Replace default-only toolbar values with real selection state, including mixed formatting. Allow typed font sizes and preserve selection while menus/dialogs have focus.
2. Expose existing strike, subscript, superscript, colour and highlight support. Add separate clear character formatting and reset paragraph formatting commands; neither should delete links, notes or semantic structure.
3. Complete paragraph controls: before/after spacing, left/right/first-line/hanging indent, line spacing, tab stops and leaders. Add an optional ruler using the same stored properties.
4. Improve styles: full heading levels, title/subtitle/body defaults, next-paragraph style, create/update from selection, clear direct overrides and safe replacement of an in-use style.
5. Add source-formatting, match-destination and plain-text paste choices. Handle Word/browser clipboard HTML, lists, images and links without importing arbitrary active content. Add undoable smart quotes, dashes, list starts and autocorrect preferences.
6. Add a persistent compact Find panel: next/previous, result count, replace one/all, match case, whole word, selection/chapter/document/book scope. Advanced patterns can live behind an expander with a preview of replacements.
7. Implement file identity, Save, Save As, Save a Copy, original-format handling and external modification detection. Distinguish local autosave from the state of the external file. Fix cancellation paths so cancelling a save never reports a successful file save.
8. Preserve editing sessions across document/chapter switches. Add recovery/version browsing over the existing durable store; test crashes, disk-full errors and conflicting external edits.

**Exit gate:** write, format, search, paste, switch files, undo, save and reopen a realistic document without changing unrelated formatting, losing history or overstating save success. All actions work in Write and applicable Sandbox contexts with correctly isolated selection.

### Phase 2 — Professional flow, sections and lists

**Risk: very high. Depends on Phase 0 layout decision and Phase 1 paragraph model.**

1. Introduce real sections with next-page, continuous, odd-page and even-page breaks. Support page size, custom dimensions, orientation, separate margins, mirror margins/gutter and section numbering.
2. Implement keep-with-next, keep-lines-together, widow/orphan control, page-break-before, paragraph background/borders and optional language-aware hyphenation. Preserve explicit line/page breaks.
3. Implement rich headers/footers, first/odd/even variants, link-to-previous, page/total-page fields and chapter/section-title fields. Show them accurately in Write and Arrangement.
4. Replace text-prefix list export with genuine DOCX numbering definitions. Add restart/continue, starting value, marker format, nested numbering, indentation and heading-numbering styles. Support matching import.
5. Add section columns and column breaks after ordinary section pagination is stable. Handle tables/notes and transitions without making each column a separate document.
6. Use incremental page layout and a stable page map for navigation, current-page reporting, selection counts and narration following. Zoom/UI scaling must not change the underlying printed page geometry.
7. Introduce File → Print, page ranges, copies and platform printer settings using the same qualified output as preview. Treat printer-driver scaling as an explicit output option.

**Exit gate:** a report containing portrait/landscape sections, front-matter numbering, running matter, multilevel lists and difficult page breaks has consistent Alder editing/Arrangement/preview/PDF pages, correct caret hit-testing and structurally valid DOCX output.

### Phase 3 — Complete tables, images and captions

**Risk: high. Basic object UI can start after Phase 1; pagination depends on Phase 2.**

1. Replace fixed-size table insertion with a small dimension picker and numeric alternative. Add insert/delete rows and columns on either side, move rows, merge/split cells, split/join tables and text/table conversion.
2. Add cell alignment, padding, borders/shading, row height, column widths, distribute evenly, fit-to-content/page and table alignment. Provide keyboard cell navigation and multi-cell selection commands.
3. Implement repeated headers, row splitting rules, merged-cell pagination and captions. Preserve cell widths and row/column spans in DOCX/PDF. Add simple sorting for ordinary tables; defer spreadsheet-like calculation to a specialist extension.
4. Add inline and anchored images, aspect-locked resizing, crop, replace, alignment, spacing and common wrapping options. Numeric controls complement square drag handles. Editing the image must not replace its caption or alt text.
5. Add editable alt text/decorative status, captions and numbered figure/table references. Keep anchors stable when text or Arrangement units move.
6. Add advanced positioning and text boxes only after anchoring/wrapping survives import, reflow and export. Reuse the same object properties surface.

**Exit gate:** an illustrated, multi-page report with merged tables survives edit/save/reopen/Word exchange without duplicated cell text, flattened layout, missing images or detached captions. Object dragging and resizing are undoable and remain responsive.

### Phase 4 — Long-document and research tools

**Risk: high. Depends on stable anchors, sections, styles and pagination.**

1. Add a heading outline with search, jump, collapse and drag-to-reorder; moving a heading can include its subordinate content in one undoable operation. Integrate with existing chapter navigation and Arrangement rather than inventing another editing mode.
2. Add named bookmarks, heading/figure/table/note cross-references and fields such as page, page count, date and document properties. Define when fields update and how to show unresolved targets.
3. Add an in-document heading-based table of contents, list of figures/tables and index with generated page references. Updating generated content must preserve its chosen styles.
4. Implement true footnotes/endnotes with automatic numbering, configurable placement and restart rules, editable note bodies and DOCX import/export. Footnotes must reserve page space and flow with their anchors; an end-of-document text list is not equivalent.
5. Add a local source library and citation insertion, starting with well-defined common styles, locators, numeric/author-date citations and bibliography generation. Evaluate a maintained citation processor and its licence instead of hand-writing every style. Support interoperable source import/export where qualified.
6. Connect structured citations and notes to Read references, retaining its off-by-default behaviour. Preserve the existing heuristic for imported inline references. Define note-reading order explicitly; hiding references during speech never removes authored references.
7. Add reusable document/style templates and structured front/back matter. Keep templates in the existing New flow without increasing the default start window's complexity.

**Exit gate:** a book or research paper remains correctly numbered and linked after paragraphs, sentences, pages and chapters move. Contents, notes, citations and cross-references update accurately in Alder and supported exports.

For the benchmark, Word's contents feature derives entries from document headings and supports updating after structural changes. Alder should meet that functional expectation using its own compact interface. [Microsoft: table of contents](https://support.microsoft.com/en-gb/word/training/insert-a-table-of-contents?nochrome=true).

### Phase 5 — Editorial review and exchange

**Risk: very high. Annotation foundations start in Phase 0; complete review follows stable editing/structure.**

1. Add anchored comments with author/time, replies, resolve/reopen and previous/next navigation. Deleted or moved anchors need explicit, recoverable behaviour.
2. Add tracked insertions, deletions, formatting and structural moves, including Arrangement operations. Record authorship and transaction groups. Support final/original/markup views without discarding hidden revisions.
3. Add accept/reject one, selection, author or all, with undo. Keep revision markup visually distinct from spelling, grammar and TTS highlights.
4. Extend DOCX import/export to comments and tracked edits. Qualify nested/overlapping revisions, tables, fields and notes. Unsupported revision cases must not be silently accepted or dropped.
5. Add compare-two-documents and combine-reviewed-copies workflows. Produce a new reviewed result; retain both inputs. Handle moves, formatting and comments, not just a plain-text diff.
6. Provide a pre-export review of unresolved comments/revisions and an explicit clean-copy option. Keep metadata removal separate from accepting edits.
7. Define the visible/narrated text for each review view. Narration, counts and proofreading must not include hidden deleted text accidentally or apply stale suggestions after accept/reject.

**Exit gate:** a manuscript can travel Alder → Word → Alder with comments and tracked edits intact, be compared with another copy, and be accepted/rejected with reliable undo. Author names and unresolved work survive saving and reopening.

Word treats review as persistent author-attributed revisions with navigation and accept/reject, not as an undo list. That is the target behaviour. [Microsoft: Track Changes](https://support.microsoft.com/en-us/word/training/track-changes-in-word). Its compare workflow can create a revised copy while preserving the original; Alder should preserve both inputs as well. [Microsoft: compare documents](https://support.microsoft.com/en-us/word/compare-and-merge-two-versions-of-a-document).

### Phase 6 — Qualification and specialist completion

**Risk: high and ongoing. Most qualification work begins in earlier phases.**

1. Complete the independent proofreading evaluation and concurrent speech tests already identified in the proofreading plan. Improve invalidation, paragraph caching, language metadata and cross-paragraph checks without adding typing latency or mandatory cloud calls.
2. Qualify keyboard-only use, NVDA on Windows, VoiceOver on Mac and an appropriate Linux screen reader. Provide accessible table/navigation semantics, meaningful headings, object alt text and document language in output.
3. Qualify bidirectional paragraphs, mixed Arabic/Hebrew/Latin runs, CJK IME/composition, Thai segmentation, combining characters and emoji. Add language/direction controls and shaping/font fallback rules without altering authored text.
4. Add tagged PDF and document accessibility checking. Validate actual reading order, headings, table headers, links and alt text; searchable PDF text alone is insufficient. Offer PDF/A or PDF/UA only after the selected export engine and validators support the claimed profile.
5. Complete the supported DOCX matrix and publish remaining limitations. Test native Word on Windows and Mac; use LibreOffice as an additional independent check, not a substitute for Word compatibility evidence.
6. Implement the specialist extensions below according to demand and the same quality gates. They must remain absent from the default toolbar until relevant.

| Extension | Scope and minimal surface |
| --- | --- |
| Equations and symbols | Inline/display mathematics, accessible representation and qualified DOCX equation conversion; Create → Document → Equation. |
| Forms/content controls | Plain/rich text fields, checkboxes, dates and bounded editing restrictions; properties appear on selection. Distinguish editing restrictions from encryption/security. |
| Mail merge | Local CSV/data mapping, field preview, record selection and output generation; a compact wizard. No automatic emailing. |
| Labels/envelopes | Page templates and printer setup presets, using the same page/layout pipeline. |
| Advanced page furniture | Watermarks, line numbering and page borders in Page Layout; not extra toolbar controls. |
| Additional file formats | Improve ODT/RTF import/export according to a declared subset; legacy binary formats remain conversion workflows until qualified. |
| Advanced objects | Text boxes, basic shapes and anchored object ordering after layout/compatibility groundwork; avoid turning Alder into a general graphics editor. |

Microsoft's accessibility guidance includes document structure, alternative text, useful links and accessible lists/tables. These are useful output-quality requirements regardless of Alder's visual design. [Microsoft: accessible Word documents](https://support.microsoft.com/en-us/accessibility/word/make-your-word-documents-accessible-to-people-with-disabilities).

Real-time coauthoring, account/cloud storage, VBA/macros and an add-in ecosystem are separate product programmes. They are not prerequisites for excellent local word processing and should not expand this implementation by default. Collaborative file exchange through comments and revisions is included above.

## 6. Performance, testing and release gates

### Proposed performance targets

These are engineering targets to validate in Phase 0, not claims about today's performance. Record hardware, OS, fonts, document complexity and warm/cold state with every measurement.

| Workflow | Initial target |
| --- | --- |
| Ordinary typing and selection | Key-to-visible-update p95 under 50 ms on the agreed baseline machine, with proofreading/narration active. Avoid full-book work on each keystroke. |
| Scrolling, caret following, Arrangement dragging | Smooth 60 Hz presentation where hardware permits; keep routine interaction work within the roughly 16.7 ms frame budget. |
| Local formatting and reflow | Visible affected-page update within 100 ms for ordinary edits; paginate farther content incrementally without stealing focus or moving the caret. |
| Open/save/export of large files | Progress and cancellation for long operations; measure 10-, 100- and 500-page documents plus a 1,000-page stress case. Set time/memory budgets from baseline evidence. |
| Multiple open files | Bound inactive editor/render/cache memory, restore state without losing undo or selection, and measure repeated open/switch/close cycles. |
| Narration | Preserve the audio-clock scheduling path. No layout, full-document mapping or large React render for each word. Measure audio underruns and highlight timing during edits, scrolling and checks. |

Profile DOM measurement, whole-project cloning, serialisation, snapshots and background analysis separately. Move CPU-heavy parsing/checking/export off the input path; DOM layout still needs careful scheduling. Virtualise off-screen page depictions and previews first. Do not virtualise editable content until selection, IME and screen-reader behaviour have been demonstrated.

Current validation limits include a 40 MB structured project, 250,000 document nodes, depth 50 and bounded imports/assets. These are resource safeguards, not spelling-check limits. Reassess them using the corpus, improve large-document storage/streaming when needed, and present clear errors rather than removing all bounds blindly.

### Verification layers

1. **Model/transaction tests:** schema migration; split/join/move/copy; list identities; table spans; style inheritance; range mapping; undo/redo; generated fields; revision accept/reject. Include property-based/fuzz tests for malformed or overlapping structures.
2. **File tests:** parse → edit → save → reopen semantic comparisons; source preservation; unsupported-content reports; valid DOCX relationships; atomic save, cancellation, disk-full and external-conflict cases.
3. **Rendered-document tests:** known-font page counts, line breaks, margins, headers, notes, merged tables and output order. Allow justified raster differences but never missing/overlapping content. Compare Word files using real Word rendering where claimed.
4. **Desktop interaction tests:** real clicks/keystrokes, scaled monitors, 50–150% UI scale, Write zoom through 300%, tab switching, Sandbox selection, IME, undo and Arrangement. Test Windows, Linux, Apple Silicon and Intel Mac with their documented capabilities.
5. **Accessibility and performance tests:** keyboard/screen-reader tasks, export reading order, long documents, multiple tabs and concurrent proofreading/TTS. Human review supplements automated checks.

Extend the existing frontend, backend and Electron regression suites rather than building a disconnected test application. Store fixture provenance and expected limitations with the fixtures. Do not introduce an arbitrary page cap to make a benchmark pass.

### Definition of done for each feature

- Correct schema and migrations; old projects remain recoverable.
- Usable by mouse and keyboard, with stable selection and undo.
- Same command semantics in toolbar, menus and shortcuts.
- Saved/reopened without loss; explicit format limitations before destructive conversion.
- Correct in applicable Write, Arrangement, Sandbox, speech and proofreading paths.
- Supported import/export properties survive a qualified round trip.
- Fits Alder's visual style and scales without layout jumps.
- Cross-platform evidence and performance measurements are recorded honestly.

Block release for silent content loss, corrupt saves, wrong-range corrections, disappearing review data, caret/text misalignment or reproducible unbounded reflow. A warning about unsupported conversion is appropriate; it is not a substitute for correctly implementing a feature advertised as supported.

## 7. Recommended first implementation batch

Start with a bounded batch that improves daily use and exposes architectural issues early:

1. Add the capability/fixture matrix and baseline instrumentation.
2. Introduce the shared formatting-command/state layer; fix heading/font-size/mixed-selection feedback and editable size.
3. Complete the compact Paragraph dialog and expose existing character marks through overflow.
4. Establish Save/Save As/file identity, truthful cancellation feedback and session-preserving undo.
5. Improve Find/Replace and paste options using the same commands/history.
6. Run the layout prototype and decide the shared page-map approach before implementing sections, footnotes or complex wrapping.

The first acceptance document should include mixed formatting, real lists, a table, an image, multiple chapters and imported Word content. Test editing it, switching documents, rearranging a paragraph, undoing, narrating, saving and reopening. This creates a useful professional baseline while keeping the default interface close to its present size.

## 8. Main dependencies and decisions

| Decision/dependency | Resolution point |
| --- | --- |
| Extend current paginator or adopt a dedicated component | Phase 0 prototype, before Phase 2 implementation. |
| File identity, autosave versus file save, undo ownership | Phase 0 design and Phase 1 implementation. |
| Versioned schema, stable anchors and annotation representation | Phase 0, exercised before shipping new document structures. |
| Real numbering, section stories and shared style resolution | Phases 1–2; required for credible DOCX exchange. |
| Footnote layout, field updates and generated page references | Layout prototype first, full implementation Phase 4. |
| Comments/revisions under Arrangement moves | Anchor design in Phase 0; review qualification in Phase 5. |
| Citation processor, equation representation and specialist libraries | Evaluate when their phase begins; verify licences, local operation and supported conversion. |
| Word-equivalent feature claims | Only after the corresponding semantic, visual and user-workflow gates pass. |

Word's section model allows headers and footers to be linked or independent across sections. Alder needs equivalent document semantics even though its editing controls will be smaller. [Microsoft: section headers and footers](https://support.microsoft.com/en-us/word/configure-headers-and-footers-for-different-sections-of-a-word-document).
