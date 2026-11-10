# Platform support and local installation

Alder has native repository setup entry points for Windows, Linux and macOS. See
[SETUP.md](../SETUP.md). Installation must not edit the checkout or repair missing
repository metadata. A private external workspace holds downloads and builds.

## Reusable implementation

- `backend/alder/runtime-layout.json` defines native runtime paths shared by
  Electron and Python. Resource architecture must match the host.
- Platform helpers cover application data directories, process lifecycle,
  macOS menu roles and file opening, shortcut labels and CPU/CUDA/MPS selection.
- Fontconfig/CoreText discovery supplements directory scans. New documents request
  Cambria, with bundled Liberation Serif as a fallback; missing authored fonts are labelled and rendered
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

### Version 0.13 release checks (11 November 2026)

The package, backend and application UI identify this release as 0.13. The
desktop bridge and About display derive their versions from package metadata.
The agent runbook covers fresh installs and updates from both compatibility levels
present in 0.12, including the explicit forward migration from 1 to 2 and the
restriction on rollback after new-format saves.

The 61-test setup suite passed on Windows and Ubuntu/WSL (three platform/tool
skips on each). Native Windows and Linux update entry points passed 0.12-to-0.13
preflight against isolated installations without changing them. All four target
policies have fixture coverage. The copied build workspace includes current
document metadata, citations, equation fonts and notices. Missing or inconsistent
backend release metadata fails preflight.

Developer release qualification exercises fresh document creation, legacy snapshot
migration, original history/text preservation and save/reopen through the packaged
backend. On model-enabled targets it also runs the sentence-revision probes for
AU/GB/US English, unchanged text and citation preservation. This uses synthetic
data and does not certify editorial quality.

On Windows x64, 694 frontend tests and 2,343 backend tests passed. The packaged
application passed save/quit and backend shutdown, fonts, publishing, CPU speech
synthesis and recognition, audio export, native system voices, proofreading and
the document/sentence-revision probes above. These used isolated data on the
development host. A subsequently discovered small KaTeX font blocked by the
content policy was fixed by emitting local assets; the strengthened font check
passed against the application installed from the minimal download. The backend
was unchanged by that asset fix; its suite was not rerun for the asset-only change.

End users receive a separate minimal source download with no Alder tests,
fixtures, developer tooling or test-only dependencies. Normal installation checks
integrity, matching versions and desktop launch only. Full suites run through the
[developer release procedure](release-validation.md), never as an end-user step.
The minimal download passed its ZIP/file hashes, dependency exclusions and all
four target metadata checks. A Windows install from that download passed integrity,
version and launch verification. The final archive's Linux update preflight also
passed against an unchanged isolated 0.12 installation.

Linux/WSL preflight and fixture coverage are not full installed 0.13 Linux desktop
acceptance. Mac native acceptance remains outstanding; Intel Mac remains
experimental and rules-only. Existing unresolved provenance for the legacy Sitka
assets is documented in [the provenance record](sitka-provenance.md), which is now
included with the installed notices. No new provenance claim is made by packaging it.

### Version 0.12 update workflow

The update entry points are `update.ps1` and `update.sh`. They check existing
installation ownership, target, release ordering and data compatibility before
provisioning. Tests exercise preflight upgrades from 0.11 and transactions from
0.1.0, an unchanged offline rerun,
custom locations, version mismatches, legacy-install refusal, and failed/pending
verification with restoration of both installation records. Native wrapper tests
check argument forwarding and exit codes, including paths with spaces and Unicode.
On 20 September 2026, the 56-test setup suite passed on Windows and Ubuntu/WSL
(three platform/tool-specific skips on each). Tests cover required proofreading
bindings/locks, all four target provisioning policies, Windows SDK completeness,
compiler-output retry handling and exclusion of Windows binaries on Unix.
The actual Windows and Linux update wrappers also completed offline preflight
against isolated 0.11 fixtures, reporting 0.12 and the correct feature policy
without changing those fixtures or activating an application. The Windows C++
module was compiled in external state with private Python, node-gyp 12.4.0,
Electron 44.3.0 headers and Windows SDK 10.0.26100.0, then loaded in Electron.
The actual electron-builder configuration validators passed for all three OS
configurations, including metadata and icons.
See [updating](setup/updating.md) for the coding-agent procedure and
[proofreading](offline-proofreading.md) for separate rules/model execution evidence.

These setup transaction tests use isolated fixture applications. They do not claim
that the full 0.12 application has passed native installed acceptance. Mac native
acceptance remains outstanding. The earlier full-application results below were
recorded on 16 September for 0.1.0 and must not be read as 0.12 release validation.

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

The shared speech pipeline now includes macOS AVSpeechSynthesizer and Linux eSpeak NG adapters alongside SAPI. Windows native synthesis/export and Ubuntu/WSL eSpeak synthesis, word timings, multilingual exports and cancellation were exercised. Mac dependencies were hash checked, but native Mac validation is pending because no Mac was available. These feature checks do not establish fresh installed acceptance for 0.12. See [system voices](system-voices.md) for details and limits.
