# Alder verification

This record distinguishes exercised behaviour from remaining limitations. It is not a declaration that every future direction in the original roadmap has shipped.

## Final Windows release checks

The self-contained Windows application has been built and exercised through its Electron bridge with external tool paths removed. The packaged backend files match the current Python sources. The complete application folder is approximately **10.8 GB**.

| Check | Result |
| --- | --- |
| Complete backend suite with release resources | **110 passed**; two dependency deprecation warnings |
| Lightweight source-CI resource configuration | **103 passed, 7 explicitly skipped** rendered-resource checks |
| TypeScript unit/regression suite | **20 passed**, including source preservation, UTF-16 mapping and style inheritance |
| TypeScript checking and production build | Passed |
| Browser authoring/narration workflows | **6 passed**, using real Chatterbox, local recognition and audio bytes |
| Browser PDF/reading workflows | **2 passed**, using actual multi-page PDF output |
| Packaged resource audit | Passed; bundled imports and WordNet/OMW lookups are isolated from user packages and external tool paths |
| Packaged desktop feature/lifecycle check | Passed: nonblank PDF canvas; all seven written export formats; 800×800 definition PNG; actual narration and recognition; persistent listening acceptance; last edit saved at close; owned backend stopped |
| Packaged EPUB/AZW3 isolation check | Passed with empty PATH; EPUBCheck zero findings; Calibre output reopened with text and navigation retained |
| npm audit | Zero reported vulnerabilities at verification time |

The desktop narration fixture recognised “An idea takes shape.” exactly and produced **1.52 seconds** of decoded audio. GPU and CPU baseline evidence is recorded separately in the speech documentation. These checks isolate application runtimes and tools on the development machine; they do not claim certification on every Windows device or a pristine virtual machine.

`node scripts/test-desktop-lifecycle.mjs --packaged --features` writes its report to a timestamped `work/packaged-lifecycle-*` folder. The publishing report is `work/packaged-publishing-isolation/report.json`. Future-attribute and unsupported-structure guards keep a clip read-only when the editor cannot round-trip its source safely.

Backend scale measurements on a **100,000-word, 1,000-clip, 20-track** fixture were 11.4 ms validation, 43.7 ms initial insertion, 5.4 ms reading and 51.5 ms updating. They are service measurements, not proof of the roadmap's frontend typing/animation targets.

## Publishing and definition cards

Publishing's unit/integration checks cover explicit section and placement ordering, inclusion, accepted variants, frozen snapshots, unresolved references, safe image collection, basic marks, aligned paragraphs, table reading order, Unicode, metadata, import/export round trips and real converter invocation. The current publishing suite has **31 tests**, including glossary output in all seven formats, inherited paragraph/character styles, direct formatting precedence, invalid inheritance graphs, colour mapping and source immutability. These passed in the prepared Windows development environment. The definition-card suite's 11 tests also passed. Builder correctness adds 10 tests using tiny archives and local file fixtures; these do not use network access or installed converter executables.

The actual **packaged** publishing backend was exercised with `PATH` empty using `release/win-unpacked/resources/python/python.exe -I -B`. `scripts/verify-publishing-tools.py` imported `release/win-unpacked/resources/backend/alder/publishing.py` and selected Java, EPUBCheck and Calibre from that same release. EPUBCheck reported **zero fatal messages, errors or warnings**. The generated AZW3 was reopened through Calibre; recovered section wording/order and navigation labels matched the source fixture. Evidence is `work/packaged-publishing-isolation/report.json`. The verifier now checks the interpreter/module origins; a packaged check cannot silently use source backend code. The final package was checked again after the glossary, style and PDF-preview additions. The earlier resource-tree report remains `work/publishing-isolation-check/report.json`. Neither report certifies identical pagination in every ebook reader.

The publication PDF fixture was rendered through Poppler and visually inspected. Its heading hierarchy, Unicode text, paragraph wrapping, table rows, margins, running header and page number were clean. The final Voyager definition-card PNG and its independently rasterised vector PDF were compared with the supplied reference: white square, headword and IPA baseline, horizontal rule, italic part of speech, two-line definition and ample whitespace were present without clipping. The latest checked development PNG is `work/definition-qa/Alder-Voyager-definition-c724d590.png`; the corresponding vector PDF ends in `71cc29b2.pdf`. These are QA fixtures, not application source assets.

**DOCX has not been visually certified.** Its structured XML, text order, metadata, hyperlink relationships, embedded images and import round trips pass. The prescribed `render_docx.py` was attempted, but this Windows dependency bundle has no LibreOffice executable. Native Word pagination remains unverified. Alder's independent PDF export does not depend on LibreOffice.

### UI and document integration findings

- The editor stores paragraph alignment in `attrs.align`; publishing accepts both `align` and the earlier `textAlign` spelling. Import emits `align`.
- The editor uses block images. HTML/DOCX inline images are converted into block images, splitting surrounding text in source order. List items retain the paragraph-first structure required by the editor schema.
- Images are addressed through controlled project asset IDs. HTML preview embeds normalised raster bytes; no remote image or font installation is needed for the card exporter. The exact card preview is a PNG generated with bundled Liberation Serif; its instant editing preview is explicitly approximate browser typography.
- Definition Studio's **Save definition** updates the shared project model and then follows the normal autosave queue. The definition export endpoint receives its own complete `entry` and `options` snapshot. It does not need a prior dictionary autosave acknowledgement to render the requested text. Project save failures still belong to the shared save-status/error reporting.
- A rendered definition preview is matched to a signature of the text and output settings. If the user edits while the render is in flight, an older result does not replace the new live layout. Export uses the captured request snapshot, preserving the input even on converter or save-dialog failure.
- Definition Studio retains its draft in session storage and in-memory state. Changing between existing definitions retains unsaved form content during that session. The Voyager button loads an explicit sample and never silently adds it to the project dictionary.
- The main **Page Preview** now renders the actual PDF export with bundled PDF.js 6.3.289. The caller flushes project changes before requesting the proof. Page navigation, zoom, source revision, warnings, error recovery and saving the exact displayed artifact are provided. Worker/font/decoder resources are local Vite assets. Font-family substitutions and format-specific losses remain visible.
- Its separate **Reflowable reading** mode provides width, font-size and contents controls without editing the project. Two real-browser Playwright tests passed in `frontend/tests/publication-preview.spec.ts`: a six-page proof produced visible nonblank canvas pixels and correct text; navigation/zoom worked; reader controls changed width/type size and scrolled to the selected section; a simulated 503 was retried successfully. Stored document/revision were unchanged. The screenshots `work/publication-preview-print.png` and `work/publication-preview-reading.png` were visually inspected. The packaged desktop feature check also rendered a nonblank PDF canvas under Electron’s production content policy.

### Scope boundaries

Export supports TXT, Markdown, HTML, DOCX, PDF, EPUB and AZW3. Import supports TXT, Markdown, HTML, DOCX and EPUB. Basic semantic publishing, ordered sections, metadata, links, images, tables, styles, page settings and contents navigation are implemented. Exact arbitrary Word/InDesign layout import, freeform publishing frames, full footnote/cross-reference reconstruction, EPUB source-code editing and identical print/ebook layout are not established capabilities. DOCX table row spans and PDF merged-table cells are flattened with warnings. Detailed fidelity rules are in `docs/publishing-support.md`.

### Saved-plan coverage and remaining initial-release details

The plan distinguishes Core/v1 requirements from later exploration. The following are **not interchangeable categories**:

| Saved-plan requirement | Current evidence/status |
| --- | --- |
| Explicit collation, selected takes, frozen revisions and semantic section order | Implemented and exercised across outputs. |
| In-app print preview matching exported pagination | Addressed by displaying the actual generated PDF, replacing the earlier HTML-only preview; browser verification passed. |
| Named paragraph/character styles and inheritance | Implemented in the publication normalizer and the separate editor/style-manager work; base/child/direct precedence and invalid graphs are tested. |
| Reflowable ebook width/type size/navigation | Implemented in reading preview and tested; reader rendering remains an approximation. |
| Metadata, cover and contents | Backend EPUB metadata/cover/navigation supported; Document Setup now exposes publisher, subject, rights, identifier and cover selection. |
| Glossary output from authored definitions | Implemented as an explicit output option in all seven formats, with no source mutation. Definition-card export is a separate additional feature. |
| Mapping EPUBCheck findings to source blocks/assets | Checker results are visible, but automated source-block navigation/mapping is still missing from the planned v1 diagnostics. |
| Attach selected definitions as passage notes; dedicated image captions | These smaller v1 authoring details are not established by the current glossary/card and image support. They should remain recorded as unimplemented initial-release details. |
| EPUB accessibility metadata | Language, semantic navigation and image alt text are present. A complete accessibility-metadata authoring workflow/certification is not established. |
| Native DOCX layout proof | Structured content/relationships pass. Native Word/LibreOffice pagination is unverified; the failed renderer attempt is recorded above. |

The plan **explicitly reserves for later** advanced footnotes/citations/indexes/cross-reference reconstruction, XHTML/CSS source editing, and freeform frames/master pages/complex anchored layouts. It does not promise arbitrary Word-document layout round trips. Those scope boundaries do not erase the remaining Core/v1 details listed above. The author's “Ascending & Descending” note remains explicitly deferred without an invented interpretation.

Native tools and fonts are required release resources. In a lightweight source-only CI checkout, rendered definition-card fixtures skip clearly when fonts have not been provisioned; Calibre conversion checks similarly skip when the converter is absent. `scripts/verify-resources.mjs` and the isolated publishing check remain mandatory release gates and must not be replaced by a source-only test pass.

## Core runtime and offline dictionary provisioning

`scripts/prepare-core-resources.py` now reproduces the core payload from a verified application environment, `requirements-core.lock.txt`, and a checksum-pinned official standalone CPython distribution. It can use the existing base interpreter or the official archive directly. It compares content hashes, skips unchanged files, strips stale bytecode/private editable-install metadata, rejects import paths outside the bundle, and records every copied runtime file's hash and size in `core-resource-manifest.json`.

The lock contains **48** application and transitive dependency versions, including python-docx **1.2.0**. The builder checks these exact versions and verifies that they satisfy `requirements.txt`. CPython is **3.11.16**, standalone build **20260901**, Windows x64. Its official stripped-archive SHA-256 is `06cbe479e039f5b9cb5640c286d790074d63f549f92a32d599a3748293bd4510`. The selected archive matches the uv-managed source installation; the unstripped archive is a different binary build and is correctly rejected as a source mismatch.

The corpus audit caught an actual mismatch in the initial payload: NLTK **3.10.3** uses **OMW 2.0**, while the earlier directory contained only OMW 1.4. The builder now includes checksum-pinned WordNet 3.0, OMW 2.0 and the retained OMW 1.4 compatibility archive, all from official NLTK data commit `550b6625bcef1f2abff2ff770a5a0d272c9c6b2a`. English WordNet and a Spanish OMW lemma lookup both succeed using only bundled corpus paths. Corpus source URLs, hashes and licence locations are recorded in the resource manifest.

The isolated core audit launches bundled Python with `-I`, user packages disabled, unrelated Python configuration removed and `PATH` empty. Every `sys.path` entry and all 18 inspected module origins resolve inside the bundled interpreter. SQLite and local corpus lookups succeed. Network connection methods are blocked during the audit. Reports are written to `work/bundle-resources/core-runtime-audit.json` and `core-resource-manifest.json`. The preparer's incremental verification run checked **6,226 runtime files** and copied **zero unchanged files**.

Reproduce the checks from the project root:

```powershell
& work/venv/Scripts/python.exe scripts/prepare-core-resources.py
& work/venv/Scripts/python.exe scripts/prepare-core-resources.py --offline
& work/venv/Scripts/python.exe scripts/prepare-core-resources.py --verify-only
$env:PYTHONPATH = 'backend'
& work/venv/Scripts/python.exe -m pytest backend/tests/test_core_resources.py backend/tests/test_publishing.py backend/tests/test_definition_cards.py
& work/bundle-resources/python/python.exe -s scripts/verify-publishing-tools.py
& release/win-unpacked/resources/python/python.exe -I -B scripts/verify-publishing-tools.py --resources release/win-unpacked/resources --output work/packaged-publishing-isolation
npx playwright test frontend/tests/publication-preview.spec.ts --workers=1
```

The first preparation may download pinned archives at build time. `--offline` reuses verified caches and existing exact corpus archives. The finished application does not run this builder, install packages or download these dependencies.

Source records: [Astral standalone Python releases](https://github.com/astral-sh/python-build-standalone/releases/tag/20260901), [official NLTK corpus index at the pinned commit](https://github.com/nltk/nltk_data/blob/550b6625bcef1f2abff2ff770a5a0d272c9c6b2a/index.xml), [NLTK data documentation](https://www.nltk.org/data.html).
