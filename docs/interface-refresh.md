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
longer document, and uses glyphs for Write and Pages. Page Preview opens inside Write from its page controls; Back To Write retains the editor, selection, and undo history. Blue
marks active controls, sliders, and primary actions against grey surfaces.
Library width can be dragged or adjusted with the separator's arrow keys; a
small arrow at the end of Search Library hides it; an edge arrow restores it. Menus switch on hover while open and
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
supplied white tree with a transparent background; interface accents use dark slate blue (#293f5e). The start screen, About panel, favicon, window,
and Windows executable share these assets. `npm run branding` regenerates
PNG and ICO assets from `frontend/public/branding/alder-icon-source.png`. Windows builds
create a branded `Alder.exe` beside the development Electron runtime, used by
`Start-Alder.cmd` and `npm run desktop`; the dependency executable is preserved.
Release configuration enables icon/metadata resource editing while leaving
code signing disabled. The saved status reads “Saved”. Branding verification
checks executable icon resources, native Windows icon extraction, UI marks,
blue accents, and the save status in the branded desktop application.

The menu bar displays the project name without the brand mark or tagline. The
extra command bar is removed: File contains Open Document and Export, Edit
contains Paste From Clipboard, and Options contains Styles and Document Setup.
Create offers Chapter only for books. Page tools show total words and, for
books, chapter count. Idle reading controls no longer show introductory text.

Collections and Content have a draggable vertical divider; Filters and Content
have a horizontal divider. Both support arrow keys and remember their sizes.
Styles, Templates, Projects, and Project Assets render directly in the library
content pane, including style editing and applying styles to the current text.
The desktop workspace check covers inline managers, both internal dividers,
the outer divider, search toggle placement, document counts, and TXT menus.

Write now stacks pages vertically using measured layout decorations in one
continuous editor. Page navigation uses a number field and Enter; the field
also follows scrolling. Scrollbars are hidden throughout the app and reading
preview while native vertical and horizontal scrolling remain available.
Controls and panels use square corners. Sliders have square thumbs and straight
tracks; the reading-speed slider is 80px wide with fine steps.
Generic narration status messages no longer create a strip under the controls;
ready-audio seeking, bookmarks, and actionable errors remain available.

`scripts/test-vertical-desktop.mjs` checks long-paragraph margins, vertical page
geometry, Enter navigation, edits, explicit breaks, stable pagination at two
zoom levels, HTML import with 90 table rows, and both scrolling directions in
a narrow window. Layout decorations leave the authored text unchanged.

The Windows desktop uses a visible native application menu bar with the full
File/Edit/Create/Read/View/Options/Help actions. The duplicate renderer menu bar
is removed in desktop builds; browser development retains its menu fallback.
Undo, Redo, and Save sit beside the project/view controls. The background tray
icon is removed, while the ordinary window taskbar button remains available.

The speed slider has no tick marks or multiplier suffix, and its numeric field
fits its value. Play starts a new reading, pauses/resumes existing audio, and
refreshes it after wording or voice settings change. Desktop checks exercise
native menu visibility and action routing, inline Styles, the compact speed
field, Play/Pause, reading revised text, and actual one-word speech highlights.


Write reading defaults to From Cursor. Play resumes paused audio if its text,
voice settings, and cursor are unchanged; moving the cursor starts a fresh
reading. Chunking preserves original whitespace so source offsets cannot drift
across repeated spaces, tabs, and line breaks. Punctuation-only leading chunks
are skipped. Word highlights use the playing audio chunk's own clock, sampled
every 25 ms independently of animation-frame scheduling. The complementary
amber highlight has no padding or shadow that could offset its word rectangle.

The project toolbar shares the workspace background, with Undo, Redo, and Save
immediately after the project rename arrow. Write and Sandbox buttons, dropdowns,
and numeric fields have transparent borders and backgrounds, retaining glyph
state colours and an underlined keyboard focus indicator. Panel dividers are
one pixel wide with larger invisible drag targets. The Sandbox word panel can
be resized at its left edge or with arrow keys; its width persists between runs.
Desktop checks cover these controls and live cursor-based SAPI word following.


The library exposes Words as its single word collection, with favourites on
individual rows. Its old description panel is removed and its 91px footprint
remains empty. Filter backgrounds continue to the resize border. Drafts filter
by last edit over rolling day, week, month (30 days), or year (365 days) periods;
All includes undated drafts. Older projects seed missing draft dates from the
project timestamp, and unrelated project saves leave draft dates unchanged.
Sandbox word/sentence counters have no boxes. Write's page total, word/chapter
counts, and zoom share the bottom page navigation bar; the upper count bar is gone.


The Library order is Words, Language Tools, Styles, Templates, Voices, Drafts.
The former description area's reserved space now shares Alder's background.
Write's page-number field fits its digits. Switching from Pages to Write
recalculates centering in a layout effect before paint, avoiding an off-centre
frame caused by measuring the hidden editor at its narrower width.

Write TTS uses WAV internally and no longer exposes a format selector. Play
shows an animated loading indicator during preparation or buffering; Play also
resumes interrupted rendering using retained chunks. There is no separate
Resume Rendering button. Desktop verification delays a real speech response
and presents it as interrupted to verify the spinner and reuse of the same job.
Native feature tooltips and inline teaching paragraphs are replaced with hover
help, preserving accessible control names. The Help menu opens the help area.


Reading no longer has a scope selector: Play reads after the Write cursor.
Pause and Stop place the collapsed cursor at the current spoken word (or the
next word during an alignment gap), independently of Follow Text. Resuming
preserves retained audio and its exact playback time; explicitly moving the
cursor starts a fresh reading. Reaching the end leaves the cursor at the end
of the chapter. Cursor placement uses the original text offsets and avoids
moving into text changed since speech was prepared. Stopping during an initial
request cancels the pending reading rather than letting it start afterwards.


All Library sections now fill the panel height; the reserved bottom space is
removed. During document speech, voice tests, or narration playback, Write's insertion caret is transparent, while
word highlights and selections remain unchanged. Pause and Stop restore it.
Voices are selectable within the Library with Rename, Test, Remove, and Restore
controls. Tests play directly in that panel. Voice names and removals are saved
in Alder's own library settings. Removal leaves Windows installations and saved
reference audio intact, and at least one voice remains available. Voice list
changes refresh the reading selectors without restarting the app.
