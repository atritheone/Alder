# Bundled runtime resources

Alder's Windows application ships its own Python runtime, speech runtime and models, dictionaries, fonts, Java runtime, EPUBCheck, and Calibre conversion distribution. These are private application resources. Writing, definition-card export, document production, and narration do not require the recipient to install Python, Java, Calibre, FFmpeg, or another application.

`ALDER_RESOURCES_DIR` identifies the resource directory in development and packaged builds. The desktop launcher supplies the packaged location, disables the Python user site, and passes explicit resource paths to child processes. Heavy runtime files are generated in `work/bundle-resources`; they are not source files to commit to Git.

## Publishing tools

Run `powershell -ExecutionPolicy Bypass -File scripts/prepare-publishing-tools.ps1` from a Windows development machine. This is a build step with network access. Downloads use fixed versions and SHA-256 checks; an already cached download is also checked before reuse. The completed application uses the extracted payload and performs no installation step.

| Resource | Pinned version | Packaged location |
| --- | --- | --- |
| Eclipse Temurin Windows x64 JRE | 21.0.12.1+1 | `tools/java/bin/java.exe` with complete `conf`, `lib`, and `legal` trees |
| Calibre Portable | 9.14.0 | `tools/calibre/ebook-convert.exe` with the complete application distribution |
| EPUBCheck | 5.3.0 | `tools/epubcheck/epubcheck-5.3.0/epubcheck.jar`, libraries, and notices |
| Liberation Serif | 2.1.5 | `fonts/LiberationSerif-{Regular,Bold,Italic,BoldItalic}.ttf`, `LICENSE`, and `AUTHORS` |

The resource manifest, `publishing-resource-manifest.json`, records the exact download URLs, checksums, source URLs, license locations, and versions. The script obtains the unmodified official Calibre Portable build. Its extraction utility has a short destination-path limit, so the build temporarily maps an unused drive letter to a staging directory within `work/`. The mapping is removed after extraction; the final runtime uses ordinary absolute paths. Calibre documents automated extraction into a supplied directory. [Calibre Portable](https://calibre-ebook.com/download_portable).

The build retains the following source and notice material:

- `sources/calibre-9.14.0.tar.xz`: matching Calibre source release, including build integration and component copyright declarations.
- `sources/calibre-9.14.0-dependency-sources.json`: the source release's dependency URLs, versions, and hashes, retained separately for inspection.
- `sources/calibre-9.14.0-build-readme.rst`: upstream build integration instructions.
- `tools/calibre/LICENSE`, `LICENSE.rtf`, and `COPYRIGHT`: Calibre's GPLv3 text and component notices. Calibre's redistribution documentation requires its source to remain available with redistributed binaries. [Calibre licensing](https://manual.calibre-ebook.com/faq.html#how-is-calibre-licensed).
- `sources/OpenJDK21U-jdk-sources_21.0.12.1_1.tar.gz`: the matching Temurin/OpenJDK source archive. The complete JRE `legal` tree and top-level notices remain alongside the binary. Temurin is distributed under GPLv2 with the Classpath Exception and the included component notices. [Adoptium licensing](https://adoptium.net/docs/faq).
- EPUBCheck's `LICENSE.txt`, `THIRD-PARTY.txt`, and entire `licenses/` directory. These describe its BSD license and individual dependency licenses. [EPUBCheck source](https://github.com/w3c/epubcheck/tree/v5.3.0).
- The fonts' original SIL Open Font License 1.1 and attribution files. The shipped font files retain their original names and contents. [Liberation Fonts](https://github.com/liberationfonts/liberation-fonts/tree/2.1.5).

Keep the source archives and notices in the release payload. The Calibre dependency index identifies upstream dependency sources; it is an inventory of the included version's build inputs, not an assertion that third-party packages all share Calibre's license. The application invokes the packaged converters as separate local processes.

## Isolated verification

`scripts/verify-publishing-tools.py` launches from the bundled Python runtime, clears `PATH` and all external Java/Calibre overrides, and checks that the selected executables resolve inside `ALDER_RESOURCES_DIR`. It builds an EPUB, runs the bundled EPUBCheck, and builds an AZW3 through the bundled converter. Its report includes the exact tool paths and export validation results. The check restores no system state because environment changes exist only inside its process.

Run `work/bundle-resources/python/python.exe -s scripts/verify-publishing-tools.py`. A nonzero exit code blocks packaging. Successful results are written to `work/publishing-isolation-check/report.json`.
