# Platform support and local installation

Alder has native repository setup entry points for Windows, Linux and macOS. See
[SETUP.md](../SETUP.md). Installation must not edit the checkout or repair missing
repository metadata. A private external workspace holds downloads and builds.

## Reusable implementation

- `backend/alder/runtime-layout.json` defines native runtime paths shared by
  Electron and Python. Resource architecture must match the host.
- Platform helpers cover application data directories, process lifecycle,
  macOS menu roles and file opening, shortcut labels and CPU/CUDA/MPS selection.
- Fontconfig/CoreText discovery supplements directory scans. New documents use
  bundled Liberation Serif; missing authored fonts are labelled and rendered
  with a fallback without rewriting their stored names.
- `scripts/setup/` provisions private interpreters, hashed native dependency locks,
  models and common tools directly from pinned public artifacts. Legacy developer
  helpers remain under `scripts/` but are not the end-user installation path.
- macOS uses the committed `build/alder.icns`; Linux packaging uses `build/icons/`
  and direct installation places its PNG representations in hicolor icon folders.
- `scripts/package-desktop.mjs` remains an optional developer packaging path. It
  avoids duplicate resource configuration and uses disk-backed Unix scratch
  storage. Local installation does not require compressed installers.

The new setup flow does not call the old environment-copy speech helper or require
an existing common-resource bundle. Dependencies are fetched and checked locally.

## Validation status

### Version 0.11 update workflow

The update entry points are `update.ps1` and `update.sh`. They check existing
installation ownership, target, release ordering and data compatibility before
provisioning. Tests exercise upgrades from 0.1.0, an unchanged offline rerun,
custom locations, version mismatches, legacy-install refusal, and failed/pending
verification with restoration of both installation records. Native wrapper tests
check argument forwarding and exit codes, including paths with spaces and Unicode.
The setup suite passes on Windows and Ubuntu/WSL (platform-specific skips apply).
The actual Windows and Linux update wrappers also completed offline preflight
against isolated 0.1.0 fixtures, reporting 0.11 as the target without changing
those fixtures or activating an application.
See [updating](setup/updating.md) for end-user and coding-agent instructions.

These setup transaction tests use isolated fixture applications. They do not claim
that the full 0.11 application has passed native installed acceptance. Mac native
acceptance remains outstanding. The earlier full-application results below were
recorded on 16 September for 0.1.0 and must not be read as 0.11 release validation.

### Earlier 0.1.0 native installation evidence

The repository installer was exercised on Windows x64 with a fresh external state
directory: private Node/Python, all three hashed Python environments, models and
publishing tools were downloaded from the committed records. Both the assembled
and installed copies passed desktop launch, final-edit persistence, backend
shutdown, publishing, real CPU synthesis/recognition and audio export. Tests run
against isolated user data. This is a fresh installer-state test on the development
host, not a claim that a separate clean Windows machine was tested.

The source suite passed 43 frontend tests and 226 backend tests. Twenty-three setup boundary
tests also run on Windows and Ubuntu under WSL, covering hash verification,
archives, retries, locks, Linux launcher activation/rollback and data-preserving
uninstall. The dependency audit checks native wheel availability and dependency
closure; it does not substitute for executing those wheels on their target OS.

A repeated Windows installation with `--offline` passed and reported `reused: true`.
Hashes of all 325 repository files were identical before and after that run. The
Windows standalone uninstaller was also exercised without using the source checkout.
Failure-report tests cover stale results and an unwritable report destination.

Ubuntu 24.04.5 under WSL/WSLg also completed a cold-cache native Linux installation,
including its bundled Python/Node, three dependency environments, models and native
tools. Both staged and installed apps passed the graphical, font, publishing,
speech/recognition and audio checks. Its report records `sourceUnchanged: true` and
`offlineRuntime: true`; the launcher and hicolor icons were inspected. This is
Linux/WSLg evidence, not validation of the separate Kali VM or every Linux desktop.
Missing graphical verification produces a pending result rather than success.
Linux offline verification and the installed standalone uninstaller also passed.

macOS installation, Intel Torch compilation and Apple Silicon MPS performance
remain unverified. macOS local signing uses an ad-hoc identity; no Apple Developer
membership or notarisation is part of the design. Intel Mac speech remains
experimental until native acceptance checks pass.

Source CI spans Windows, Ubuntu and macOS. Supported combinations must be declared
from native installation evidence, separately from source-test results.

## Retired workflow

VM transfer-kit generators, their verifier and VM build instructions have been
removed. The same repository-driven local workflow must serve all supported
platforms. Generated artifacts from the retired process are ignored and unused.

Automatic approval review blocked removal of the old generated
`release/build-kits/Alder-0.11.0-linux-build/`,
`release/build-kits/Alder-0.11.0-mac-build/`, `work/dist-downloads/`, and
`work/desktop-builder-config.json` on the development host, stating only
"blocked by policy". They are not required by repository setup. No VM disks were
modified as part of this cleanup.

## System voice provider work (20 September 2026)

The shared speech pipeline now includes macOS AVSpeechSynthesizer and Linux eSpeak NG adapters alongside SAPI. Windows native synthesis/export and Ubuntu/WSL eSpeak synthesis, word timings, multilingual exports and cancellation were exercised. Mac dependencies were hash checked, but native Mac validation is pending because no Mac was available. These feature checks do not establish fresh installed acceptance for 0.11. See [system voices](system-voices.md) for details and limits.
