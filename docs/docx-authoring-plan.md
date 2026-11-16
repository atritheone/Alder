# DOCX writing tools and workspace plan

Date: 16 November 2026. Baseline: main at `d91ad04`, Alder 0.14.

Status: implementation in progress. The audit traced current controls, schema, layout code and existing implementation records. No full work package is marked complete until its remaining acceptance criteria are satisfied.

### Implementation record — 16 November 2026

- A1, partial: native/web enabled, checked and mixed states, stable authoring-command IDs, local command search with aliases, Enter/arrow navigation and Ctrl/Cmd+Shift+P, selection restoration, Styles and page-property menu routes, and contextual toolbar-overflow reduction are implemented. Availability is cached per editor state. Complete registry/availability/targeting qualification remains outstanding.
- A2, partial: independent Write/Sandbox visibility, horizontal ruler default-on for new Write preferences, mm/cm/in/pt/pc preference, adaptive ticks, left/centre/right/decimal/bar tools, first-line and hanging tools, combined and separate indent handles, default-tab ticks, drag guides/readouts, Alt fine adjustment, drag-off removal, Escape cancellation and double-click paragraph properties are implemented. Tabs, paragraph/style indents, page/section fields, column gaps, running distances, table dimensions and image/shape/text-box dimensions accept measurement units. Mixed hanging edits retain each paragraph's first-line position; mixed tab edits preserve unrelated stops. Default document tab spacing is authored through Paragraph settings and preserved in DOCX/RTF/HTML/EPUB. Wide indents through ±1,440pt now retain their values in editing and DOCX/HTML/RTF/ODT exchange; repeated keyboard edits and undo passed hidden checks. Multi-page/RTL interaction qualification remains.
- B1, partial: active-page vertical ruler, physical margin controls, section-aware Page setup with measurement units/presets/orientation/size/columns, whole-document scope, separate binding gutter, preceding-chapter section targeting, rich header/footer distance handles, equal-column gap handles and selected-table grid/row handles are implemented. Table grid changes preserve merged-cell widths and offer fractional precision; row dragging changes minimum height. Inside/outside margin identity remains correct even when facing margins currently have equal widths. Selection scope, legacy running-distance handling, split-row/table-continuation geometry, unequal columns and complete Word ruler parity remain outstanding.
- B2, partial: persistent Fit width/Whole page modes adapt to the writing viewport and retain percentage controls through 300%. Hidden resize checks passed. Editable Two pages and page-space collapsing remain outstanding.
- D2, partial: table-ruler grid boundaries and selected-row minimum-height controls have keyboard/numeric alternatives, drag guides, cancellation and undo. Table padding, minimum heights and widths use the chosen measurement units. Fractional widths/heights passed DOCX/HTML exchange checks. Table selection handles, exact heights, distribution, per-edge borders and styles remain outstanding.
- Hidden Electron regression passed for native command search, selection restoration, decimal insertion, drag-off deletion, margin/header/column/table keyboard changes, table drag cancellation, numeric page setup, fit views and undo. The harness asserts windows remain hidden and answers only the isolated test instance's close-without-saving prompt via Electron's main-process API.
- Focused ruler/geometry/section unit tests passed. Bar-tab backend checks passed for DOCX/RTF preservation, PDF drawing and model validation; default-tab spacing backend checks passed. On-page bar rendering and hanging-indent/Escape checks passed in the hidden layout harness. Background Word automation passed the focused `scripts/ruler-fixture.py` exchange: bar/decimal/leader/cleared tabs, default tab spacing, hanging indents, margins/gutter, running distances and fractional table dimensions survived Word's save. Other OS interaction and wider native Word qualification remain outstanding.

The user explicitly requires the full functionality of Word's rulers. This includes the remaining table row/column, section-column and running-story interactions, not merely adding visible scales. Keep those requirements open until their authoring, undo, persistence and geometry paths are tested. All further work must stay off the user's desktop: use backend/unit tests or hidden renderer instances, never show/activate test windows.

The hidden-development workflow is documented in [hidden-development.md](hidden-development.md). Hidden mode now blocks activation and native-dialog escape paths at runtime. Mixed-selection ruler tab edits preserve unrelated tabs and inherited values; paragraph/style indent inputs follow measurement units. Focused command, tab and section tests pass; additional interactive coverage is in progress.

This plan extends [the word-processing plan](word-processing-plan.md). Its focus is the experience of composing, formatting and navigating a DOCX document. Existing compatibility, recovery, accessibility and performance requirements in that plan remain applicable. Overlapping tasks below should be tracked once, with links from both plans.

## Current findings

Alder already has a horizontal paragraph ruler under **View → Show ruler**. `ParagraphRuler.tsx` defaults it to hidden when no preference exists. It supports left/right/first-line indents, adding left tabs, dragging tabs, keyboard adjustment and Delete to remove a tab. It follows the selected paragraph and accounts for columns, mirrored margins and RTL. Its scale and numeric labels use points. There is no vertical page ruler, measurement-unit preference, margin drag surface or tab-type selector on the ruler. Centre/right/decimal tabs and leaders already exist in the Paragraph dialog.

Word exposes horizontal tab/indent manipulation, a tab-type selector and drag-off removal. It also provides a vertical ruler and configurable measurement units. These are the immediate comparison points for extending Alder. [Microsoft ruler controls](https://support.microsoft.com/en-us/word/using-the-ruler-in-word), [vertical ruler](https://support.microsoft.com/en-us/word/training/show-the-ruler), [measurement units](https://support.microsoft.com/en-us/word/change-units-used-for-margin-measurement-in-word).

| Capability | Current evidence in Alder | Work required |
| --- | --- | --- |
| Horizontal ruler | `frontend/src/ParagraphRuler.tsx`; `App.tsx`; `Editor.tsx` | Improve visibility, units, ticks, tab controls, drag feedback and mixed-selection behaviour. |
| Vertical ruler and page-margin handles | No corresponding control in the inspected page/ruler components | Add page-based geometry and editable margin handles. |
| Tabs | `TabStopsEditor.tsx`, `tabStops.ts`, `tabLayout.ts` | Existing four alignments and leaders; add configurable default interval, bar-tab semantics and ruler access. |
| Page setup | `SettingsWindow.tsx`, `SectionDialog.tsx`, `ColumnFields.tsx` | Existing sizes, orientation, margins, gutter, sections, equal columns; add quick access, explicit scope, unequal widths and visual adjustment. |
| Nonprinting marks and boundaries | `structureMarks.ts`, `PageStructureGuides.tsx`, `structurePreference.ts` | Existing paragraph/whitespace markers and body/column/header/footer guides; improve individual visibility controls and editing affordances. |
| Zoom and page views | `BookWorkspace.tsx`, `PublicationPreview.tsx`, `PageArrangement.tsx` | Write has percentage zoom; PDF preview has Fit width; Arrangement has page focus. Add fit modes to editable Write. |
| Multiple views | `PlainTextEditor.tsx` has split view; rich Write lacks an equivalent | Add DOCX split editing and independent side-by-side document views. |
| Navigation | `OutlinePanel.tsx`, `FindPanel.tsx`, `BookWorkspace.tsx` | Headings, bookmarks, comments, find results and page entry exist. Add one navigation surface, page thumbnails, section destinations and return history. |
| Styles | `StylesManager.tsx`, `styleResolution.ts`, `editorCommands.ts` | Paragraph/character styles, inheritance, next style, mixed state and copy formatting exist. Add an inspector explaining effective formatting and direct overrides. |
| Find/replace | `FindPanel.tsx`, `findText.ts`, `patternSearch.ts`, `bookFind.ts` | Text/regex/selection/book search exists. Add formatting predicates and structural-character search for rich documents. |
| Headers, footers and notes | `RunningMatterDialog.tsx`, `NotesDialog.tsx`, `pageFurniture.tsx` | Existing rich editing through dialogs. Add entry from the actual page region and then in-page story editing. |
| Tables | `TableDialog.tsx`, `tableFormatting.ts`, `tableAutoFit.ts`, `Editor.tsx` | Column dragging, auto-fit, widths, merge/split, row operations and repeated headers exist. Add row dragging, selection handles, per-edge borders, gridlines and table styles. |
| Objects | `ImageDialog.tsx`, `imageAnchors.ts`, `imageWrapping.ts`, `TextBoxDialog.tsx`, `ShapeDialog.tsx` | Inline/block and bounded left/right wrapping exist. Add selection pane, general positioning, anchoring and ordering. |
| Review | `CommentsDialog.tsx`, `ReviewDialog.tsx`, `trackedReview.ts` | Comments, revision decisions and original/final previews exist. Add docked review and clearer in-document navigation/display controls. |
| Reuse | `DocumentTemplates.tsx`, Sandbox drafts and clipboard helpers | Whole-document templates exist. Add reusable rich passages with collected assets. |
| Typography | `types.ts` StyleProperties and editor formatting model | Common text formatting exists. No authored small-caps, character spacing, baseline shift or kerning controls were found. Add model-to-export support. |
| Command discovery | `App.tsx`, `MenuItems.tsx`, `NativeMenu.tsx`, `TextCommandPalette.tsx` | Insert/Layout/Review menus exist. TXT has command search. Rich commands still dispatch by label; top menu types lack enabled state. Extend shared discovery and availability. |

These findings identify inspected gaps. DOCX features already implemented include captions, bookmarks, cross-references, generated contents/indexes, equations, forms, citations, mail merge, templates, section numbering and much of tracked review. Each should receive discoverability and workflow checks within this plan rather than a second implementation.

## Interface and behaviour contract

- Use Alder's native top menus and existing grey panels, dark-blue accent, square controls, typography and UI scaling. Keep the Write toolbar compact. Put secondary actions in menus, the existing side-panel area or contextual properties.
- Retain the existing top-level menu organisation. Use **View** for rulers and workspace views, **Layout** for page geometry, **Insert** for authored content, **Edit → Format** for typography/styles, and **Review** for editorial actions.
- Right-click actions follow the clicked paragraph, table cell, image, reference or page region. Preserve a selection when the click is inside it. Keep unrelated document-wide actions in the top menus.
- Settings store personal preferences such as ruler visibility, units and default view. Authored margins, tabs, widths and formatting belong to the document or its styles/sections.
- View changes preserve selection, scroll anchors and undo. Formatting changes use the shared transaction/history path. Each completed drag is one undoable operation; Escape or pointer cancellation restores its initial state.
- Every drag operation also has keyboard and numeric controls. Use predictable labels, visible focus and appropriately sized hit areas at all supported UI scales.
- Active editor targeting includes document, chapter, body/header/note story and selection. A menu opened in Sandbox or a second view must act on that exact editor. Disabled commands communicate their availability before activation.
- TTS, proofreading and Arrangement continue to use the canonical text and page maps. Guides, ruler labels and preview decorations never enter authored text or speech offsets.
- Display-unit changes must not rewrite stored document dimensions. Existing pt/mm/CSS conversion boundaries remain explicit and tested.

## Delivery sequence

| Batch | Deliverables | Dependencies | Relative effort |
| --- | --- | --- | --- |
| A | Command routing/discovery, horizontal ruler improvements and units | Existing commands and preferences | Medium |
| B | Vertical ruler, margin manipulation, quick page setup, fit views | A and physical page-map access | Medium–large |
| C | Formatting inspector, rich search, navigation and structure controls | A; B for page-based navigation | Large |
| D | Direct story editing and table authoring improvements | A–C; story/session and border schema work | Large |
| E | DOCX split/parallel views, review workspace, reusable passages | Command/session work and navigation | Large |
| F | General object layout, advanced typography, unequal columns | B–E plus schema/export/layout extensions | Very large |

Effort is relative. Schedule estimates should be made after the initial ruler geometry and shared-view prototypes. Each batch includes relevant tests and native interaction evidence. Cross-platform access and complex Word layout compatibility can affect elapsed time.

### A1. Commands that users can find and invoke consistently

1. Extend `editorCommands.ts` and the existing TXT command-search components with stable rich-command IDs, human labels, search aliases, availability, checked/mixed state and shortcuts. Reuse the existing execution functions for tables, images, notes and review.
2. Replace label-based `runMenuCommand` dispatch with IDs while preserving existing entry points until their callers migrate.
3. Carry enabled/checked state through `MenuItems.tsx`, `NativeMenu.tsx`, the Electron menu bridge and the native Windows module. Recompute for relevant selection/context changes without rebuilding menus on every audio highlight.
4. Add **Edit → Find command…**, covering terms such as ruler, margin, footnote, bibliography, line spacing and table border. Reuse shortcut conflict detection and platform conventions from TXT command search.
5. Expose **Edit → Format → Styles…** as a direct route to the existing styles surface. Add **Layout → Margins**, **Orientation**, **Size**, **Columns** and **Tabs…** routes to the corresponding existing properties.
6. Reduce the More formatting list to common secondary text actions and relevant properties after all document-wide actions have a named menu route. Preserve overflow access to common toolbar actions at narrow widths.

Acceptance requires invoking every registered authoring command by a visible entry point, retaining the original selection through native menus/dialogs, and proving correct targeting after switching documents and Sandbox. Commands that require a table or a formatted document must reflect that requirement in both native and web menus. Word also offers command search; Alder's search should remain local to its available commands. [Microsoft command search](https://support.microsoft.com/en-us/office/foundations-experiences/find-what-you-need-with-search-in-microsoft-365-apps?ad=us&rs=en-us&ui=en-us).

### A2. Complete the horizontal ruler and tab workflow

1. Extend `ParagraphRuler.tsx`. Keep **View → Rulers** immediately discoverable with Horizontal and Vertical choices. Proposed default for a fresh DOCX writing workspace is horizontal on and vertical off. Preserve an existing explicit `alder.ruler` choice through preference migration. Keep Sandbox ruler visibility independent.
2. Add **Settings → Writing → Measurement units** with mm, cm, inches and points. Default physical layout displays to mm. Font sizes remain labelled in points. Show consistent units in the ruler and applicable page, paragraph, table and object dimensions. Allow explicit suffixes in numeric inputs where feasible.
3. Use major/minor ticks with adaptive spacing so labels remain readable at 50–300% Write zoom and 50–150% UI scale. Clearly distinguish page margins from the selected paragraph's writable area.
4. Add a compact square tab selector for left/centre/right/decimal tabs. Double-click a stop to edit alignment, leader and position through existing tab properties. Dragging a stop off the ruler removes it, with visible feedback and one undo step.
5. Add separate first-line, hanging and combined paragraph-indent affordances with precise readouts. A combined drag moves both line starts together. Mixed paragraph selections show mixed state and apply only the edited property.
6. Add a temporary vertical guide during dragging and an exact measurement readout. Support fine adjustment, keyboard movement, Escape, lost pointer capture and changing document focus during a drag.
7. Extend default-tab handling beyond the hard-coded 36pt interval. Add Word-compatible bar tabs as a distinct painted/tab property, with import/export and no injected text character. Keep existing four tab alignments and leaders intact.

Acceptance includes a hanging-indent bibliography, decimal-aligned amounts, leader tabs, mixed paragraph styles, RTL paragraphs, nested table cells and a paragraph continuing into another column/page. Compare stored values after repeated unit switches. Undo must restore exact values and inheritance. Save/reopen and Word round trips must preserve tab semantics. Extend the existing tab-stop and paragraph tests only where changed behaviour requires coverage.

### B1. Vertical ruler, margins and section-aware page setup

1. Add a vertical ruler beside the active physical page, driven by the authoritative page map. Match the active caret page; mouse interaction on another page selects its layout context. During playback, follow the current speech page while preserving the saved editing selection.
2. Add top/bottom margin handles on the vertical ruler and left/right margin boundaries on the horizontal ruler. Expose inside/outside meaning for mirrored pages, binding gutter, column bounds and header/footer distances distinctly.
3. Use a lightweight drag preview and commit on release. If live reflow is used for short documents, throttle it and retain one history event. Prevent invalid geometry using existing page validation and show the effective dimension.
4. Keep margin manipulation separate from paragraph indentation by hit areas and labels. Selecting a table cell changes paragraph tab/indent context without turning its edges into page margins.
5. Add a compact page-setup surface reachable from **Layout** and by double-clicking a ruler margin. Make the target explicit as This section or Whole document. Add Selection only when section insertion/restoration is implemented as one transaction.
6. Provide named margin presets plus Custom, orientation, size, columns and section properties. Reuse `pageGeometry.ts`, `SectionDialog.tsx` and existing validators. Document changes use history and save into DOCX; measurement preferences use app settings.

Acceptance includes portrait/landscape transitions, odd/even section starts, first-page headers, mirrored margins, continuous sections and multiple displayed page sizes. Confirm caret position, pointer hit-testing, printed boundaries and original values after undo. Word exposes margin presets and custom margin settings. [Microsoft margins](https://support.microsoft.com/en-us/word/training/change-margins).

### B2. Editable view and zoom controls

1. Extend the existing Write zoom control with Fit width, Whole page and Two pages, retaining percentage input and the 300% maximum. Reuse preview fit calculations where appropriate, accounting for open panels and ruler space.
2. Store a fit mode separately from its computed zoom. Window/panel resizing recalculates it without changing document geometry. Keep the current caret or explicit scroll anchor visible.
3. Add **View → Page space** to collapse/restore displayed inter-page white space for long-form editing. Keep headers/footers discoverable and expand their region when edited. Physical page sizes and export geometry remain authoritative.
4. A Two pages writing view must share document selection and layout semantics; qualify native selection across pages before presenting it as editable. Retain Arrangement's existing zoom/focus gestures as their own workspace behaviour.

Acceptance includes side panels opening/closing, window resize, UI scaling, PDF page comparison and TTS follow with four-line look-ahead. Display controls must not alter word counts, pagination or saved formatting. Word supplies page presentation and whitespace visibility options. [Word page views](https://support.microsoft.com/en-gb/word/view-a-page-at-a-time-side-by-side-in-word), [display options](https://support.microsoft.com/en-us/word/word-options-display).

### C1. Formatting inspector and style workflow

1. Add **Edit → Format → Inspect formatting** in the existing side-panel area. Show effective font, size, marks, language, paragraph metrics, tab stops, list identity and applicable section settings.
2. Attribute each value to document defaults, base style, paragraph/character style or direct formatting. Show mixed values explicitly. Reuse `selectionFormatting` and `styleResolution` rather than creating a second style engine.
3. Provide focused actions for clearing an override, editing its named style, updating the style from the selection, selecting uses of a style, and applying copied formatting repeatedly until Escape.
4. Integrate an in-use style filter and preview into the current style manager. Provide a local style/template import workflow with explicit conflict resolution, supported inheritance and asset handling.

Acceptance uses a document with inherited paragraph and character styles plus direct overrides. The inspector must explain the visible appearance, and clearing one override must retain unrelated marks, links and revisions. Applying a style to multiple matching passages must remain undoable and preserve structural boundaries.

### C2. Rich Find/Replace and navigation

1. Extend Find Advanced with formatting filters for style, font, size, emphasis, colour, highlight and paragraph properties. Support formatting-only searches and replacement formatting with an unchanged-text option.
2. Add a Special menu for tabs, hard line breaks, paragraph boundaries, nonbreaking spaces, optional hyphens and page/column/section breaks. Map these to actual rich structures, resolving text projection ambiguities explicitly.
3. Keep replacement previews and scope controls. Block destructive replacement of protected content or invalid structural joins with a specific explanation. Preserve comments, references and revisions through mapping; group Replace all into one operation.
4. Extend the existing outline panel into **View → Navigation** with Headings, Pages, Bookmarks, Comments and Search results. Add sections/notes/objects as destinations in Go to rather than more persistent panels.
5. Reuse cached Arrangement/page snapshots for thumbnails with bounded rendering. Retain heading drag/reorder, add promote/demote and expand-to-level controls, and clearly distinguish navigation collapse from hiding document text.
6. Add Back/Forward location history and Go to page/section/heading/bookmark/note. Include physical page index and printed label where numbering restarts make them differ.

Acceptance includes selection-only formatting replacement, mixed formatting within one word, nested tables, notes, tracked deletions, cross-chapter search, duplicate printed page labels and navigation after edits. Test cancellation/stale results on a large document. Word provides formatting/special-character search and a headings/pages/results navigation pane. [Microsoft Find/Replace](https://support.microsoft.com/en-gb/word/training/find-and-replace-text-in-word?nochrome=true), [navigation pane](https://support.microsoft.com/en-us/word/use-the-navigation-pane-in-word).

### C3. Structure visibility and quick document information

1. Extend Show structure with independently persistent formatting marks, page/text boundaries, object anchors and table gridlines. Reuse current marks/guides, including their viewport caching.
2. Label explicit page/column/section breaks and show their type. Context properties on a section break open the exact section; deleting it follows defined section inheritance and offers undo.
3. Add optional field shading and bookmark range indication, with selected-field properties and refresh actions. Shading and boundary indicators are nonprinting.
4. Make the existing Write counts open compact document statistics containing characters with/without spaces, paragraphs, words, sentences and pages, with selection/document scope and the existing speech/review inclusion rules.

Acceptance proves that toggling guides leaves authored text, clipboard output, page breaks and speech offsets unchanged. All marks remain aligned under zoom, RTL, table continuations and TTS following.

### D1. Editing headers, footers and notes from the page

1. First add double-click and context-menu entry on the actual header/footer/note region, opening the existing editor with its section, story and first/odd/even variant already selected.
2. Then mount a focused story editor in the page region. Reuse `RunningMatterDialog.tsx`, `NotesDialog.tsx` and shared story commands for properties. Show compact Previous/Next, Link to previous and Close controls only during story editing.
3. Handle empty regions, inherited stories, overflowing content, continuation notes and selection restoration explicitly. Applying edits must update all affected pages and retain one coherent history across story and body edits.
4. Allow typing/correction/formatting in the visible note body with stable references and numbering. Scrolling to a reference and returning to its note must restore the editing range.

Acceptance includes first/even stories, a section inheriting the previous story, an image in a header, a multi-page note and TTS transitions between note/body. Compare Word resave and Alder PDF output. Word provides direct double-click header/footer editing. [Microsoft header/footer editing](https://support.microsoft.com/en-gb/word/edit-your-existing-headers-and-footers-in-word).

### D2. Table authoring controls

1. Add unobtrusive hover handles for selecting a whole table, row or column, with keyboard equivalents and clear multi-cell selection. Preserve existing column-resize dragging.
2. Add row-height dragging and Distribute rows. Start with minimum-height semantics, then implement exact-height authoring/import fidelity with visible overflow handling and native Word evidence.
3. Extend cell border properties to individual edges, inside/outside presets, line style, colour and width. Add nonprinting gridlines for borderless tables. Preserve merged-edge semantics and avoid drawing duplicate shared borders.
4. Add reusable table styles with header/total-row, first/last-column and alternating-band options. Represent style inheritance separately from direct cell overrides and map the supported subset to native Word table styles.
5. Consolidate table right-click commands into short Select, Insert, Delete, Size, Borders and Properties groups, retaining Alder menu styling and keyboard navigation. Sorting, repeat headings, conversion and merge/split remain reachable.

Acceptance covers borderless tables, repeated headings, vertical/horizontal merges, nested tables, continuation fragments, RTL and tracked changes. Check both visible result and exported Word semantics. Existing `tableAutoFit`, `tableFormatting` and review tests provide the baseline. Word offers direct row/table resizing and row/column selection aids. [Microsoft table sizing](https://support.microsoft.com/en-us/word/resize-a-table-column-or-row).

### E1. Multiple editing views for DOCX

1. Add **View → Split document**, using the TXT split-view experience as a design reference and `editorSessions.ts` for rich-state ownership. Support a horizontal/vertical divider with persisted position.
2. Share one canonical document, mapped selections and ordered history across two views. Maintain independent scroll positions and active caret ownership. Route toolbar, menus and TTS to an explicitly active view.
3. Add **View → Side by side…** for two already-open documents, with optional linked scrolling and a simple Close comparison view action. Keep document comparison/revision generation as its existing separate command.
4. Bound inactive layout caches and close resources promptly. Never clone the authored document into two independently saving sessions.

Acceptance types alternately in both views, undoes in order, edits above the second view's selection, changes sections, switches documents, saves/reopens and performs TTS. Test linked scrolling between unequal documents without feedback loops. Desktop Word's split and side-by-side workflows are documented among its desktop-only capabilities. [Microsoft desktop/browser differences](https://support.microsoft.com/en-us/word/differences-between-using-a-document-in-the-browser-and-in-word).

### E2. Review while writing

1. Reuse Comments and Review dialogs in a docked panel that permits editing alongside it. Add Previous/Next comment/change, accept/reject-and-next and author filters through Review.
2. Add All markup, Simple markup and Final presentation using the existing review projections. Keep comment markers aligned to their stable anchors and give a selected comment a clear passage highlight.
3. Carry forward editable Original review from the main plan as a separate high-risk task. Specify how edits map through hidden revisions before enabling it. Retain the existing read-only Original preview until that mapping is verified.
4. Give unsupported Word exchange cases a focused route to the affected revision and its available decisions. Keep unresolved review metadata intact through save/copy operations.

Acceptance includes moved passages, deleted comment anchors, overlapping revisions, multiple authors and tracked tables. Narration and proofreading must follow the chosen visible text representation. This task shares the existing plan's review work and does not complete its native DOCX restrictions by adding UI.

### E3. Reusable passages and templates

1. Add **Insert → Saved passages…** and a selection context action to save a named rich passage. Reuse template storage and clipboard remapping, including collected images and style dependencies.
2. Allow preview, insertion, rename, replacement and deletion in Alder's existing browser/panel styling. Support choosing a Sandbox draft as the source.
3. Insert copies with fresh block/bookmark/comment identities and explicit reference remapping. Preserve the origin document and independent subsequent edits. Resolve style-name conflicts visibly.
4. Add an explicit default DOCX template choice to New/settings, retaining existing user-created document templates and Cambria defaults unless the user chooses another template.

Acceptance reuses a formatted signature, a table, a note/reference passage and an illustrated section across documents, then undoes and reopens them. Word's Quick Parts stores reusable text and graphics. [Microsoft reusable content](https://support.microsoft.com/en-us/word/use-quick-parts-and-autotext-in-word-and-outlook).

### F1. Object selection, positioning and wrapping

1. Add **View → Objects** in the existing panel area to locate images, text boxes and shapes, select them and open properties. Use stable IDs and human-readable names/descriptions.
2. Extend anchored-object data with reference frame, horizontal/vertical position, move-with-text behaviour and anchor locking. Display an anchor only when relevant to the selected object or enabled through Structure.
3. Implement page/margin/paragraph-relative positions and numeric controls, then drag guides and snapping. Qualify square and top/bottom wrapping before behind/in-front-of-text behaviour. Treat tight/through contour wrapping as a later explicit geometry task.
4. Add bring forward/backward, alignment/distribution, multi-selection and grouping after layout and export support the relevant anchor types. Inline object operations must preserve inline text order.
5. Preserve reading order, alt text, captions, copy/move identity and review decisions. Export native anchors and report unsupported imported positioning before conversion.

Acceptance includes a picture moving with a paragraph, an overlapping pair of shapes, a captioned image crossing a page, a rotated/resized object and an object near a column/section boundary. Compare layout, caret hit-testing, accessibility reading order and Word output. Word offers object selection/order and alignment controls. [Microsoft selection pane](https://support.microsoft.com/en-us/powerpoint/use-the-selection-pane-to-manage-objects-in-documents), [object alignment](https://support.microsoft.com/en-us/office/graphics-visuals/align-or-arrange-objects).

### F2. Advanced typography and page composition

1. Add **Edit → Format → Font…** with a small preview and expandable advanced options. Implement small caps, character spacing, baseline shift, underline variants/colour, kerning and supported OpenType features through schema, styles, clipboard, review, layout and DOCX together.
2. Support true font features where available and identify fallback rendering. Keep original Unicode wording for visual case effects, searching, accessibility and TTS. Measure changed glyph geometry in caret/pagination paths.
3. Extend `columns.ts`/`ColumnFields.tsx` to explicit unequal column widths and gaps. Update flow, balancing, ruler context, note/table continuation and DOCX import/export. Validate width sums against the active section.
4. Add section vertical alignment and a bounded drop-cap implementation after shared layout can represent them. Test decorative initials with accessibility and speech wording preserved.
5. Add document style sets and theme font/colour references with explicit application scope, building on existing styles/templates. Preserve authored theme references where the supported format model allows them; changing a theme must not overwrite unrelated direct formatting.

Acceptance includes mixed-script small caps/spacing, fractional sizes, italic/bold fallback, superscripts beside equations, two unequal columns and an imported Word theme. Every property needs measured editing geometry and a native Word round trip. Word exposes character-spacing/kerning controls and unequal column widths. [Microsoft typography](https://support.microsoft.com/en-us/word/change-the-spaces-between-text-in-word), [column widths](https://support.microsoft.com/en-gb/word/adjust-column-widths-on-a-page).

## Dependencies and completion criteria

- Ruler and view work can ship incrementally on existing document properties. New bar tabs, table borders/styles, object anchors, typography and unequal columns require explicit schema validation and import/export updates before their controls ship.
- Reuse the current page map and style resolution. An independent measurement engine would risk ruler, caret, Arrangement and PDF disagreement.
- Ruler interactions should measure the active page/paragraph only. Repeated scroll and pointer events should coalesce to animation frames. Test against the original plan's typing/reflow targets with narration and proofreading active.
- Split views and in-page story editing depend on correct session/history ownership. Prototype these against a small document before scaling to long manuscripts and complex revisions.
- Preserve old documents and preferences. Specify defaults for every added property, retain omitted versus explicitly cleared values, and version/migrate only when the data change requires it.
- Verify the ordinary menu path, a relevant context action, keyboard/numeric operation, undo/redo, save/reopen and applicable Word/PDF export for each change. Add focused regressions for newly introduced failure modes. Run affected checks rather than the whole suite for every small UI change.
- Use Windows native menus, macOS application menus and supported Linux desktop menus in platform qualification. Cover UI scales 50/100/150%, Write zoom 50/100/300%, mixed monitor density, keyboard navigation and relevant screen-reader operations.
- Keep a capability record for each task with implemented, interactive-tested and Word-round-trip-tested status. A menu item or supported XML property alone is insufficient evidence of a usable writing workflow.

The first delivery should complete A1/A2 and B1's vertical ruler foundation, with a real user workflow that opens a DOCX, finds the rulers, changes measurement units, sets an indent and decimal tab, changes a section margin, undoes those actions and saves/reopens the result. Later batches should follow the dependencies above. The existing word-processing plan's remaining complex revision, performance and cross-platform work continues alongside these authoring improvements.
