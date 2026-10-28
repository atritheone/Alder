# Alder publishing and definition cards

The publication service builds every output from the same explicit collation. It resolves section order, placement order, inclusion, a placement's selected variant or its clip's accepted variant, and frozen document/text snapshots. A muted audition track remains in the written publication unless its placement is excluded. Draft clips with no included placements are reported and omitted. Repeated placements are reported and repeated. Missing references fail visibly instead of silently changing the manuscript.

## Supported document formats

| Format | Export | Import |
| --- | --- | --- |
| TXT | Accepted wording and reading order, optional title/author, section titles | UTF-8 and BOM support; Windows-1252 fallback with a warning |
| Markdown | Headings, emphasis, code, lists, quotes and safe links | CommonMark parsed with active HTML disabled |
| HTML | Self-contained semantic page preview with collected raster images and publication styles | Headings, paragraphs, emphasis, links, lists, tables and embedded images; active content removed |
| DOCX | Editable semantic document with metadata, styles, headings, inline marks, genuine numbered/bullet lists, links, table widths/row and column spans, images, contents links, page size/margins and running header/footer | Body order, headings, inline formatting/fonts, paragraph metrics, ordinary nested numbering, links, table widths/spans and collected images |
| PDF | Searchable text, embedded supported TrueType fonts, metadata, headings, contents links, lists, images, tables including widths/spans, page settings and pagination | Extracted text; original page layout is not reconstructed |
| EPUB 3 | Ordered XHTML spine, semantic section roles, navigation contents, metadata, embedded images, optional cover and publication CSS | Spine reading order and semantic content; embedded images collected |
| AZW3 | Real Calibre conversion of a validated EPUB | Not imported |

Named paragraph and character styles resolve base → derived style → direct formatting on an isolated publication snapshot. Missing bases and inheritance cycles fail explicitly. Null/empty properties inherit; zero spacing/indentation and false flow flags remain explicit. HTML/EPUB use resolved CSS, DOCX creates paragraph/character styles, and PDF uses its supported style mapping. The source project, variants and frozen snapshots remain unchanged. Font size (6–72 pt), paragraph alignment, multiple/exact/at-least leading, before/after spacing (0–144 pt), first-line/left/right indentation (−144–144 pt), keep-with-next, keep-together, widow/orphan and page-break-before properties are retained. DOCX import resolves Word's implicit defaults and explicit On/Off overrides. The browser's exact leading can still expand with large mixed inline fonts; this layout case is not qualified as exact. CSS named/hexadecimal colours are normalised; translucent text colours are flattened against white with a notice. Text marks include strong/emphasis, underline, strike, sub/superscript, highlight, safe links and supported inline styling.

**Page Preview** renders the actual backend PDF with locally bundled PDF.js, including its worker, font and decoder resources. Page navigation, zoom and the source revision remain attached to that generated artifact; **Save this PDF** saves the same proof. Its separate reflowable reading mode offers reader width, type size and section navigation, without changing project typography. Reading-mode overrides are a reader approximation; the PDF mode is the definitive page proof.

The `includeGlossary` publication option appends an alphabetically ordered glossary from the project's authored dictionary entries to every output format, including EPUB/AZW3 navigation. It includes the headword, optional IPA/part of speech and definition. Empty/incomplete entries are reported. The generated section exists only in the output snapshot; dictionary data and manuscript placements are not changed. The option defaults off and is independent of definition-card export.

TXT drops formatting and images, with a conversion warning when the document contains rich content; it preserves authored trailing spaces and empty paragraphs. Markdown uses alt text for images and tab-separated text for tables, and reports conversion of alphabetic/Roman/custom bullet markers to ordinary lists. Decimal, alphabetic and Roman numbering plus disc/circle/square bullets survive DOCX/HTML import and DOCX/PDF export. DOCX import does not reconstruct running matter, complex multilevel labels, comments, notes, tracked edits or exact page layout. Import warnings identify that loss. DOCX and PDF preserve ordinary table widths and merged cells; oversized PDF tables scale to the printable width with a notice. Complex merged-cell pagination still needs qualification. PDF reports paragraph/inline font-family substitution rather than pretending that every requested installed font is embedded. Unsupported nodes/marks are reported with retained descendant text where possible. These limits are also returned in each export's `warnings` array.

Native Save updates a bound text file or Alder bundle after checking for external changes. Save As chooses a new destination in the current format; Save a Copy leaves the binding unchanged. Imported DOCX/Markdown/conversion sources start with a suggested working-copy destination because full source-format fidelity is not supported. File-format conversion remains available through Export. The local autosave status describes the workspace copy; the explicit Save result identifies the external file written. Cancelling does not report success. Saved Versions recovers a separate document and leaves the current one open.

File → Print opens the saved-revision PDF proof. Print this PDF opens that exact PDF in the sandboxed desktop viewer, whose print control offers printer, page and copy selection once loaded. It does not print the editing canvas or auto-print a loading page. Closing the window removes its temporary preview file. Windows tests cover proof generation, window opening and cleanup without sending a physical print job; printer drivers and macOS/Linux dialogs still need qualification. PDF body margins now exclude ReportLab's implicit frame padding; unnamed sections no longer insert an empty heading above the first authored block.

Project schema 2 adds stable block identities. Schema 1 projects migrate on validated reads/updates; existing archive container version 1 remains supported. Older builds limited to project schema 1 cannot read newly saved schema 2 projects. Managed updates declare the supported forward migration and block incompatible automatic rollback. Keep original files/backups when exchanging with those builds.

## Validation and collected resources

EPUB generation writes the required first, uncompressed `mimetype` entry. Every build checks the container, package XML, manifest resources, XHTML parsing, spine and navigation. The bundled EPUBCheck then performs full conformance validation. An EPUBCheck error fails the export. The result distinguishes `passed`, `structural-only`, `failed` and checker availability, so a missing checker cannot appear to be full validation. AZW3 runs the bundled Calibre converter as a separate process and reports its actual exit status.

Images are accepted only as collected assets within the project's controlled asset root or as embedded raster bytes. They are decoded and normalised to PNG, stripping active data and EXIF. No export fetches a remote image. HTML preview has a restrictive content security policy. Imports do not execute scripts or fetch external resources. ZIP import validates entry paths, duplicates and the expanded size before processing, with a 100 MB limit. Individual images are limited to 20 MB and 40 megapixels.

The API passes the project's controlled image directory as `options.assetRoot`. Imported assets return `{id,name,mime,data}`; the app writes their bytes to the content-addressed asset store and persists controlled references. Export files receive unique names and are made available only through the controlled export endpoint after a successful build.

## Definition cards

`alder.definition_cards.build_definition_export` renders the author's Voyager design using editable `word`, `ipa`, `partOfSpeech` and `definition` values. Headword and pronunciation share a baseline; a long rule, italic part of speech and wrapped definition follow below on a white square. The supplied definition is preserved exactly: “A Priest of Lucidity and the Manifest Reality.”

PNG, JPEG and vector PDF use one measured layout. Default output is 800 × 800 pixels, with a 256–4096 pixel size range and 72–600 DPI metadata. At the default 96 DPI, the PDF page is 600 × 600 points. Optional separate width/height centre the same square design inside a rectangular canvas. Long headwords shrink together with their pronunciation; long definitions shrink only to a readable minimum, then fail with a clear message if they still cannot fit. No text is silently clipped. Unsupported font glyphs are identified before export. The bundled Liberation Serif font includes the IPA characters in the Voyager example.

## Bundled runtime layout

Packaged builds resolve their resources from `ALDER_RESOURCES_DIR`; development uses `work/bundle-resources` in the project. Required resources are shipped with Alder and do not require the user to install a converter, Java, Python or a font.

- `fonts/LiberationSerif-Regular.ttf`, `LiberationSerif-Bold.ttf`, `LiberationSerif-Italic.ttf`, `LiberationSerif-BoldItalic.ttf`, plus `LICENSE` and `AUTHORS`.
- `tools/epubcheck/epubcheck-5.3.0/epubcheck.jar` and the complete sibling `lib` directory.
- `tools/java/bin/java.exe` or `tools/jre/bin/java.exe`, with the complete portable Java runtime.
- `tools/calibre/ebook-convert.exe` or `tools/calibre/Calibre/ebook-convert.exe`, with the complete portable Calibre distribution.

Developer diagnostic overrides are `ALDER_EPUBCHECK_JAR`, `ALDER_JAVA` and `ALDER_EBOOK_CONVERT`. Discovery prefers packaged resources; installed tools are only a development fallback. Packaging must verify all required resources before producing a release.

Publishing Python dependencies are `python-docx>=1.2`, `reportlab>=4`, `pypdf>=5`, `Pillow>=10`, `beautifulsoup4>=4.12` and `markdown-it-py>=3`. Their dependencies are included in the bundled Python runtime.

## Image properties

Block-image properties include proportional width (shown in millimetres in the editor), left/centre/right alignment, alternative text and title. These properties survive ordinary DOCX and HTML round trips; PDF applies the image's alignment. Word stores dimensions as integer EMUs, so imported pixel widths can differ by less than one EMU. Oversized images fit the printable area. Crop, anchored wrapping, inline positioning, captions and tagged PDF image descriptions remain unsupported. Image collection does not replace the current editing snapshot; registration and insertion retain typing performed during upload.

## Table appearance and conversion

The Table properties dialog edits table alignment, selected-cell vertical alignment, four padding values, uniform cell borders/shading, minimum row height and column widths. It leaves untouched properties intact. Widths, padding, borders, shading, row minimums and alignment survive DOCX/HTML exchange; PDF applies them. DOCX vertical merges include matching continuation-cell formatting, verified with Word 16.0 rendering and resaving. Different border styles on individual edges are converted to uniform cell borders with a warning. Exact Word row heights become minimum heights so authored content remains visible. Ordinary tables now repeat leading headers in Write/Arrangement and the browser publication prototype. Headers stay with the first body row, and vertical merges move as complete groups when they fit. Oversized groups/rows retain the older line-splitting fallback; repeat-on-split and complex merged/nested pagination remain unqualified.

Table sorting retains leading header rows, uses natural text/numeric ordering, and is disabled for merged tables. Text/table conversion uses tabs and selected paragraphs, preserves inline marks and empty cells, and refuses object-containing tables. Formatting, sorting and conversion each undo in one editor step. Resetting column widths fits the table to its available page width; distributing columns retains the current table width.

## Page geometry

Custom paper dimensions, separate top/bottom/left/right margins and a left binding gutter are stored with the document. Write, Arrangement, HTML, DOCX and PDF share their dimensions and usable-body rules. The simple running header/footer settings also appear in Write/Arrangement, including the starting page number. These are not editable rich running stories or section-specific fields.

Display zoom no longer changes table pagination: pages are laid out at natural scale and transformed for viewing, with application zoom compensated. The Windows fixture preserves its seven-page map at UI scales 50/100/150% and Write zooms 50/100/300%. This does not establish identical typesetting across platforms or replace ReportLab with the browser publication prototype.

Opening a DOCX uses its first section's paper, margins, gutter and starting page number. Next-page, odd-page and even-page sections retain their own paper, orientation, four margins and binding gutter. Write's formatting/context menu provides Insert section break and Section properties, including removal of a break with undo. Blank parity pages have no running header/footer; their placement follows the configured starting page number. DOCX exports genuine sections, PDF switches physical page templates, and HTML retains section metadata and named page styles. EPUB/Markdown report their conversion of fixed section layout. Continuous/column sections, section numbering restarts and non-decimal numbering remain conversions with notices; mirrored/top binding also remains a conversion. Importing into an existing document retains the destination's first-page settings.

Arrangement shows each page's actual size. Sentences and paragraphs can cross sections; whole pages can move within their section using dragging, the context menu or Alt+Up/Down, retaining section geometry and separate undo. Moving entire pages between sections is not yet supported. Rich section-specific running stories, columns and mirrored margins remain open. Old uniform margins remain supported; impossible legacy pairs are reduced proportionally with a report, while new impossible combinations are rejected.

Section qualification includes a four-page portrait/landscape/A5 browser fixture, scale-independent boundaries, later-page caret placement, repeated table headers, snapshot geometry and actual workspace save/reopen/Arrangement operations. Native Word 16.0 renders and resaves the structured fixture with mixed page sizes and odd section starts, including an even starting page number. The browser publication bridge remains a prototype; the production ReportLab PDF uses the same physical dimensions but still independently typesets body content.

## Search and recovery

Find → Advanced provides local regular-expression search, captured-text replacements and a preview. Empty-position matches are not accepted for replacement. The search worker is terminated after 1.5 seconds rather than blocking editing, and results are invalidated when the source changes. Whole-book replacements use durable project undo; this remains separate from local editor undo.

Failure-injection tests cover failed external-file flushes, failed file-binding writes, concurrent bindings, a private SQLite database growth limit, and process exit during an uncommitted save. The last committed document/history and prior binding remain available. These checks do not certify every filesystem or power-loss scenario.

## Source and licence records

- EPUBCheck 5.3.0: [official W3C installation documentation](https://www.w3.org/publishing/epubcheck/docs/installation/) and [release](https://github.com/w3c/epubcheck/releases/tag/v5.3.0). The downloaded release ZIP SHA-256 is `6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5`. Preserve its licence and all dependency notices.
- Liberation Serif 2.1.5: [official release](https://github.com/liberationfonts/liberation-fonts/releases/tag/2.1.5), [SIL Open Font License](https://github.com/liberationfonts/liberation-fonts/blob/main/LICENSE). The downloaded TTF archive SHA-256 is `7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0`. Unmodified font files, licence and author list are collected in the bundle resources.
- EPUB structure follows the [W3C EPUB 3.3 specification](https://www.w3.org/TR/epub-33/). DOCX traversal follows [python-docx's document-order API](https://python-docx.readthedocs.io/en/develop/api/document.html).
- PDF.js 6.3.289: [Mozilla PDF.js examples](https://mozilla.github.io/pdf.js/examples/) and [official distribution](https://www.npmjs.com/package/pdfjs-dist). Apache-2.0; standard font notices accompany the bundled reader assets. The version is pinned in `package.json`/`package-lock.json`; no CDN resource is required at runtime.

The desktop bundle's third-party notices must also preserve the Calibre and portable Java distribution licences and relevant source obligations; their versions and archives are recorded by the packaging stage.

## Verification record

The publishing tests exercise accepted variants, frozen snapshots, inclusion, ordering, stale references, image containment, active-content removal, Unicode PDF text, metadata, rich DOCX round trips, inherited character/paragraph styles, invalid style graphs, opt-in glossary output in seven formats, EPUB container/spine validation, actual EPUBCheck invocation and actual Calibre AZW3 conversion. Definition tests exercise PNG/JPEG/PDF, Unicode pronunciation, custom dimensions, fitted text, missing fonts, invalid sizes and overlong definitions. Browser tests render a real six-page PDF, verify navigation/zoom and reading controls, preserve source revision and recover from a failed export.

Representative publication PDF and definition PNG/PDF pages were rasterised with Poppler and visually inspected for clipping, legibility, tables and reference geometry. DOCX structure, image relationships, links and reading order passed round-trip tests. The original fixture generated by `scripts/word-processing-fixture.py` additionally covers paragraph spacing/indents, real nested numbering and merged table widths. `scripts/test-word-docx.ps1 -RenderPdf -RoundTrip` with its explicit fixture directory confirms installed Word 16.0 opens, paginates, renders and resaves it. The fixture generator's `--verify-word` check reimports that result and verifies text, paragraph metrics, nested numbering, table spans/widths and Cambria in Word's rendered heading. Both PDFs were visually checked. Word's theme aliases are removed when an explicit font is authored, and list markers have an explicit separator. Table borders and block placement still differ between renderers; this declared semantic subset is not full Word fidelity or shared pagination. The harness bounds automation time, reports errors and closes only its own Word instance.
