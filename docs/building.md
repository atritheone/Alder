# Building Alder

The end-user release is self-contained. The development tools described here are for building the application, not requirements for an Alder user.

## Development

Use Node.js 24 and Python 3.11 for development. Install JavaScript dependencies with `npm ci` and core Python dependencies into `work/venv` with `pip install -r requirements-core.lock.txt`. The 48-package lock records the tested release environment; `requirements.txt` describes the supported dependency ranges. Release provisioning validates standalone CPython 3.11.16 build 20260901 and the exact lock. The speech runtime has a separate dependency environment; do not upgrade it through the application environment.

Start the Python service with `PYTHONPATH` set to the repository's `backend` directory, `ALDER_RESOURCES_DIR` set to `work/bundle-resources`, and `ALDER_DATA_DIR` set to a development directory. Run `python -m alder --port 8765`. Start Vite with `npm run dev`. Vite proxies `/api` to the loopback service.

`npm run build` builds the TypeScript UI and desktop shell. `npm run desktop` launches Electron, which starts its own authenticated Python service on an available loopback port. It uses the same bundled runtime layout as the release.

## Runtime resources

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

The large models are deliberately absent from Git. Builders provide model artifacts through the resource provisioning process; end users receive them in the completed release. No API key is bundled or required.

## Verification and packaging

1. Run `npm run typecheck` and `npm run build`.
2. Run `work/venv/Scripts/python.exe -m pytest backend/tests` with `PYTHONPATH=backend` and the bundled resources configured.
3. Run browser workflow tests with the Vite/Python development servers running: `npx playwright test frontend/tests --workers=1`.
4. Run `node scripts/verify-resources.mjs` and `node scripts/smoke-desktop.mjs`.
5. Run `npm run package` to produce `release/win-unpacked/`.
6. Run `node scripts/smoke-desktop.mjs --packaged` and `node scripts/test-desktop-lifecycle.mjs --packaged --features`. These strip external tool paths and unrelated Python configuration; the lifecycle check closes immediately after an edit and verifies the committed database and stopped backend.
7. Run `release/win-unpacked/resources/python/python.exe -I scripts/verify-publishing-tools.py --resources release/win-unpacked/resources --output work/packaged-publishing-isolation`. This checks the shipped EPUB/AZW3 engines with an empty external tool path. Record actual speech and publishing release checks in `docs/verification.md`.

Ship the complete release directory. Its size reflects the included local speech runtime/model; a small executable alone is not a complete Alder distribution. The development build is unsigned; code signing for a public distribution uses the distributor's signing identity and is not a dependency of local operation.

Do not copy a live project database into a release or Git commit. `.alder` project archives and authored outputs are user data. Resource caches, test output, node_modules, Python environments and release files remain ignored.
