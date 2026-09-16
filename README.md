<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="flash/alder_logo_white_transparent.png" />
    <img src="flash/alder_logo_black_transparent.png" alt="Alder logo" width="300" />
  </picture>
</p>

<h1 align="center">Alder</h1>

<p align="center">
  An organic language engine for writing, shaping, assembling, and speaking language.
</p>

<p align="center">
  <a href="https://atritheone.com/alder">Website</a> ·
  <a href="#install-alder">Install</a> ·
  <a href="#start-writing">Start writing</a> ·
  <a href="#listen-to-your-writing">Listen</a> ·
  <a href="#updates-and-help">Updates and help</a> ·
  <a href="LICENCE.md">MIT Licence</a>
</p>

Alder is an **Organic Language Engine (OLE)**: a desktop workspace for writing,
editing, exploring words, assembling books, and listening to your work. Your
projects and speech processing stay on your machine. Once installed, Alder works
offline and opens like an ordinary desktop application.

Alder is named after **Dr. Alder Wright**.

## Install Alder

Start with a copy of this repository on the machine where you want to use Alder.
You can ask Codex or another coding agent to install it, or use the commands below
yourself. You do not need to edit any files, fill in package details, or install
Node.js or Python yourself. The repository includes the installation instructions,
platform icons, and dependency information.

### Before you begin

- Have an internet connection for the first installation. Setup downloads the
  application tools, dictionaries, fonts, and local speech models.
- Allow roughly **45 GiB of free working space**, including downloads and the
  installed application. Setup checks available space before large steps.
- Use at least **8 GiB of RAM**; **16 GiB is recommended**.
- Open a normal desktop terminal. Do not run the whole installation as
  Administrator or with `sudo`. Setup will explain any missing system prerequisites.
- Allow time for the large downloads and the checks of writing, publishing, and
  speech. Setup can resume after an interruption.

| Version | Machine requirements and current status |
| --- | --- |
| Alder Organic Language Engine for Windows | Windows x64. Installation and application checks have passed on the Windows development machine using fresh setup resources. |
| Alder Organic Language Engine for Linux | Linux x64 with glibc 2.35 or newer and a graphical desktop. Installation and application checks have passed on Ubuntu 24.04 under WSL/WSLg; the separate Kali VM has not completed the same checks. |
| Alder Organic Language Engine for Mac | macOS 14 or newer. Apple Silicon setup is provided but still needs testing on a Mac. Intel Mac setup is experimental and requires additional time and disk space. |

Mac installation does **not** require an Apple Developer account. Read the
[Mac instructions](docs/setup/macos.md) before installing, especially on an Intel
Mac. See the [Windows](docs/setup/windows.md) or [Linux](docs/setup/linux.md)
instructions for platform prerequisites and help.

### Ask your coding agent

Open this repository in your coding agent and give it this request:

> Install Alder on this machine. Read AGENTS.md and SETUP.md, run setup doctor,
> complete the native installation and verification, and tell me how to open
> Alder and whether any checks remain incomplete. Do not edit the repository or
> supply missing metadata.

The agent is only needed to help with installation or maintenance. You do not
need it running to use Alder.

### Or run setup yourself

Open a terminal in the repository folder.

**Windows — PowerShell:**

```powershell
.\setup.ps1 doctor
.\setup.ps1 install
```

**Linux or Mac — Terminal:**

```sh
bash ./setup.sh doctor
bash ./setup.sh install
```

`doctor` checks your machine and explains anything that needs attention.
`install` downloads the required resources, creates your application, and tests
it. It works in a separate local folder and leaves the repository unchanged.
If setup stops, address the reported issue and run the same command again.
Existing completed work is checked and reused.

Wait for a successful verification result. A result marked **pending** means
some checks still need to run, for example in a graphical desktop session.
The [full setup guide](SETUP.md) explains custom disk locations, offline reuse,
and other installation options.

### Open Alder

After installation, open Alder using the launcher reported by setup:

- **Windows:** **Alder (local)** in the Start menu.
- **Linux:** **Alder** in your application menu, or `~/.local/bin/alder`.
- **Mac:** **Alder.app** in your home folder's **Applications** folder
  (`~/Applications/Alder.app`).

You do not need a terminal or the repository to open the installed application.
Keep access to the matching repository version and setup resources for checking,
repairing, or updating your installation.

## Start writing

Create a book, essay, or blank document and write in **Write**. Text flows across
pages as you type. Use the **Book** navigator to add and reorder chapters, and
**Pages** to arrange pages within a chapter.

Use the **Sandbox** for alternate wording and independent drafts. Inserting a
draft into a chapter copies its content; later sandbox experiments do not change
the book. **Language Tools** offers checks and transformations you can preview.

Choose page size, margins, fonts, and styles to shape your document. Alder includes
Liberation fonts and also discovers fonts installed on your machine. Available
fonts can differ between Windows, Linux, and Mac. If a document uses a missing
font, Alder identifies it and displays a fallback while keeping the original font
choice stored in the document. You do not need to copy fonts from another OS.

The top menus and shortcuts follow your platform, including the Mac application
menu and Command-key shortcuts. Use the shortcuts shown in Alder's menus.

### Save and back up your work

Alder saves changes to its local working database. Save a **`.alder` archive** to
keep a portable copy of a project, including its images and reference voices.
Keep backups of those archives separately from the application.

The editor provides typing undo and redo; project history also covers structural
changes. Closing Alder finishes pending saves before stopping its local services.

### Read, import, and publish

Open **Page Preview** from Write's page controls to see the final typeset PDF,
including publication matter, running headers, and page numbers. A reflowable
reading view is also available.

- Write with headings, lists, links, tables, images, and reusable styles.
- Explore offline definitions, synonyms, antonyms, word forms, and spelling.
- Import text, Markdown, HTML, DOCX, and EPUB, or extract text from other supported
  documents such as PDFs.
- Export TXT, Markdown, HTML, DOCX, PDF, EPUB, and AZW3.
- Create definition cards and save them as PNG, JPEG, or PDF.

See the [writing and reading guide](docs/book-and-reading.md) for layout and
shortcuts, and the [publishing guide](docs/publishing-support.md) for supported
formats and import limitations.

## Listen to your writing

Alder includes **Chatterbox Turbo** for local narration, with reference voices and
pronunciation preferences. **Windows SAPI** voices provide an additional option
on Windows. No hosted speech account is required.

Read a selection, chapter, or book, follow the spoken words, pause, seek, and add
bookmarks. Completed passages can play while later passages are being prepared.
You can keep alternate takes and export **WAV, MP3, or FLAC** audio and timed text.

Local speech recognition checks generated speech against the intended wording.
Listening review lets you approve a take separately from the automatic checks.
Automatic checks do not replace listening to the result yourself.

Setup verifies CPU narration. Generation can take time, especially in a virtual
machine. The Windows and Linux installation path does not currently install CUDA
GPU support; Mac acceleration has not yet been validated.

## Updates and help

Close Alder before maintenance. To update, obtain the new repository version and
ask your agent to run setup's `update` command. Setup does not fetch or alter your
repository for you. Keep a backup of your projects before updating.

You can also run these commands yourself, replacing `verify` with the command
you need:

```powershell
# Windows
.\setup.ps1 verify
```

```sh
# Linux or Mac
bash ./setup.sh verify
```

| Command | When to use it |
| --- | --- |
| `verify` | Check the installed application and its writing, publishing, and speech features. |
| `repair` | Restore damaged application or setup files. |
| `update` | Install the repository version you have obtained. |
| `rollback` | Return to the previous verified version when its data format is compatible. |
| `uninstall` | Remove the managed application while preserving your projects and settings. |
| `clean-cache` | Preview downloaded files that can be cleared; add `--yes` to clear them. |

If you installed to custom locations, keep using the same location options.
See [maintenance](docs/setup/maintenance.md) for details. If installation fails,
use the [troubleshooting guide](docs/setup/troubleshooting.md) and give your agent
the error code and reported log location. You should never need to invent missing
package metadata or edit source files to install Alder.

Visit the [Alder website](https://atritheone.com/alder), or contact
[edward@atritheone.com](mailto:edward@atritheone.com).

Alder is available under the [MIT Licence](LICENCE.md).
