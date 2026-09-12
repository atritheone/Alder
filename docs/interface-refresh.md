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
Sitka Text regular, bold, italic, and bold italic faces are included as WOFF2
for the interface and TTF for PDF/card output. `scripts/prepare-sitka.py`
reproduces these assets from the four supplied TTC collections with FontTools
and Brotli. IPA in definition-card exports uses the existing bundled phonetic
fallback because those characters are absent from the supplied Sitka faces.

The bottom question-mark button toggles context help for hover and keyboard
focus. The bottom sandbox toggle explains that it opens independent drafts,
language tools, and narration; the duplicate close arrow and positional hint
are removed. User-facing writing terminology uses “draft” in place of “clip.”

Reading and sandbox narration default to 200% playback gain, adjustable up to
400%, with compression for peaks. Playback speeds accept 0.001 increments from
0.250× to 3.000×. Highlights sample the audio clock on animation frames and
never expand to a sentence. Very short alignment gaps retain the preceding
word; silence and missing timing clear the highlight. Multiword pronunciation
spans are not falsely highlighted as a single word. Saved audio files retain
their source levels; amplification is a playback setting.

Verification includes all 15 browser workflows, 25 TypeScript unit checks,
83 backend archive/export/layout checks, and `scripts/test-interface-desktop.mjs`.
The desktop test measures nonzero audio samples through the real media graph,
verifies 2× gain and 0.937× speed, and samples highlights to verify one word at
a time. This update builds the development application; no release package is
replaced automatically.
