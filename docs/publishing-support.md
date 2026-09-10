# Alder publishing and definition cards

The publication service builds every output from the same explicit collation. It resolves section order, placement order, inclusion, a placement's selected variant or its clip's accepted variant, and frozen document/text snapshots. A muted audition track remains in the written publication unless its placement is excluded. Draft clips with no included placements are reported and omitted. Repeated placements are reported and repeated. Missing references fail visibly instead of silently changing the manuscript.

## Supported document formats

| Format | Export | Import |
| --- | --- | --- |
| TXT | Accepted wording and reading order, optional title/author, section titles | UTF-8 and BOM support; Windows-1252 fallback with a warning |
| Markdown | Headings, emphasis, code, lists, quotes and safe links | CommonMark parsed with active HTML disabled |
| HTML | Self-contained semantic page preview with collected raster images and publication styles | Headings, paragraphs, emphasis, links, lists, tables and embedded images; active content removed |
| DOCX | Editable semantic document with metadata, styles, headings, inline marks, links, tables, images, contents links, page size/margins and running header/footer | Body order, headings, basic marks, links, tables and collected images |
| PDF | Searchable text, embedded supported TrueType fonts, metadata, headings, contents links, lists, images, tables, page settings and pagination | Not imported as editable prose |
| EPUB 3 | Ordered XHTML spine, semantic section roles, navigation contents, metadata, embedded images, optional cover and publication CSS | Spine reading order and semantic content; embedded images collected |
| AZW3 | Real Calibre conversion of a validated EPUB | Not imported |

Named paragraph and character styles resolve base → derived style → direct formatting on an isolated publication snapshot. Missing bases and inheritance cycles fail explicitly. Null/empty properties inherit; zero spacing and indentation remain explicit. HTML/EPUB use resolved CSS, DOCX creates paragraph/character styles, and PDF uses its supported style mapping. The source project, variants and frozen snapshots remain unchanged. Font size (6–72 pt), paragraph alignment, line-height multiplier (1–3), spacing (0–144 pt), first-line/left indentation (−144–144 pt) and keep-with-next are supported. CSS named/hexadecimal colours are normalised; translucent text colours are flattened against white with a notice. Text marks include strong/emphasis, underline, strike, sub/superscript, highlight, safe links and supported inline styling.

**Page Preview** renders the actual backend PDF with locally bundled PDF.js, including its worker, font and decoder resources. Page navigation, zoom and the source revision remain attached to that generated artifact; **Save this PDF** saves the same proof. Its separate reflowable reading mode offers reader width, type size and section navigation, without changing project typography. Reading-mode overrides are a reader approximation; the PDF mode is the definitive page proof.

The `includeGlossary` publication option appends an alphabetically ordered glossary from the project's authored dictionary entries to every output format, including EPUB/AZW3 navigation. It includes the headword, optional IPA/part of speech and definition. Empty/incomplete entries are reported. The generated section exists only in the output snapshot; dictionary data and manuscript placements are not changed. The option defaults off and is independent of definition-card export.

TXT drops formatting and images. Markdown uses alt text for images and tab-separated text for tables. DOCX import does not reconstruct headers, footers, list numbering, comments, notes, tracked edits or exact page layout. Import warnings identify that loss. DOCX export currently flattens table row spans while preserving column spans; PDF uses equal columns and flattens merged cells. PDF reports paragraph/inline font-family substitution rather than pretending that every requested installed font is embedded. Unsupported nodes/marks are reported with retained descendant text where possible. These limits are also returned in each export's `warnings` array.

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

## Source and licence records

- EPUBCheck 5.3.0: [official W3C installation documentation](https://www.w3.org/publishing/epubcheck/docs/installation/) and [release](https://github.com/w3c/epubcheck/releases/tag/v5.3.0). The downloaded release ZIP SHA-256 is `6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5`. Preserve its licence and all dependency notices.
- Liberation Serif 2.1.5: [official release](https://github.com/liberationfonts/liberation-fonts/releases/tag/2.1.5), [SIL Open Font License](https://github.com/liberationfonts/liberation-fonts/blob/main/LICENSE). The downloaded TTF archive SHA-256 is `7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0`. Unmodified font files, licence and author list are collected in the bundle resources.
- EPUB structure follows the [W3C EPUB 3.3 specification](https://www.w3.org/TR/epub-33/). DOCX traversal follows [python-docx's document-order API](https://python-docx.readthedocs.io/en/develop/api/document.html).
- PDF.js 6.3.289: [Mozilla PDF.js examples](https://mozilla.github.io/pdf.js/examples/) and [official distribution](https://www.npmjs.com/package/pdfjs-dist). Apache-2.0; standard font notices accompany the bundled reader assets. The version is pinned in `package.json`/`package-lock.json`; no CDN resource is required at runtime.

The desktop bundle's third-party notices must also preserve the Calibre and portable Java distribution licences and relevant source obligations; their versions and archives are recorded by the packaging stage.

## Verification record

The publishing tests exercise accepted variants, frozen snapshots, inclusion, ordering, stale references, image containment, active-content removal, Unicode PDF text, metadata, rich DOCX round trips, inherited character/paragraph styles, invalid style graphs, opt-in glossary output in seven formats, EPUB container/spine validation, actual EPUBCheck invocation and actual Calibre AZW3 conversion. Definition tests exercise PNG/JPEG/PDF, Unicode pronunciation, custom dimensions, fitted text, missing fonts, invalid sizes and overlong definitions. Browser tests render a real six-page PDF, verify navigation/zoom and reading controls, preserve source revision and recover from a failed export.

Representative publication PDF and definition PNG/PDF pages were rasterised with Poppler and visually inspected for clipping, legibility, tables and reference geometry. DOCX structure, image relationships, links and reading order passed round-trip tests. The skill's `render_docx.py` was attempted but could not run because this Windows dependency bundle has no LibreOffice executable; native Word pagination has therefore not been visually certified. This does not affect Alder's independent PDF exporter.
