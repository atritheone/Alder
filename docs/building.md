# Building Alder

This guide describes the developer build workflow. End users should follow
[SETUP.md](../SETUP.md): setup provisions, builds and installs Alder on their own
machine without editing the checkout. It uses an external workspace and the
hashed native locks under `resources/locks/`. The finished app runs offline.

## Development

Use Node.js 24 and Python 3.11 for development. Install JavaScript dependencies with `npm ci` and core Python dependencies into `work/venv` with `pip install -r requirements-core.lock.txt`. The 48-package lock records the tested release environment; `requirements.txt` describes the supported dependency ranges. Release provisioning validates standalone CPython 3.11.16 build 20260901 and the exact lock. The speech runtime has a separate dependency environment; do not upgrade it through the application environment.

Start the Python service with `PYTHONPATH` set to the repository's `backend` directory, `ALDER_RESOURCES_DIR` set to `work/bundle-resources`, and `ALDER_DATA_DIR` set to a development directory. Run `python -m alder --port 8765`. Start Vite with `npm run dev`. Vite proxies `/api` to the loopback service.

`npm run build` builds the TypeScript UI and desktop shell. `npm run desktop` launches Electron, which starts its own authenticated Python service on an available loopback port. It uses the same bundled runtime layout as the release.

## Runtime resources

The proofreading component is provisioned by managed setup using `resources/manifests/proofreading.json` and `resources/locks/proofreading-*.txt`. It has its own Python environment. See [offline proofreading](offline-proofreading.md) before making distribution or quality claims; advanced review is experimental and Mac qualification is pending.

`work/bundle-resources/` contains:

- `python/` — standalone core Python and application dependencies.
- `nltk_data/` — offline WordNet resources.
- `fonts/` — redistributable Liberation Serif fonts and license.
- `tools/` — portable Calibre, Java and EPUBCheck.
- `sources/` and license files — applicable bundled-component source/notices.
- `speech/python/` — isolated standalone speech Python and dependencies.
- `speech/chatterbox/src/` — Chatterbox source imported using a relative path.
- `speech/models/turbo/` — required Turbo weights, tokenizer and revision identifier.
- `speech/ffmpeg/` — FFmpeg and ffprobe.
- `speech/qa/` — separate transcription-check runtime and base.en model.

Run `work/venv/Scripts/python.exe scripts/prepare-reading-resources.py` to provision the checksum-pinned Apache Tika document extractor. Its original JAR includes its component licences and runs under Alder's bundled Java.

Use `scripts/prepare-core-resources.py` for the portable core interpreter, the exact application packages, and checksum-verified WordNet/OMW dictionaries. It supports explicit source paths, `--archive-base`, `--offline` and `--verify-only`; use `--help` for build-machine configuration. Use `scripts/prepare-speech-resources.py` to assemble and verify speech resources from the pinned development installation and cached official models. Use `scripts/prepare-publishing-tools.ps1` for pinned, checksum-verified publishing tools and fonts. These are build-time operations. Runtime resource verification is mandatory before packaging and errors if any required component is missing; it also runs an isolated core import and offline dictionary audit.

The large models are deliberately absent from Git. Existing builders provide model
artifacts through resource provisioning; repository setup retrieves pinned
artifacts directly on the user's machine. No API key is bundled or required.

## Verification and packaging

1. Run `npm run typecheck` and `npm run build`.
2. Run `work/venv/Scripts/python.exe -m pytest backend/tests` with `PYTHONPATH=backend` and the bundled resources configured.
3. Run browser workflow tests with the Vite/Python development servers running: `npx playwright test frontend/tests --workers=1`.
4. Run `node scripts/verify-resources.mjs` and `node scripts/smoke-desktop.mjs`.
5. Run `npm run package` to produce `release/win-unpacked/`.
6. Run `node scripts/smoke-desktop.mjs --packaged` and `node scripts/test-desktop-lifecycle.mjs --packaged --features`. These strip external tool paths and unrelated Python configuration; the lifecycle check closes immediately after an edit and verifies the committed database and stopped backend.
7. Run `release/win-unpacked/resources/python/python.exe -I scripts/verify-publishing-tools.py --resources release/win-unpacked/resources --output work/packaged-publishing-isolation`. This checks the shipped EPUB/AZW3 engines with an empty external tool path. Keep generated speech and publishing verification results in ignored `work/` directories.

Ship the complete release directory. Its size reflects the included local speech runtime/model; a small executable alone is not a complete Alder distribution. The development build is unsigned; code signing for a public distribution uses the distributor's signing identity and is not a dependency of local operation.

Do not copy a live project database into a release or Git commit. `.alder` project archives and authored outputs are user data. Resource caches, test output, node_modules, Python environments and release files remain ignored.

Speech checking is mandatory for automatic playback. The base.en checker is required; builders can include a pinned `small.en` snapshot using `prepare-speech-resources.py --secondary-qa-model <snapshot>`. Alder consults this optional CPU checker only after an ambiguous primary result, within a separate timeout. Missing secondary resources retain bounded automatic recovery. Regular Write playback automatically tries up to six fresh takes for a short unresolved passage, with a shared twelve-attempt/180-second cap when a source section is subdivided. It preserves checked sections and the reading position; it does not require listening review. Long sentences prefer clause boundaries, and known spelling/compound variants do not trigger regeneration. Ordinary English words capitalised for emphasis are normalised in spoken input, while recognised initialisms and explicit pronunciation replacements are preserved; the manuscript is unchanged. Persistently unsuccessful speech remains stopped rather than playing rejected audio. Narration production retains explicit review for unresolved output. No model is downloaded at runtime.

Run `scripts/benchmark-speech.py --data work/<fresh-directory> --device cuda` with `PYTHONPATH=backend` for real-engine availability measurements. Use `--device cpu` separately and `--sustained-seconds 3600` for an hour of generated stress audio with fresh seeds. Results distinguish verified backend availability from acoustic output latency; diagnostics never establish human listening approval.


Write’s Page Preview button opens the publication proof without replacing the editor.
`node scripts/test-write-preview-desktop.mjs` checks PDF rendering, editor identity,
selection and undo preservation in an isolated desktop workspace.

Speech input expands unambiguous English contractions with original-text offsets.
English content checks accept contracted forms, listed spelling/compound variants,
and omitted Latin accents; source text and synthesized pronunciation keep the
original accents. These spelling checks cannot certify pronunciation or prosody.
Both speech workers use UTF-8 explicitly on Windows. The real-engine corpus includes
scientific vocabulary, names, accented loanwords, historic spellings and contractions;
keep benchmark output under `work/`, not in Git.


Windows SAPI timing uses non-overlapping progress spans. Repeated notifications
for one source span are merged; repeated words at different positions remain.
Decoded event-text lengths avoid inflated SSML entity counts. Versioned SAPI
caches prevent old rejected timing metadata from being reused.

Playback sliders support mouse-wheel adjustment without scrolling the document.
Speed dragging and wheel adjustment use 0.05 steps; typed speed retains two-decimal
precision. Volume wheel adjustment uses five percentage points per step.
`node scripts/test-playback-sliders-desktop.mjs` checks both Write and Narration,
including controls that are hidden and reopened.


## Windows installer

Run `npm run installer` to build the self-contained Windows x64 application and an offline installer under `release/Alder-0.11.0-Windows-x64/` (using the package version). The installer and its `.7z` data file must stay together. The separate data file avoids the embedded payload size limit with Alder's large speech resources. Setup verifies SHA-256 before extracting, installs for the current Windows user, creates a Start menu shortcut and registers an uninstaller with Windows Settings. It requires Windows 10 or later. No files are downloaded during installation.

The build uses the checksum-pinned NSIS and 7-Zip toolsets provided by electron-builder. `node scripts/build-installer.mjs --compile-only` rebuilds just the installer wrapper against an existing payload, for installer-script changes only. The uninstaller removes the shipped file manifest and associated Python bytecode; unrelated files and user data are preserved. Internal `/TEST` setup mode skips shortcuts and registry changes for isolated installation/uninstallation checks. Generated files, logs and test installations stay in ignored `release/` and `work/` directories. Builds are unsigned until a distributor supplies a signing identity.
