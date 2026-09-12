# Interface and reading update — 12 September 2026

Alder starts at a clean New/Open screen. New supports TXT and DOCX documents,
plus books with chapter count, page presets, orientation, margins, author,
title page, contents, and starting page number. Plain documents export without
generated book headings; Save writes their chosen document format. Existing
Alder archives retain their original storage keys and remain compatible.

Files can be dropped onto either the start screen or workspace. Pending edits
are saved before opening the files. Each dropped file has its own workspace;
the last file is displayed and the others remain accessible under Open.

The duplicate dark title strip and LOCAL badge are removed. Identity is shown
in the menu row and native window title. Chrome uses neutral greys. The supplied
Aptos is the interface preference, with Arial and the system sans-serif fallback
when it is unavailable. Cambria is the default for new documents and books.
The font menus discover the current computer's system and per-user fonts at
runtime, using Windows font enumeration (including named variable instances),
registry locations, and TTC collections, and refresh when
Alder regains focus. They do not use a saved list from the developer's computer.
Document, inline, and style font choices are retained in DOCX/HTML; PDF embeds
supported installed TrueType faces, with a reported fallback for unavailable
or non-embeddable fonts. The earlier Sitka default migrates to Cambria; other
selected document fonts remain unchanged.

Aptos is installed locally, not distributed in the app. Legacy Sitka assets
remain available for older authored content. Definition cards prefer installed
Aptos and use the bundled phonetic fallback for IPA.

The bottom question-mark button toggles context help for hover and keyboard
focus. The bottom sandbox toggle explains that it opens independent drafts,
language tools, and narration; the duplicate close arrow and positional hint
are removed. User-facing writing terminology uses “draft” in place of “clip.”

Reading and sandbox narration default to 200% playback gain, adjustable up to
400%, with compression for peaks. Playback speeds have a notched slider with 0.01 increments from
0.25× to 3.00× and a synchronized field for two-decimal input. Highlights sample the audio clock on animation frames and
never expand to a sentence. Very short alignment gaps retain the preceding
word; silence and missing timing clear the highlight. Multiword pronunciation
spans are not falsely highlighted as a single word. Saved audio files retain
their source levels; amplification is a playback setting.

Font and speed verification covers the production build, 25 TypeScript unit
checks, 59 backend font/book/publication/card checks, and
`scripts/test-interface-desktop.mjs`. The desktop test checks installed font
choices, precise numeric input, slider synchronization, nonzero audio samples,
2× gain, 0.93× playback, and one-word highlighting. Actual desktop font rendering
was also checked: Aptos interface, Cambria document text, and selected Consolas.
This update builds the development application; no release package is replaced
automatically.

The writing workspace now centers each page, including page navigation in a
longer document, and uses glyphs for Write, Pages, and Page Preview. Blue
marks active controls, sliders, and primary actions against grey surfaces.
Library width can be dragged or adjusted with the separator's arrow keys; a
small edge arrow hides or restores it. Menus switch on hover while open and
close when the pointer leaves them.

Empty projects receive one starter sandbox draft on opening. Library word
drops add appropriate spaces and resolve to a text position at paragraph
boundaries. The help box docks at the bottom right beside the sandbox. Voices,
reference imports, auditions, and pronunciation editing live inside the Voices
library panel. Interface labels use title case while authored text retains its
case. `scripts/test-workspace-desktop.mjs` verifies these interactions in an
isolated desktop profile, alongside 27 TypeScript checks.

Alder branding uses the supplied transparent black tree on light UI surfaces
and transparent white tree on dark surfaces. Fixed desktop icons use the
supplied white tree on a black background; interface accents remain blue. The start screen, menu bar, About panel, favicon, window,
tray, and Windows executable share these assets. `npm run branding` regenerates
PNG and ICO assets from `frontend/public/branding/alder-icon-source.png`. Windows builds
create a branded `Alder.exe` beside the development Electron runtime, used by
`Start-Alder.cmd` and `npm run desktop`; the dependency executable is preserved.
Release configuration enables icon/metadata resource editing while leaving
code signing disabled. The saved status reads “Saved”. Branding verification
checks executable icon resources, native Windows icon extraction, UI marks,
blue accents, and the save status in the branded desktop application.
