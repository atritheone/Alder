# Alder word-processing development plan

Status: implementation in progress. The complete plan and its release gates have not been achieved; retain this file until they have.

## Continuation — running chapter and section headings

Header/footer field insertion now offers Heading 1–6. Each physical sheet shows its first matching heading, otherwise the last preceding one, otherwise the first following one. Included chapter context supplies previous/following headings and book chapter titles to the chapter editor; publication titles are not misclassified as chapter headings. Body heading fields resolve on insertion and explicit Update fields. Running values are derived separately from authored text, with cached heading indexes and a single pass over pages. Empty headings and recursive field values are handled without retaining stale text. PDF overlap validation includes each actual running-heading value.

Windows checks pass live heading editing, undo, field insertion, persistence, Arrangement and 50/100/150% UI scale. The four-page desktop PDF has the expected headings; a rendered page was inspected. Native Word 16.0 updates, renders and resaves built-in and custom-style STYLEREF fields. Direct backend PDF resolves its own physical running headings. HTML/EPUB retain fields as metadata and body fields refresh before plain exports. Word can bind a semantic heading level only when it has one dedicated paragraph style: ambiguous mixed/shared styles cause an actionable export error, and ambiguous external STYLEREF instructions retain cached text with the existing conversion warning. This follows [Microsoft's STYLEREF rules](https://support.microsoft.com/en-gb/word/field-codes-styleref-field).

TypeScript and 305 frontend tests pass; the new backend/exchange fixtures and related running-story/numbering tests pass. Full-book page numbering in separately opened chapters, general objects in running stories, mirrored margins, columns and the remaining original plan are still open. Do not delete this plan.

## Continuation — table row breaks and frozen cell geometry

Table properties now offers Keep row together / Allow across pages for selected rows, with mixed selection state and one-step undo. Existing Alder rows retain their keep-together behaviour; rows too tall for a sheet still divide to retain their text. Ordinary top-aligned paragraph cells can now use the remaining page space, retain independent cell page ranges and repeat headings. A heading at the bottom moves with the first body line. DOCX uses native `cantSplit` and imports both implicit and explicit false forms; native Word 16.0 renders and resaves both settings. HTML/EPUB, clipboard and saved model data retain the property. Direct ReportLab PDF also honours per-row choices. Vertically merged, nested and middle/bottom-aligned row splitting remains open; the properties dialog explains the current Write limit while preserving Word's setting.

Read-only Arrangement/PDF table copies freeze the measured cell grid instead of asking Chromium to reflow collapsed borders at a different print pixel scale. This fixes accumulated border rounding and a missing final border. It retains middle/bottom text offsets and merged-cell dimensions, and leaves the editable table native. The row fixture verifies ownership, text bounds, 50/100/150% UI scale, zoom through 300%, full reflow agreement, actual properties/undo, clipboard, continuation-cell typing and PDF. Native Word produces three pages with rows together and two when allowed to split. Full backend tests pass 566; TypeScript and 300 frontend tests passed before the final paint-only extension, followed by focused desktop checks. Remaining table/layout and cross-platform gates are not complete.

Mirrored margins were investigated but are not delivered: a spanning paragraph/table needs page-specific horizontal placement with correct caret hit-testing, not just alternate background insets. This remains part of the shared layout work alongside columns, flowing notes and the other original requirements. Do not delete the plan yet.

## Continuation — continuous sections

Section properties now includes Continuous. Text stays on the same sheet when the paper size is unchanged; new horizontal margins apply immediately, while the next physical sheet adopts vertical margins, running stories, number format and restart offsets. A change in paper dimensions starts a new sheet. These rules were established using native Word 16.0 experiments, including a numbering restart midway down a page and the first-page running variant. DOCX preserves genuine continuous sections on export/import; HTML/EPUB preserve metadata. Direct backend PDF reports its next-page conversion, while desktop PDF uses the editing page map.

Windows desktop checks cover ordinary continuation, a restart, different-first-page stories, changed paper, horizontal margins and vertical margins, with matching Write/Arrangement/PDF page ownership. A 600-paragraph, 17-page probe with multiple continuous boundaries matches a fresh layout after edits at four locations and after growth to 27 pages. It restores deferred section state when resuming incremental pagination; observed edit-to-page-map times were 14–35 ms and fresh layouts 39–44 ms on this machine in a foreground isolated test desktop. These are four local samples, not the broader performance/concurrent speech gate. Section properties changes and undo also pass. Columns, mirrored margins, general objects in running stories, chapter fields and the remaining original plan are still unfinished.

## Continuation — formatted running headers and footers

Document and section headers/footers now have separate formatted paragraph stories, first/odd/even variants, independent link-to-previous controls, edge distances and page/total-page fields. The existing formatting menu and margin double-click open a compact editor; Settings → Publication opens document defaults. Apply has project undo, Cancel leaves the source untouched, concurrent settings changes invalidate Apply, and overlapping running text is refused with a margin-specific explanation. Style usage/replacement and metadata field refresh include running stories and frozen placements. Paragraph tabs/leaders and exact leading use the existing layout code with bounded cached paint and no retained extra editor sessions.

Windows desktop checks pass editing/cancel/undo/redo, section linking, overlap rejection, save/reopen, Arrangement, live page values and 50/100/150% UI scales. Three-page desktop PDF text and running variants were checked and a rendered page inspected. Native Word 16.0 recognises first/odd/even stories, updates PAGE/NUMPAGES and retains formatting and independent section links after resaving. HTML/EPUB preserve running metadata, including section overrides; plain outputs report omission. Direct backend PDF paints the supported paragraph stories and page numbers, reporting cached total-page values. The previous complete backend run passed 554 tests; later focused additions pass. TypeScript and 297 frontend tests passed before the additional total-field regression.

This is the formatted-paragraph running-story path, not all phase-2 requirements. General objects/tables in running stories, automatic margin enlargement, chapter/heading fields, full-book editing-page numbering across separately opened chapters, continuous sections, columns and the remaining original plan stay open. The plan is not complete and must not be deleted yet.

## Continuation — figure/table lists and inline page fields

The contents dialog now includes Headings, Figures or Tables, with appropriate default titles, entry styles and optional page numbers. Figure/table lists use the current independent caption sequences, not stale cached numbers, and preserve source links. Desktop checks pass insertion, calculated page numbers, undo, persistence and excluded-chapter handling. Native Word 16.0 recognises both caption lists through its TablesOfFigures collection, updates their fields, preserves the chosen Arial 14 entry style and resaves them for reimport. HTML/EPUB retain each list's kind and entries. Word shares the caption-list style across figures and tables; incompatible per-list native-update styles are reported.

Insert field now offers Page number and Total pages in Write. Insertion paginates a hypothetical publication before committing one undoable edit; cancellation or concurrent changes invalidate the result. Explicit Update fields and desktop PDF resolve values from the physical page map, including section numbering and blank sheets. Document-property refresh cannot overwrite these values. Native Word uses PAGE and NUMPAGES fields and passes update/render/resave qualification. Nonpaginated outputs retain cached values and report that limitation. Sandbox does not offer page fields. Page references can also target point bookmarks without requiring a text selection.

TypeScript, focused model/exchange tests, and the Windows field/list desktop workflows pass. The preceding complete backend run passed 546 tests; newer focused runs cover this extension. General imported Word TOCs, index entries, flowing notes, rich running stories and the other original plan requirements remain open.

## Continuation — generated contents and page references

Write's existing formatting/context menu now inserts or edits an in-document contents block, with title, heading depth, entry style and optional page numbers. It includes headings from included chapters, numbered where applicable, and retains stable links. The block can be selected, moved or deleted as a whole; ordinary case changes, Arrangement sentence/paragraph moves and correction replacements cannot rewrite its generated entries. Read references controls whether it is narrated. Explicit Update fields refreshes contents, wording and page references in one document operation. Existing entry formatting survives regeneration, including new entries after importing resolved styles.

Contents with page numbers paginate a hypothetical complete publication before insertion, without writing a temporary project or changing the editor. The final insertion retains a single undo event. Cancelled or stale calculations cannot overwrite the current document. A detached renderer resolves page-reference fields against physical pages and section numbering, repeating layout until stable with a bounded pass count. PDF uses those resolved results; Update fields uses the same full-publication path without generating a PDF. The page-reference display is also available for existing cross-reference targets. No background pagination is added to ordinary typing or speech highlighting.

Windows desktop qualification covers a 45-entry contents block spanning two sheets in a seven-page publication, style retention, refresh, persistence, navigation and undo. All 45 displayed page references match their actual PDF body pages; every heading is extracted exactly twice, once in contents and once in the body. The rendered first page was inspected. This also caught and removed a ProseMirror selection outline from printed output. Native Word 16.0 recognises, updates, renders and resaves the TOC and nested PAGEREF fields, preserving heading depth, page numbers and chosen font/size. Word's built-in TOC styles need their native lowercase names and built-in identity; custom lookalike names are replaced by Word's updater. HTML/EPUB retain the generated block and cached page values; Word-generated TOC hyperlink targets are rebound on import.

This qualifies the supported heading-contents path, not all long-document features. General imported Word TOCs, page/page-count fields at arbitrary locations, lists of figures/tables, index entries, notes, rich running stories and cross-platform qualification remain open. Word shares TOC entry styles document-wide, so multiple differently styled contents blocks report that native-update limitation. HTML/EPUB and direct backend PDF do not recalculate page references using the desktop layout. The full plan remains in progress.

## Continuation — heading numbering and number references

Paragraph settings and paragraph styles now offer six-level decimal heading numbering. A paragraph can restart its level or explicitly turn off inherited numbering. Numbers derive from included chapter order without entering authored text, undo history, spelling or speech. Rearranging headings recomputes their labels; skipped ancestors display as 1 without consuming an ancestor's next number. Heading Enter clears a copied explicit restart. Markers use the same layout in Write, Arrangement and desktop PDF.

Cross-references can display heading text or the full heading number. Explicit Update fields refreshes these with other references; publication refreshes its detached snapshot. HTML/EPUB preserve numbering and reference formats. DOCX uses native multilevel numbering and REF with the full-context `\w` switch, as specified by [Microsoft's REF field documentation](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/7088a8ce-e784-49d4-94b8-cba6ef8fce78). Native Word 16.0 updates, renders, resaves and reimports the hierarchy, restart, skipped level and number reference without freezing ordinary continuation. Generated bookmark ranges are recovered without accumulating extra ranges on repeated exchanges.

Windows desktop checks pass restart/undo/redo, number-reference insertion and preview, persistence, explicit removal and shared PDF; the numbered PDF was inspected. TypeScript and focused frontend/backend tests pass. Arbitrary heading-number formats, list-based heading collisions, native Word paragraph-format revisions involving heading numbering, generated contents/page references and the full cross-platform release gates remain open.

## Continuation — shared desktop PDF layout

Desktop PDF export, Page Preview and its print proof now freeze a semantic publication snapshot, lay it out in an isolated editor renderer, and print the captured editing page map. The visible editor, selection and undo session remain intact. One hidden renderer runs at a time, with bounded lifetime and cleanup on failure. Images are collected and cropped into detached raster resources before layout; missing resources fail explicitly. Installed fonts and the bundled fallback follow the editing font policy. Final/original review projection, resolved styles, fields and references are applied on the snapshot without accepting source revisions. Bookmark and reference links receive destinations only on their owning physical sheet, including a bookmark inside a spanning paragraph.

The backend verifies the snapshot identity, PDF page count and each physical page size before exposing the result. Windows production-route fixtures pass ordinary seven-page, mixed-size ten-page and rich three-page documents. Every authored test marker matches the editor's corresponding page exactly once. Cropped inline/standalone images, tab leaders, exact leading, paragraph decoration and internal links are verified; ordinary/rich rendered pages were inspected. The ordinary Preview/return workflow preserves the same editor, caret and undo. TypeScript and 282 frontend tests pass; the backend suite passes 533 tests before the additional destination-normalisation regression.

This promotes the shared layout into the desktop PDF path, not the entire architecture gate. Direct headless/backend PDF callers still use ReportLab and must not claim matching page boundaries. Complex merged/nested tables, flowing notes, rich running stories, continuous sections/columns, very large export memory, PDF tagging, real concurrent speech and macOS/Linux graphical qualification remain open. Existing historical records below describe earlier checkpoints; this continuation supersedes their statement that all production PDF uses ReportLab.

## Continuation — tracked text and formatting

The formatting/context menu now offers Review changes in Write and Sandbox. The project retains its tracking preference and author. Supported edits include inline text insertion/deletion, character and paragraph formatting, ordinary paragraph splits/joins, multiline paste and replacements across sibling prose paragraphs. Select All replacement/deletion preserves the original prose and paragraph styles. Combined text/formatting transactions retain mapped selections, including Enter followed by the next paragraph style. Continuous typing groups share an identity; one author's pending insertion can be cancelled without accepting another author's edit. Accept/reject works by current change, original selection, shown author or all changes in the active editor, with a separate undo event. A compact read-only document preview offers original/final/markup views. This is not yet an original-view editable workspace or whole-book review controller.

Attribute-level formatting history retains independent pending/accepted/rejected records, so accepting a later size or spacing change does not accept an earlier family or alignment change, and rejecting an earlier change does not erase a later accepted override. Markup editing retains deleted wording; narration, counts, selected-text projection, reference wording and correction guards exclude pending deletions. Desktop qualification caught Chromium collapsing selections beside a non-editable deletion mark; deletion spans now participate in ordinary selection while the transaction engine retains their review evidence. With tracking off, supported ordinary edits preserve unrelated pending revisions; accepted formatting patches remain only as long as needed to retain independent earlier decisions. Comments remain independently editable. Unsupported tracking operations are rejected before application. General structural edits, Arrangement move revisions, replacements crossing objects and complex overlapping paragraph boundaries still need implementation.

Saved projects, Raw and HTML/EPUB retain revision metadata. Copied chapters and clipboard fragments acquire independent review identities. DOCX uses native insertion/deletion, paragraph-mark, run-property and paragraph-property revision structures. The production exporter passes native Word 16.0 open/render/resave/reimport for four inline revisions (including nested authors), two paragraph boundaries, a character-format revision and a paragraph-alignment revision, with identical original/final wording and qualified formatting. Unsupported moves, field/object revisions and non-representable formatting histories are rejected explicitly; overlapping separate formatting records are not silently folded into one Word author. Paragraph style/font revisions requiring companion run revisions and deleted boundaries between differently formatted paragraphs currently require review before Word exchange; both original appearances remain intact in Alder. Word support is a declared subset, not the full review exchange gate. Export reports pending changes and offers retained revisions, final wording or original wording without accepting the source changes.

The Windows desktop review workflow passes tracked replacement, independent formatting authors, preview wording, separate accept/undo/redo, persisted author/tracking and review records after reopening, paragraph formatting and split/rejection, multiline paste, Raw edits, independent copied changes, and rejected unsupported structural edits. At this checkpoint TypeScript and all 279 frontend tests pass, followed by additional Select All regressions; the full backend run passes 529 tests. Broader structural review, cross-platform, accessibility and real concurrent speech qualification remain open.

## Continuation — anchored review comments

The existing formatting/context menu offers Comments, also available with Ctrl/Command+Alt+M. Threads retain authors, timestamps, editable text, replies and resolve/reopen status. Selected passages use paired silent anchors; a cursor comment uses a point. The dialog navigates to the current passage, removes threads with undo, filters resolved threads and can reattach an incomplete anchor. Outline searches comment authors and wording across chapters. Annotation text is excluded from narration, counts and proofreading. Unchanged paragraph indices are cached rather than rescanning all text on a keystroke.

Clipboard copies have independent thread identities; Raw and saved projects retain the thread payload. Incomplete endpoints retain their review text. Invalid Raw metadata blocks conversion instead of silently discarding the comment. HTML/EPUB preserve annotation metadata; DOCX uses genuine comment ranges and the Word reply/resolution extension. Native Word 16.0 opens, renders and resaves a two-paragraph anchor with two authors, a reply and resolved status. This qualification caught and corrected the extended part's MIME type and added native reply anchors. The Windows desktop workflow passes insertion, separate undo, replies, resolve/reopen, passage navigation, clipboard, Raw edits and save/reopen. The full backend suite passes 500 and frontend suite 256 tests at this checkpoint.

Export shows unresolved comment counts and offers a copy without review comments, preserving the authored Alder project; plain publication formats omit review text and report that conversion. Review is not complete: tracked changes, compare/combine, revision acceptance, rich-comment formatting, comment fragments under partial Arrangement moves, cross-platform native exchange and accessibility qualification remain open.

## Continuation — date and document-property fields

The formatting/context menu adds Insert field for the current date (explicit YYYY-MM-DD), document title, author and subject. Fields retain a generated result and refresh with Edit → Update fields or automatically in detached exports. Empty properties cannot be inserted; if a previously populated property becomes empty, refresh shows an explicit placeholder and export reports it. Property/date refresh precedes cross-reference resolution. The fields remain atomic in Arrangement and protected from case changes and proofreading/find replacement. No arbitrary imported field code is executed.

HTML/EPUB retain supported fields and document metadata; DOCX writes native DATE/DOCPROPERTY instructions and imports that bounded subset. Native Word 16.0 field updating exposed a character-formatting defect: CHARFORMAT applies the instruction's first character, so exports now carry the authored run properties on paired field instructions. Native Word update/render/resave passes for all four fields with bold formatting retained, and the rendered page was inspected. The same paired representation also retains qualified REF formatting. Plain outputs refresh the displayed wording and report field conversion where applicable.

The Windows desktop check passes insert/cancel, separate typing/field undo, updating author metadata, caret mapping, Raw edits, save/reopen and date preview. Closing Settings now returns through the originating editor's selection API; document-start/end shortcuts explicitly set editor positions. The full frontend suite passes 252 tests, the backend suite passes 492 before the paired-field adjustment, and the subsequent 25-test field/reference/caption regression passes. Page/page-count/chapter fields, general date formats, arbitrary property instructions and the remaining plan are still open.

## Continuation — captions and numbered references

Image/table context menus now insert a caption above or below the object. The title remains editable prose; Figure and Table have separate automatic sequence fields. Initial numbering includes preceding included chapters, and Edit → Update fields renumbers moved/copied captions and their references in one undoable operation. Exports refresh a detached snapshot. Cross-references offer full caption, label and number, or number only. Caption/object/field identities remain paired when copied. Enter creates ordinary prose while the numbered half retains the caption identity. Moving an individual object carries its immediately adjacent caption in the same undo event; explicit selections containing both retain their authored placement. This uses changed slices to avoid document scans on ordinary typing.

HTML/EPUB retain editable captions, original object bindings and sequence/reference fields. DOCX uses native SEQ and REF fields with real bookmark ranges for the requested reference part. Reimport restores supported caption reference formats from verified bookmark boundaries; repeated exchanges do not accumulate generated ranges. Native Word 16.0 updates, renders and resaves two caption sequences and all three reference formats. PDF uses refreshed numbers/text. Word caption associations are recovered only for an adjacent supported object. General wrapped-object anchoring, split-table/caption page constraints, page-number references and full caption layout qualification remain open.

Windows desktop checks cover insert/edit/undo, initial cross-chapter numbering, copy/renumber, save/reopen, short-reference previews, actual image dragging with its caption and a single undo. Raw-source editing now retains cropped inline/standalone image metadata and identity through the same schema serializer; a real Raw-edit/return check passes. The complete frontend suite passes 249 tests; the backend suite passed 481 before the additional three short-reference exchange tests, and their 17-test caption/reference subset passes. TypeScript, Vite, Electron and the Windows native menu module build successfully. These checks do not complete the full plan or qualify other operating systems.

## Continuation — passage bookmarks and text cross-references

Bookmarks now retain selected passages with paired stable endpoints, select their current wording on navigation, and copy/rename/remove with both endpoints in one undoable action. Incomplete ranges remain visible in the bookmark dialog and preserve all text; publication reports a point conversion when a complete range is unavailable. Native Word 16.0 retains a range spanning paragraphs after opening, rendering and resaving. Windows desktop checks cover edits, copying, save/reopen and undo; bookmark context previews read only a bounded prefix.

Insert cross-reference in the existing formatting/context menu offers heading text and bookmarked passages. Ctrl/Command-click navigates to the source across chapters. Edit → Update fields refreshes stored results together in one undoable project operation and maps the active caret through changed results; exports refresh their detached snapshot automatically. Missing, excluded, empty, ambiguous and circular targets keep the last result and are marked unresolved. Copied targets and their references are independent; references to targets outside the copied fragment retain their source. Generated wording is protected from find/proofreading replacement, remains atomic in Arrangement even when it contains multiple sentences, and follows Read references during narration.

HTML/EPUB retain reference metadata. DOCX uses native REF fields and generated heading bookmark ranges; native Word 16.0 updates, renders and resaves both heading and passage references. CHARFORMAT prevents heading styling from replacing the reference's surrounding text style when Word updates it. Supported simple/paired REF fields import as references; unsupported field instructions retain their cached text with a warning and are never executed by Alder. See [Microsoft's field representation](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.simplefield). PDF contains updated wording and internal links; Markdown retains ordinary wording with a conversion warning. Page/number/date/property fields, rich reference formatting, captions, generated contents and full field compatibility remain open. The full backend suite passes 477 tests and the frontend suite passes 238 at this checkpoint, with subsequent focused Arrangement coverage. Cross-platform and full architecture gates remain open.

## Continuation — non-destructive image cropping

Image properties now offers four crop percentages and Remove crop in a collapsed Crop section, retaining the collected original and existing width/placement/description. Invalid crops cannot apply; Apply, removal and undo preserve focus and surrounding prose. The desktop workflow passes cropped pixel delivery, undo/redo, save/reopen and copying the crop with its original source. Generated display images use a bounded local disk cache; ordinary uncropped assets use their existing route. Publication reuses decoded image resources within an export.

HTML/EPUB retain the visible cropped raster and original resource with crop metadata. DOCX writes native source-crop properties and retains the complete original; native Word 16.0 opens, renders and resaves the crop, and its rendered page was visually inspected. PDF uses the cropped pixels. Crops are percentage-based with raster edges rounded to pixels; negative Word crops/padded image areas report conversion. This completes the numeric cropping path, not drag-to-crop handles, anchored wrapping, captions or the full image/layout qualification gate.

## Continuation — inline pictures

Insert image now places a picture within text when the selection supports it. Image properties offers In line with text / Own paragraph; changing placement retains surrounding text, marks, picture identity and undo. Inline pictures use the existing proportional drag/keyboard resize controls and retained alternative text, title and decorative status. Clipboard copies, templates and recovered versions retain collected images. Text projection excludes the image; adjacent corrections leave it intact, while corrections/search replacements spanning an inline object require separate text edits.

HTML/EPUB and DOCX retain inline pictures, including paragraphs containing only a picture. Explicit standalone DOCX drawings have a preserved drawing name so import can distinguish them. Native Word 16.0 opens, renders and resaves both placements and their descriptions. ReportLab PDF embeds inline pictures with baseline alignment and automatic leading for ordinary paragraphs. Word floating/cropped drawings currently report their conversion; anchored wrapping and cropping remain open.

Windows desktop checks cover placement/undo, proportional resizing, collected-image clipboard round trips, multi-page paragraphs, UI scales 50/100/150%, Write zoom through 300%, and full reflow agreement. Pagination measures the full inline picture line, and remeasures after display-scale compensation changes; this corrects pictures crossing the top page margin. The four-page browser publication retains all 28 test lines exactly once; a continuation page was visually inspected. Saved/reopened projects, recovery and templates retain their collected assets. General wrapped objects, cropping/captions, exact-leading image clipping, tagged PDF and cross-platform qualification are still open.

## Continuation — parallel table-cell page ranges

The shared page map now supports multiple authored intervals per physical page. Page lookup follows document reading order across parallel cells; selection page counts count the intersected pages, and browser publication includes each owned text interval exactly once. The existing continuous-range path remains cached for ordinary prose. Pages with disjoint cell content are not movable as one prose range; paragraph and sentence operations remain available.

Oversized rows with top-aligned paragraph cells and no vertical merges now flow each cell through the same physical pages, with repeated headers. Table/background paint is clipped at page bodies and leaves repeated-header space clear. Windows checks cover two long cells, 50/100/150% UI scaling, Write zoom through 300%, later-cell mouse placement/typing/undo, mixed section sizes, paragraph-per-line cells and full reflow agreement. The six-page browser PDF retains all 74 test lines exactly once and repeats its headers; a continuation page was visually inspected. Ordinary repeated-header/vertical-merge-group checks continue to pass. The prototype still uses full reflow for documents containing these fragmented rows. Nested tables, vertical merges spanning pages, middle/bottom alignment, user-controlled row splitting, cell borders at continuation boundaries and production shared PDF layout remain open; this is not the full table or architecture gate.

## Continuation — named destinations and links

The formatting/context menu now offers named point bookmarks, with add, rename, remove and navigation in a compact dialog. Outline can list/search bookmarks across chapters. Insert link offers bookmarks as well as web addresses; Ctrl/Command-click navigates to the destination. Identity-based links survive target renaming/movement, copied chapters and templates get independent targets, and imported named links bind to identities. Bookmarks add no spoken/countable text. Spelling word lookup and replacements respect their zero-width boundaries, and sentence movement retains a leading bookmark.

Windows desktop checks pass insertion, immediate typing/focus, rename, jump, remove, separate undo, autosave/reopening, filtered chapter navigation and internal links after renaming. HTML, EPUB and DOCX retain named points and links, including duplicate names across chapters and cross-file EPUB destinations. PDF includes internal link annotations. Missing/excluded destinations keep their visible text and report loss of the link. Native Word 16.0 opens, renders and resaves the marker and internal hyperlink. The full backend suite passes 442 tests; 222 frontend tests pass at this checkpoint. These are point destinations and hyperlinks; range bookmarks, live cross-reference fields, generated indexes/TOCs and cross-platform qualification remain open.

## Continuation — paragraph decoration

Paragraph settings and named styles now provide solid shading, a uniform straight border and interior padding, including explicit removal and inherited values. Borders paint without participating in layout, avoiding device-pixel rounding that previously changed page boundaries at different UI scales. Split paragraphs retain their continuous vertical border, with paint clipped at page bodies; page margins and gaps stay clear. The paint-only clip lives outside the authored DOM and is copied into Arrangement/publication snapshots. Ordinary paragraphs without decoration avoid extra geometry measurement.

Windows desktop checks cover a three-page paragraph at UI scales 50/100/150% and Write zoom through 300%, full/incremental agreement, clipboard, Apply/focus/undo, later-page typing and removal of stale clipping. All 100 markers remain selectable and occur exactly once in the browser publication PDF; its continuation page and the editor were visually inspected. The native Word 16.0 round trip retains shading, border width/colour, spacing and explicit removal. HTML/EPUB and DOCX import/export checks pass. Patterned/different-edge Word borders report conversion to the supported uniform form; unsupported fractional DOCX border measurements report rounding. Production PDF still uses ReportLab's own paragraph decoration/layout; matching all page boundaries remains an open architecture gate.

The full plan is still open. Table sorting is already implemented; general multi-cell row splitting requires page fragments capable of representing disjoint text ranges, rather than the current single continuous range per page. That limitation must be resolved with the shared page-map work, not hidden behind an export-only checkbox.

## Continuation — image semantics and editing overhead

Image properties adds Decorative image. The saved alternative text and title are retained when toggled; decorative images use empty accessible descriptions/presentation semantics in HTML and EPUB, and the Office decorative drawing extension in DOCX. Backend import/export checks and a native Word 16.0 open/render/resave retain all three values. The live image-properties workflow passes. This does not qualify PDF tagging, PDF/UA or screen-reader editing. The underlying extension is specified in [MS-ODRAWXML §5.32](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/6146d89f-9146-415b-99e2-39e694b5a980).

Editor JSON serialization now caches immutable ProseMirror branches; structural sharing never mutates its inputs. Editor callbacks now clone the small project records and guard/reuse unchanged document trees instead of cloning all chapters. A Windows Node fixture with 1,000/10,000/25,000 paragraphs measured approximately 0.26/2.54/8.93 ms median for local mutation plus history work; a second run alongside desktop checks measured 0.32/3.02/12.46 ms. The earlier cached-serialization/full-clone path measured 1.7/16.2/40.6 ms. This excludes browser layout, React work, full JSON comparison, proofreading and real audio, so is not an input-latency or whole-document performance certification. The cached path passes normal editing and cross-document history desktop regressions. The full backend suite passes 420 tests at this checkpoint. The save-conflict handoff regression passes: unsaved content remains active and New remains open when saving fails. Normal editing, Raw editing and mixed-section workspace checks also pass. The full plan remains open.

## Continuation — continued lists and image resizing

List properties now offers explicit Start at or Continue previous list. Continuations follow the preceding matching marker within the same container; nested lists and table cells remain independent. Editing, splitting, moving or deleting earlier items updates later numbering in the same undo transaction. HTML retains the continuation relation; DOCX shares real numbering identifiers and imports the relation when the preceding matching list belongs to that sequence. The native Word 16.0 open/render/resave fixture retains both continuation and deliberate restarts. Windows desktop checks cover the controls, insert/renumber, undo/redo, autosave and reopening. A native-caret/Enter race discovered by that test is fixed. Frontend tests total 203 and backend tests total 416 passing at this checkpoint. Heading-linked multilevel numbering remains outstanding.

Tables now offer Fit columns to content alongside page fit and equal distribution. An inert copy measures fonts, padding, borders and merged-cell constraints on demand; fitted widths respect a 25 px minimum and the available page width, and persist through the existing column-width contract. Windows checks cover merged cells at UI scales 50/100/150%, one-step undo/redo and unchanged content. This is an explicit sizing command, not a continuously recalculated table layout mode.

Selected block images now offer a square resize handle with proportional preview, one undoable width commit on release, Escape/pointer cancellation and keyboard width adjustment (Shift for larger steps). Numeric dimensions remain in Image properties. Preview paint stays outside the editable DOM and does not repaginate on every pointer move. Windows pointer, keyboard, cancellation and undo checks pass left/centre/right alignment at UI scales 50/100/150% and Write zoom through 300%; inline/anchored images, wrapping, cropping and captions remain outstanding; decorative status is covered by the subsequent continuation.

## Continuation — chronological editing history

Write, Sandbox and structural changes now share a chronological undo/redo timeline per open document. Undo restores the originating editor, selection and chapter/draft, while document tabs retain independent histories. Autosave revisions are excluded from undo and external reloads reset stale local steps. Adjacent typing follows ProseMirror grouping; switching editors, structural actions and undo establish boundaries. Patches share unchanged document subtrees and coalesce disjoint text/metadata updates, with 200-group / 32 MiB estimated-patch limits per document and a 64 MiB aggregate policy. Saved Versions remains the durable recovery facility; session history is not unlimited or persisted across restarts.

The Windows desktop workflow passes chronological chapter edits and inclusion changes, autosave/document switching, and interleaved Write/Sandbox typing with focus restoration. The full backend suite passes 412 tests; frontend and broader desktop regression checks continue below. This closes the earlier split between “typing” and “project” undo, not the full plan or every external-import/failure-path qualification.

## Continuation — tabs, ruler and exact leading

Paragraph settings and named styles now retain custom left, centre, right and decimal tab stops, with dot, dash or line leaders. Literal tab characters stay in authored text. An optional persistent View ruler supports tab placement, dragging, keyboard adjustment/removal, and left/right/first-line indent handles. Tab geometry uses the document's unscaled dimensions and Word's margin-before-indent convention; centred paragraphs shift the completed tabbed line together. Layout-only rules live outside the editable DOM, and snapshot/publication copies preserve their paint. DOCX retains tab definitions and explicit clears against inherited styles; HTML retains definitions for reopening. Production ReportLab PDF still converts tabs to spaces and now reports that limitation; ordinary exported HTML reports its uniform-tab rendering limitation. These paths must be resolved by the shared publication work before this feature's full export gate is closed.

Exact leading now compensates inline font baselines without expanding line boxes. Windows desktop checks cover Cambria, Arial and Times New Roman with 36–72 pt nested styled text, sub/superscript, UI scales 50/100/150%, Write zoom through 300%, mouse placement, typing/undo, tabs/leaders, and Arrangement snapshot styling. A three-page explicit-line fixture agrees after a full reflow; the browser publication PDF contains all 100 authored markers exactly once. This does not qualify all international font fallback, IME, screen readers or other operating systems.

The tab desktop workflow also checks clipboard, ruler keyboard/drag actions, independent undo events and Paragraph Apply focus. Word 16.0 opens, renders and resaves all four tab alignments with leaders, including a centred-paragraph comparison. Eight tab model/export tests and the 39-test tab/publishing subset pass; 194 frontend tests pass. Further integration checks remain due after the next changes. The full plan remains open.

## Continuation — page numbering and reusable templates

Page Layout now offers decimal, lower/upper Roman and lower/upper alphabetic page labels. Section properties add continuation or an explicit restart, plus inherited or independent number formats. Write, Arrangement furniture, the browser publication prototype, PDF and DOCX apply the same logical numbering policy. A continuing odd/even section can insert an unnumbered blank sheet; an explicit restart advances the label to the requested parity without adding a sheet, matching Word. Alphabetic page labels follow Word's A–Z, AA, BB convention. DOCX import retains supported formats and restarts; unsupported chapter-prefixed/other formats still report conversion. HTML preserves section numbering metadata. Incremental reflow cannot reuse stale restart offsets after earlier page counts change.

The existing Templates library now saves either the document and formatting or formatting alone. New offers a template selector only when matching saved templates exist. Templates retain styles, page/section settings, document language/rules and collected used images, with independent project, chapter, style, asset and block identities on creation. Sandbox drafts, history and external file bindings are excluded. Image hashes are checked before publishing a new document, raw-source image links are relocated, and template removal is reversible. Library summaries are stored separately so browsing does not parse every full manuscript. Untitled template copies are not treated as untouched blank documents.

Verification: 192 frontend tests, 404 backend tests and the TypeScript/Vite/Electron/native-menu build pass on Windows. Desktop checks cover numbering controls, save/reopen, mixed page sizes, paragraph/page movement, incremental/full agreement after page counts change, and creating/reopening/removing/restoring templates. The 16-check everyday editing workflow also passes. Five isolated Word 16.0 fixtures open, render and resave Roman/alphabetic labels, odd/even restart adjustment and continuation, including Roman 4444. The template library and New dialog were visually inspected. A prop-driven document replacement could previously capture Arrangement snapshots before the new canvas width committed; this is corrected and regression-tested. These results do not qualify macOS/Linux or the full plan; production PDF still has a separate layout engine.

Remaining work still includes shared production pagination, continuous sections/columns/mirrored margins, rich running stories and fields, tabs/ruler, exact mixed-font leading, unified chronological history, wrapped objects, notes/references, review and specialist/accessibility/international qualification. Keep this file until those requirements and the release gates below are met.

## Continuation — sections and long-document layout

Implemented top-level next-page, odd-page and even-page sections with their own paper size, orientation, four margins and binding gutter. The existing formatting/context menu opens a compact Insert section break / Section properties dialog; insertion, editing and removal preserve the originating document and selection, reject stale edits and have separate undo events. A section inserted at the end leaves a writable paragraph with focus. Section nodes have stable identities and are excluded from narration/proofreading text.

Write now maintains explicit per-page frames for mixed dimensions. Arrangement snapshots, page focus, cursor navigation, running furniture and the browser publication prototype use those frames. Odd/even starts use the configured starting page number; automatic parity blanks contain no running header/footer. Comparison with Word exposed and fixed the even-start-number case. Section widths use a stylesheet outside the editable DOM, avoiding both repeated node-decoration rebuilding and mutation-observer reparsing. The stylesheet is removed with the editor and cleared when sections are removed.

Paragraphs/sentences move between differently sized pages. Whole-page movement is supported within a section, retaining its boundaries and geometry; context-menu and Alt+Up/Down actions complement dragging. Cross-section whole-page movement is still deliberately unavailable because it needs a defined policy for moving the first section's settings and parity pages. It must not silently flatten layouts.

DOCX exports genuine sections and imports their geometry and ordinary break types, including section boundaries after list paragraphs. The first page number survives import. The subsequent numbering continuation above adds supported formats/restarts; continuous/column breaks and unsupported running stories still produce conversion notices. PDF switches physical page templates and creates empty parity pages; HTML preserves section metadata and named page styles. EPUB/Markdown report fixed-layout conversion. No production shared typesetting claim is made.

Verification: 183 frontend tests and 380 backend tests pass. Windows desktop checks cover mixed dimensions at UI scales 50/100/150% and Write zooms 50/100/300%, later-page typing/undo, section controls, real save/reopen, sentence moves across sections, page dragging/keyboard movement within sections and repeated table headers. The ordinary table and page-geometry regressions and 16-check editing workflow pass. Word 16.0 opens, renders and resaves the expanded structured fixture; with page numbering starting at 8 its odd section starts on the fourth physical page, matching the corrected numbering policy. This qualifies a semantic subset, not full Word fidelity or macOS/Linux behaviour.

The 1,049-page mixed-section stress fixture completes and incremental/full page maps agree. After replacing repeated top-level DOM lookups with a single indexed pass, the latest Windows run measured approximately 263–323 ms for local edits and 4.6–5.8 seconds for full layout; renderer-only highlight updates peaked at 6.7 ms. Those local edits still miss the plan's target, and the fixture does not certify real concurrent audio. The existing simulated audio/highlight integration also passes. Paragraph backgrounds/borders have not been exposed: painting across split paragraphs and page margins needs qualification first.

The full plan remains incomplete. In particular, continuous sections/columns, rich running stories, cross-section whole-page moves, tabs/ruler, paragraph borders, exact mixed-font leading, unified history, wrapped objects/notes/references, review, shared production PDF pagination and specialist/accessibility/international qualification remain. Retain this plan until the stated implementation and release gates are satisfied.

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
