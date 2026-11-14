# Agent setup entry point for Alder 0.14

These instructions are for the coding agent doing the work. The user only needs
to ask to install or update Alder; do not hand routine terminal work back to them.
This repository contains **0.14**. If Alder is already installed, follow the
[agent update runbook](docs/setup/updating.md) first. Check the old and new versions
before updating the existing managed installation:

```powershell
.\update.ps1 --check --expect-version 0.14 --json
.\update.ps1 --expect-version 0.14 --json
```

On Linux or Mac, use `bash ./update.sh` with the same options. Close Alder normally
and create a verified backup of the user's data between the check and update.
Preserve existing custom state/install paths. Updates include installed
verification and preserve a compatible previous version; they never silently
create a fresh install. Older installer/portable copies have a separate transition
in the update guide. The commands below are for a **first installation**.

0.14 accepts older document compatibility 1 and uses compatibility 2. Preserve a
verified pre-update data backup: retaining an older application does not make it
safe to reopen newly saved documents with it. The update report explicitly states
whether automatic rollback is compatible. Fresh installs use compatibility 2.

Use a normal desktop terminal in the checkout. No global Node or Python is
required. First setup downloads verified private runtimes, dependencies, language
data and speech models. Internet access and roughly 45 GiB of free workspace are
required; setup checks the actual disk and install destination before large work.
The repository can be read-only. Nothing is generated or patched in it.

For 0.14, inspect the `features` report: all targets provision the local spelling
and grammar rules; Windows x64, Linux x64 and Apple Silicon also provision the
experimental advanced-review model/runtime. Intel Mac is rules-only. Windows
requires Visual Studio C++ Build Tools and a Windows SDK to compile its native
menu module; Linux and Mac exclude that module. See the
[0.14 update prerequisites](docs/setup/updating.md#014-resources-and-prerequisites)
and [Windows setup](docs/setup/windows.md). No global Java or Python is needed.

Windows x64 (PowerShell):

```powershell
.\setup.ps1 doctor
.\setup.ps1 install
```

Linux x64 or macOS (Terminal):

```sh
bash ./setup.sh doctor
bash ./setup.sh install
```

If PowerShell blocks a local script, use a process-scoped invocation:
`powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1 install`.
Do not change machine execution policy or run setup elevated.

Complete the install and verification, then report the launcher location and any
remaining limitations to the user. Do not edit the repository or supply missing
metadata as a local workaround.

Setup downloads only this machine's native resources, builds in private local
state and installs a complete application directory. No `.deb`, DMG or archive
needs to be built. Normal operation is offline. macOS uses local ad-hoc signing;
no Apple Developer membership is required. Setup provisions CPU Torch on Windows
and Linux, and native Torch on Mac, with a CPU narration baseline. This installation
path does not currently provision a CUDA runtime. Mac acceleration depends on the
native wheel and available hardware. Use at least 8 GiB RAM; 16 GiB is recommended.

Use the same command again after an interruption. Successful components are
content checked and reused. `--state-dir /absolute/local/path` selects a larger
disk; `--install-dir` selects a dedicated application directory. Both must be
outside the source checkout. Use `--json` for agent-readable output.

Commands: `doctor`, `install`, `verify`, `repair`, `update`, `rollback`, `uninstall`,
`clean-cache`. `clean-cache` previews; add `--yes` to apply. `--offline` uses cached
resources and an already verified assembled application for the same revision.
It fails explicitly when required cached material is missing.

See [Windows](docs/setup/windows.md), [Linux](docs/setup/linux.md),
[macOS](docs/setup/macos.md), [maintenance](docs/setup/maintenance.md), and
[troubleshooting](docs/setup/troubleshooting.md). Native validation status is
recorded in [platform support](docs/cross-platform.md); availability of a setup
adapter does not imply that it has passed a clean native acceptance run.

Use the test-free release download for end-user installations. Developer tests,
benchmarks and qualification tooling stay in the development repository. Normal
install/update checks only payload integrity, matching versions and desktop launch;
do not download or run developer test suites for the user.

If the user provided the development checkout, preserve it and obtain the matching
published `Alder-0.14-source.zip` asset separately. Execute this runbook from its
extracted source. GitHub's automatic source archives contain developer files.
Do not substitute an older release when the requested asset is unavailable.
