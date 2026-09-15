# Books and document reading

Alder's main document is a book containing ordered chapters. Each chapter owns a continuous ProseMirror document. Paragraphs and their formatting flow through vertically stacked writing pages. Measured, layout-only spacers keep text and ordinary table rows inside page margins without changing the saved document. Page width, height, margins, typography, images, explicit breaks, and text all affect pagination. Enter a page number and press Enter to navigate using measured document positions rather than word-count estimates. Long paragraphs flow across page boundaries.

The Pages view moves the actual rich content in a measured page range. Moving a page adds explicit page breaks between the resulting ranges, preserving the chosen boundaries; typing undo reverses the operation. Page moves currently stay within a chapter. Chapters can be renamed, reordered, included/excluded, and deleted independently. Writing-page numbers are local to the chapter. The final publication can paginate differently because its typesetter adds book/chapter titles, contents, and running matter; Page Preview is the final PDF proof. This is not yet an InDesign frame/composition engine or an exact Word layout implementation.

## Saved data and compatibility

`book.version` is 1. `book.chapters[]` contains `id`, `title`, `role`, `document`, derived `text`, `include`, and optional `voiceId`. Chapter array order is authoritative. The backend validates documents, unique identities, asset references, inclusion, and version before acknowledging a save. The normal project revision, archive and history mechanisms include the complete book.

Opening an old project copies its included publication wording into chapter documents once. The conversion respects selected/pinned versions, frozen documents and reading order. Original drafts, alternatives, excluded material and frozen snapshots remain in the archive. A book's publication and whole-book narration use its chapters, never the old scratch collections. Inserting sandbox material copies its rich text into the current chapter.

## Opening and reading

Open document accepts multiple files. Each becomes a chapter; existing chapters are retained. Clipboard imports create a chapter too. UTF-8/UTF-16 and extensionless/plain text are read locally. HTML, Markdown, DOCX and EPUB use the existing structured importers. Other documents use bundled Apache Tika 3.3.2; supported ebook formats use bundled Calibre. Tika and Calibre are private application resources, not end-user installation requirements. Text-only extraction reports that source geometry, embedded objects and complex formatting have not been reproduced.

PDF and RTF extraction and Unicode/plain-text import have real fixtures. The parser also accepts supported office, OpenDocument, email and ebook formats; individual format fidelity is not comprehensively certified. “Any file” means the open picker is unrestricted and Alder attempts local text extraction. It does not mean arbitrary binary formats, encrypted/DRM files or image-only scans are readable. OCR is not bundled. Input is capped at 100 MB and extracted structured text remains subject to project limits. No source document is modified.

The document reader supports a chapter, included book chapters in order, a selection, and reading from the cursor. Completed chunks can begin playing while later chunks render. Pause/resume, stop, playback speed, volume, seek after assembly, stored bookmarks, WAV/MP3/FLAC saving, and SRT/LRC timed-text export are available. Subtitle entries currently follow rendered chunks rather than individual words.

Chatterbox remains the included default engine. The existing local recognition worker supplies estimated word times. Only matched recognised words are mapped to the unchanged written text, including pronunciation substitutions. Recognition omissions/mismatches fall back to passage highlighting; they are not represented as exact forced alignment. Text edits invalidate following for the affected recording. The audio still belongs to its saved source revision.

Windows SAPI voices are discovered through Windows' own speech runtime. Installed compatible voices are optional; Chatterbox does not depend on them. SAPI supports voice selection, rate (-10 to 10), pitch (-10 to 10 semitones, voice-dependent), volume and native speech-event timings. SAPI 4 and 32-bit-only voice engines are not hosted. System voices are not copied into `.alder` archives. Missing optional voices must be replaced with a voice available on the destination machine.

Pronunciation rules accept literal wording or regular expressions with capture-group replacements. Matching uses a bounded execution time. Spoken substitutions and their source maps do not rewrite the book. The existing spelling, dictionary, alternative-word, style and definition-card tools remain available.

## Desktop reading controls

- Ctrl+Alt+R: read the selected scope.
- Ctrl+Alt+Space: pause/resume reading.
- Ctrl+Alt+S: stop reading.
- System tray: show Alder, read, pause/resume, stop, or quit.

These shortcuts are registered only by the normal desktop application. If another application owns a shortcut, Alder leaves that registration alone. The browser development build has in-window controls. Space outside text controls toggles reading; Tab retains ordinary keyboard navigation. Clipboard access happens only when the user presses Clipboard.

## Compatibility scope

[Balabolka's official description](https://www.cross-plus-a.com/balabolka.htm) is the reading feature reference. Current work covers local engines, document/clipboard reading, highlighting, pronunciation rules, voice controls, audio saving, bookmarks, external timed text and tray/global-key controls. It does **not** establish full Balabolka parity: legacy SAPI hosts, every legacy file format, embedded MP3 synchronised lyrics, all speech markup, every audio container, typing echo, and its full batch/command-line surface remain unsupported or unverified. Network TTS/translation integrations remain outside the local-only scope.

Build-time extractor provenance: [Apache Tika downloads](https://tika.apache.org/download.html), [3.3.2 SHA-512](https://downloads.apache.org/tika/3.3.2/tika-app-3.3.2.jar.sha512). `scripts/prepare-reading-resources.py` pins and verifies the distribution. Component licences remain in the original JAR.

## Raw editing

The Raw button in Write's formatting toolbar switches between formatted editing and editable source markup. Both modes use the same centred pages, page size, margins, zoom and page-number navigation. Raw text wraps and flows vertically over page boundaries; pasted rich content is inserted as plain source text. Imported Markdown keeps its original syntax, including reference links, until formatted edits require regeneration. Other documents use HTML for Alder's supported rich formatting: paragraphs, headings, fonts, emphasis, highlights, lists, tables, images and page breaks. Regenerated Markdown is used only if it round-trips without losing formatting; otherwise Raw uses HTML. This edits Alder's document model, not the original file's internal XML or binary structure.

Source edits update the saved chapter and its plain-text projection. Invalid or unsupported markup keeps the source draft and last valid formatted document, with an inline error. Correct the source to return to formatted writing. Opening and closing Raw without editing does not change the formatted document. Single-chapter Markdown exports retain the saved Markdown source when it still matches the document.

SAPI timing events can split one written number or abbreviation into several adjacent fragments. Alder combines fragments using their native UTF-16 source positions, while retaining spaces between separate written words. Timing cache versioning prevents older fragmented metadata from being reused.

Chatterbox input expands numeric en-dash ranges (and hyphenated four-digit year ranges) to “to”, with source mappings retained for highlighting. Transcript comparison recognises those range forms without dropping negative signs or changed numbers. Numbered headings stay attached to their following text and separate from preceding citations, avoiding duplicate reference/list numbers in one synthesis chunk.

Ordinal numerals such as “20th”, “21st” and “112th” compare with their spelled-out forms. Changed ordinal/cardinal values still fail checking. Numbered headings also end at their source line boundary, preserving their grammatical context instead of joining them to the following paragraph and splitting them into incomplete retry fragments.
