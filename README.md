<h1 align="center">Alder</h1>

<p align="center">
  An organic language engine for writing, shaping, assembling, and speaking language.
</p>

<p align="center">
  <a href="#about-alder">About</a>
  ·
  <a href="#how-to-use">How to use</a>
  ·
  <a href="#features">Features</a>
  ·
  <a href="#development">Development</a>
  ·
  <a href="#builds">Builds</a>
  ·
  <a href="#local-narration">Local narration</a>
  ·
  <a href="LICENCE.md">MIT Licence</a>
</p>

## About Alder

Alder is an **organic language engine**: a desktop workstation for processing,
editing, and creating language. Words and passages can be collected, explored,
rearranged, compared, published, and heard within one application.

Alder is named after **Dr. Alder Wright**.

## How to use

Create a book, essay, or blank document and write directly in the main chapter
editor. Text flows automatically across pages as you write.

- Add and reorder chapters in the **Book** navigator.
- Use **Pages** to arrange the text on physical writing pages.
- Explore words and keep independent experiments in the lower **Sandbox**.
- Open documents or clipboard text and read them with Chatterbox or Windows SAPI.
- Follow the spoken words, pause, seek, bookmark, and save narration.
- Preview the final publication and export the book.

### Chapters, pages, and the sandbox

A chapter owns continuous structured prose: words, sentences, paragraphs, lists,
tables, and images. Page size, margins, typography, and explicit page breaks
control its flow. Moving a writing page preserves its current boundaries with
page breaks and can be undone.

The sandbox is a separate place to try wording and keep draft versions. Inserting
a draft into the chapter copies its content; subsequent sandbox experiments do
not change the book.

Writing pages are an editable layout. **Page Preview** shows the final typeset
PDF, including publication matter, running headers, and page numbers.

### Saving your work

Alder automatically saves acknowledged changes to its local working database.
Save a `.alder` archive to collect a project, its images, and its reference
voices into a portable file.

Project undo and redo include saved project and structural changes. The editor
has separate typing undo and redo. Closing Alder finishes pending saves before
stopping its background services.

## Workspace views

- **Write** — continuous chapter prose on automatically flowing pages.
- **Pages** — page arrangement within the selected chapter.
- **Page Preview** — exported PDF pages and a reflowable reading view.
- **Sandbox** — independent drafts and word exploration below the document.
- **Language tools** — checks and previewable transformations.
- **Narration** — saved audio, waveforms, and listening review.

## Features

- Structured text, headings, lists, links, images, and tables
- Character formatting and inherited paragraph and character styles
- Chapter ordering, inclusion, automatic page flow, and page arrangement
- Independent sandbox drafts and alternate versions
- Offline definitions, synonyms, antonyms, word forms, and spelling
- Custom dictionaries, pronunciation preferences, and language rules
- Document setup, metadata, ebook covers, and authored glossaries
- PDF page navigation and zoom
- Reflowable reading width, type size, and contents navigation
- TXT, Markdown, HTML, DOCX, PDF, EPUB, and AZW3 export
- Structured text, Markdown, HTML, DOCX, and EPUB import
- Local text extraction from PDF, RTF, office documents, ebooks, and other supported files
- Unicode and extensionless text, clipboard text, and multiple-file opening
- Built-in EPUB validation
- Definition cards with headword, IPA, part of speech, and meaning
- PNG, JPEG, and PDF definition-card output
- Local Chatterbox narration, reference voices, and optional Windows SAPI voices
- Word-following highlights, chapter/book/selection/cursor reading, and bookmarks
- Progressive playback of completed chunks while later text is rendered
- SAPI rate and pitch, playback speed and volume, and pronunciation expressions
- SRT/LRC timed text, system-tray controls, and global reading shortcuts
- Resumable rendering, cached chunks, and saved audio takes
- Local spoken-word checking and explicit listening approval
- WAV, MP3, and FLAC audio output
- Saved pane sizes, interface scaling, and high-contrast settings

## Architecture

Alder combines a TypeScript interface with Python application services:

```text
TypeScript interface
        │
        └── Electron desktop shell
                    │
                    └── Local Python services
                            ├── Projects and revision history
                            ├── Language and dictionaries
                            ├── Publishing and definition cards
                            └── Chatterbox and narration review
```

Electron starts and manages the application's own local services. Writing is
saved through an authenticated application bridge. Speech runs in separate
workers so model loading and rendering do not block the editor.

The finished application includes its own Python environments, language data,
fonts, PDF reader, publishing tools, audio tools, and speech models. These are
application resources rather than end-user installation requirements.

## Development

Development uses Node.js 24 and Python 3.11. From the repository root, install
and verify the TypeScript application with:

```powershell
npm ci
npm test
npm run build
```

The [developer guide](docs/building.md) covers the pinned Python environment,
offline resource preparation, local services, and browser workflow tests.

With the application resources prepared, launch the desktop build with:

```powershell
npm run desktop
```

For browser-based interface development, `npm run dev` starts Vite. The local
Python service must also be running as described in the developer guide.

## Builds

### Windows desktop

Prepare the bundled runtime resources, then run:

```powershell
npm run package
```

The complete application is written to `release/win-unpacked/`. Open
**Alder.exe** from that folder, keeping its accompanying files and resources
together. `Start-Alder.cmd` opens the built application from a development
checkout.

The current uncompressed application is approximately **10.8 GB**, primarily
because it includes the local speech models and runtimes. Normal use does not
download these models. Copying only the executable is insufficient.

### Verification

The release checks exercise actual publishing tools, local speech, the desktop
PDF reader, and saving when the application closes:

```powershell
node scripts/verify-resources.mjs
node scripts/test-desktop-lifecycle.mjs --packaged --features
```

The [verification record](docs/verification.md) separates automated checks,
measured behaviour, and remaining limitations. The [publishing guide](docs/publishing-support.md)
describes import fidelity and format-specific output support.

## Local narration

Alder uses **Chatterbox Turbo** for local text-to-speech. Optional Windows SAPI voices provide another local engine. Pronunciation preferences keep written wording
separate from spoken substitutions.

Rendering preserves the text revision used to produce each job. Completed
chunks can be cached, resumed, auditioned, and assembled into WAV, MP3, or FLAC.
Speech supports CPU inference and compatible NVIDIA GPUs.

Optional local recognition compares the spoken result with the intended
wording. Chatterbox word timing comes from local recognition; SAPI timing comes from speech events. Unaligned wording uses passage highlighting. Review shows the written, spoken, and recognised text alongside saved
takes and their waveforms. Listening approval is recorded separately and does
not rewrite recognition results.

## Technology

Alder uses TypeScript, React, ProseMirror, Vite, Electron, PDF.js, the Web Audio
API, Python, FastAPI, SQLite, WordNet, Chatterbox, PyTorch, ReportLab, EPUBCheck,
Calibre, Apache Tika, and FFmpeg.

See the [book and reading guide](docs/book-and-reading.md) for layout behaviour, file fidelity, shortcuts, and current limits.
