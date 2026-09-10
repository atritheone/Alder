# Her Many Faces audiobook production

Source: the user-supplied AZW3 by Natalie. Voice reference and cover art are the
user-supplied MP3 and PNG; their hashes are recorded in the production plan.

Final folder: `C:\Users\Edward\OneDrive\the one\images\Her Many Faces\Audiobook`.
Working files and resumable checkpoints:
`%LOCALAPPDATA%\chatterbox\audiobooks\her-many-faces`.

The sequence is 23 files: introduction; Book 1 title; six chapters; Book 2 title;
six chapters; Book 3 title; six chapters; closing address. The original chapter
numbers restart within each book; track numbers run continuously from 1 to 23.
Chapter metadata titles start with `Chapter`, without a book prefix. Book names
remain in the grouping field and in the book-start files' own titles.
Both format folders use filename prefixes `01.`, `02.`, through `23.`.
The introduction begins with the exact requested title and author announcement.
The title page and table of contents are not read separately.

Each track has two outputs: 24-bit FLAC and 128 kbps MP3, both mono at 24 kHz,
in separate `FLAC` and `MP3` folders. The FLAC comes directly from retained PCM
masters and is not transcoded from MP3. MP3 uses ID3v2.3; FLAC uses Vorbis comments.
Both have the original PNG embedded as their front cover. Tags identify Natalie as author/album artist and
Chatterbox as the AI narrator. Unknown publisher, copyright, and publication-date
fields are not invented. Each file receives one second of padding at both ends,
after loudness normalisation (target -19 LUFS, true peak -3 dBTP).

Text is extracted in EPUB spine order and split into short sections, preserving
all body words. Each generated section is independently transcribed locally.
Acceptance requires a word match after normalising punctuation, capitalisation,
numerals, and explicitly listed spelling variants. Mismatches trigger retries;
persistent failures are split further, then held for review. Only accepted
sections are assembled. This checks spoken content; it does not rate acting or
prosody. Chatterbox's watermark remains enabled. The source text keeps its British
spelling. American spellings returned by the speech recognisers are treated as
transcription variants; they are never substituted into the reading script.

The final audit checks source coverage, section order, MP3/FLAC decoding, duration,
clipping, a full second of quiet at both ends, tags, track counts, and the exact
cover hash. The output includes a playlist, checksums, reading script, and quality
report in addition to the 23 files in each format and cover.

Commands from this project folder (the environment must already be installed):

```powershell
# Build the reading plan after Calibre conversion to source.epub:
& "$env:LOCALAPPDATA\chatterbox\qa-venv\Scripts\python.exe" audiobook_extract.py
# Render or resume using existing section checkpoints:
& "$env:LOCALAPPDATA\chatterbox\venv\Scripts\python.exe" audiobook_render.py
# Audit all final files and write the playlist/report:
& "$env:LOCALAPPDATA\chatterbox\qa-venv\Scripts\python.exe" audiobook_formats.py
& "$env:LOCALAPPDATA\chatterbox\qa-venv\Scripts\python.exe" audiobook_audit.py
```

The speech recognisers live in a separate QA environment. They run locally on
the CPU while Chatterbox uses the NVIDIA GPU. No book text or voice audio is sent
to a remote synthesis/transcription service.
