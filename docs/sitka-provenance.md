# Legacy Sitka font assets

The repository contains four Sitka Text TrueType faces in `backend/alder/fonts/`
and four WOFF2 faces in `frontend/public/fonts/`. The frontend references the
WOFF2 files in `frontend/src/styles.css`. Their retention for older authored
content is described in [interface-refresh.md](interface-refresh.md).

## Recorded preparation method

`scripts/prepare-sitka.py` extracts the Sitka Text face from supplied `Sitka.ttc`,
`SitkaB.ttc`, `SitkaI.ttc` and `SitkaZ.ttc` collections with fontTools, writes
TrueType files, and converts them to WOFF2. This identifies the checked-in
preparation procedure, not proof of the exact input used for these binaries.

The original collection files, their acquisition/source record, their hashes,
and a corresponding licence/redistribution record have not been located in the
tracked repository. This document does not establish redistribution permission
or place these assets under Alder's MIT licence. Recover that evidence before
treating their distribution provenance as complete. Replacing or removing the
fonts also requires updating their consumers and checking legacy documents.

## Current file identities

SHA-256 hashes recorded on 2026-11-03:

| Directory | File | SHA-256 |
| --- | --- | --- |
| `backend/alder/fonts` | `SitkaText-Bold.ttf` | `3fc74784faa4bddcfa660ef3a1d8b6c130de8e24e67ace67b10a37eaf9bdc8b3` |
| `backend/alder/fonts` | `SitkaText-BoldItalic.ttf` | `e57912ad1bd7654d10ea74a0c729c9c28a3d54da0dbed9414d4f1a6010848f8e` |
| `backend/alder/fonts` | `SitkaText-Italic.ttf` | `38615d525d93366f2ad1e0cb3792c4800d19dcd20edcd43cfce3a96eb5d73278` |
| `backend/alder/fonts` | `SitkaText-Regular.ttf` | `7a46ab9ac19ea6254cf470cccbf60d2e3e937cf5baecc1c5ad2310c0df76a142` |
| `frontend/public/fonts` | `SitkaText-Bold.woff2` | `8fe3e1f352b66f98a038ba359c6d85df9a37ed9e69a2323fa44de28757226697` |
| `frontend/public/fonts` | `SitkaText-BoldItalic.woff2` | `094da764860e6f2f8ce4e0b36f553c19c52d1e641f8d8b93130af4ecfb5be210` |
| `frontend/public/fonts` | `SitkaText-Italic.woff2` | `92fabf65e57e54d4d65db17b5226d71b59ea18a9892ecb20dce898091307004c` |
| `frontend/public/fonts` | `SitkaText-Regular.woff2` | `db213a1649f63c7668159feac7eea456e669402b7a2ccc9f815fd49f15e54528` |
