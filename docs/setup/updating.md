# Agent runbook: update Alder to 0.12

**Audience: the coding agent performing the update.** The user's request is simply
"Update Alder." Carry out the procedure; do not give the user a list of terminal
commands or ask them to edit the repository. Refer to this release as **0.12**. The package metadata retains the required
three-part version internally. It contains all required metadata, icons, checksums and
dependency locks. A missing or inconsistent item is a repository defect, not
permission to invent it.

## 1. Establish the source and installation

Read `AGENTS.md` and `SETUP.md`. Use the obtained 0.12 repository or archive as
read-only source. Do not reset, patch, or change dependency pins in the checkout.
If the available checkout is not the requested release, obtain the correct
published repository revision in a separate folder; preserve any existing local
edits. Do not assume a tag name or fabricate a release reference.

Use the user's normal desktop account on the native OS. Run the applicable entry
point from this checkout, without Administrator/root elevation:

```powershell
.\update.ps1 --check --expect-version 0.12 --json
```

```sh
bash ./update.sh --check --expect-version 0.12 --json
```

`update.ps1` and `update.sh` forward to `setup update`. The check reports
`installedVersion`, `repositoryVersion`, `installation`, `launcher`,
`stateDirectory`, `userDataDirectory`, and the source fingerprint. It validates
ownership, target architecture, version order and data compatibility. It does
not build or activate anything or run feature checks. It may provision the pinned
private Python bootstrap if absent; no global Node/Python is needed.

### 0.12 resources and prerequisites

Inspect `features` in the preflight report before provisioning. The release adds
local spelling/grammar checks and a Windows C++ menu module:

| Native target | Spelling and grammar | Advanced review | Windows C++ module |
| --- | --- | --- | --- |
| Windows x64 | LanguageTool 6.6; AU/GB/US English | Pinned CPU model/runtime, experimental | Required; built locally |
| Linux x64 | Same local rules | Pinned CPU model/runtime, experimental | Excluded; no Visual Studio requirement |
| Apple Silicon Mac | Same local rules | Pinned CPU model/runtime, experimental; native acceptance pending | Excluded |
| Intel Mac | Same local rules | Unavailable; no pinned inference runtime | Excluded; overall installation remains experimental |

The rules use Alder's private Java runtime. The advanced engine uses its own
private Python and native wheel lock, independent of narration. Do not install a
global Java/Python, compile an unpinned inference library, or accept missing packs
as a successful update. Missing required target metadata is a repository defect.
An Intel Mac receives the explicit rules-only configuration; do not promise
advanced review there or describe it as verified platform support.

On Windows, preflight checks Visual Studio Build Tools 2022 or newer, MSBuild,
the x64 C++ compiler, and a complete Windows 10/11 SDK. `windowsBuildTools` records
the detected compiler and SDK. If absent, follow [Windows prerequisites](windows.md)
and retry the check as the normal desktop user. The module is built against the
pinned Electron headers with Alder's private Python; headers and intermediate
files stay in external setup state. The installed application carries the compiled
module and does not need a compiler to run. Never install this Windows prerequisite
on Linux or Mac; their existing native OS prerequisites still apply.

Allow about 240 MiB for the rules archive and 2.55 GiB for the model download,
plus runtime dependencies, extraction, cache and application copies. An existing
0.11 cache may not contain these new resources. Budget Windows Build Tools/SDK
space separately from Alder's working-space check. Do not use `--offline` for a
first 0.12 build: it requires an already assembled app for this exact revision
and the corresponding verified caches. Reuse the existing state directory online
to retain compatible downloads.

Interpret the check:

| Result | Agent action |
| --- | --- |
| `update-available` | Continue with backup and update. |
| `rebuild-available` | Same release number, different source; continue using the obtained revision. |
| `current` | Matching source; run update to verify the existing payload without rebuilding. Do not claim verified success from preflight alone. |
| `ALDER_AMBIGUOUS` | Inspect the listed candidates and the user's active launcher; select the intended root with `--install-dir`. Ask only if available evidence cannot distinguish them. |
| `ALDER_UPDATE` | Locate the managed root, or follow the legacy transition below. Do not silently run install into another folder. |
| `ALDER_VERSION` / `ALDER_DOWNGRADE` | Obtain the correct repository; never edit version metadata or force a downgrade. |
| `ALDER_MIGRATION` | Stop without changing the old app/data. This release does not supply the required migration. |

The updater discovers the default managed location, the known per-user launcher,
and `installation.json` / `report.json` in the selected setup state. It does not
scan the user's whole filesystem or execute launcher text during discovery.
Multiple installations require an explicit selection.

Preserve custom paths. `--install-dir` identifies the root containing `active.json`
and `.alder-owned.json`, not an executable or a folder inside `versions`.
Reuse the previous `--state-dir` to retain verified download/runtime caches. Read
existing setup reports or launcher/uninstall records to establish these locations;
do not ask the user to invent them. If no previous cache survives, a new dedicated
external state directory is acceptable; explain the resulting downloads and disk
requirements. It must still target the same managed installation.

Examples with placeholder locations (substitute discovered absolute paths):

```powershell
.\update.ps1 --check --expect-version 0.12 --state-dir "D:\AlderSetup" --install-dir "D:\Apps\AlderLocal" --json
```

```sh
bash ./update.sh --check --expect-version 0.12 --state-dir "/disk/AlderSetup" --install-dir "/disk/AlderInstall" --json
```

## 2. Preserve the user's work

Close Alder through its normal save-and-quit path. Do not kill its processes or
copy an actively changing database. The updater refuses an open managed app.
If the available tools cannot close it normally, ask the user only to close Alder,
then continue. Do not start concurrent old/new copies against the same data.

Determine the actual data directory from the existing launcher/environment. The
check's `userDataDirectory` is a hint based on the current environment; a custom
launcher may set a different `ALDER_DATA_DIR`.

| Platform | Default Alder data |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Alder` |
| Linux | `$XDG_DATA_HOME/Alder`, normally `~/.local/share/Alder` |
| Mac | `~/Library/Application Support/Alder` |

Create a timestamped backup of the closed application's data outside the checkout,
application payload, and caches. Preserve all files, including SQLite sidecars,
project history, settings, images, and reference voices. Verify the copy against
the source with file counts and hashes and retain a small backup manifest. Do not
print project contents or upload the backup. Check links and destination bounds
before copying; do not silently follow links into unrelated folders. Preserve
portable `.alder` archives and exported files at their existing locations; if they
need separate backups, copy them without moving or replacing them.

This backup is the agent's responsibility: **the update executable does not make a
user-data backup**. If there is no existing data directory, record that fact rather
than creating an empty one or guessing another path. Preserve any custom
`ALDER_DATA_DIR` setting for the updated launcher.

## 3. Apply the update

Run the same entry point and path/version options, removing only `--check`:

```powershell
.\update.ps1 --expect-version 0.12 --json
```

```sh
bash ./update.sh --expect-version 0.12 --json
```

If Windows blocks the local script, a process-scoped invocation is available:
`powershell -NoProfile -ExecutionPolicy Bypass -File .\update.ps1` plus the same
arguments. Do not change machine execution policy. Resolve diagnosed OS
prerequisites using scoped OS elevation only; never disable Electron's sandbox,
Gatekeeper, certificate checks, or artifact hash verification.

Progress includes resource reuse/provisioning, source build, staged verification,
activation, and installed verification. The tests cover saving, fonts, publishing,
narration and recognition using isolated test data. Keep the checkout stable until
the command ends. Do not run a second updater against the same installation.

Staged and installed checks also execute local spelling/grammar probes for all
three dialects and real CPU model inference on targets with advanced review.
Intel Mac explicitly runs rules-only probes. Windows checks require the compiled
native module outside ASAR and launch the actual desktop application; Unix
payloads reject a misplaced Windows module. Check results are in the state's
`logs/staged` and `logs/installed` directories, including `proofreading.json` and
`capabilities.json`. Feature policy in preflight is not execution evidence.

Setup checks for 45 GiB free working space (80 GiB for experimental Intel Mac
builds) and checks the installation disk before copying the new version. Budget
separately for the user-data backup and retained application. Reuse verified
caches; do not delete the previous version or unrelated data to bypass a space
error. No `.deb`, DMG, or compressed installer needs to be produced.

## 4. Verify and hand back

| Result | Agent action |
| --- | --- |
| Exit 0, `status: passed` | Installed checks passed. Record `previousVersion`, `version`, `launcher`, and report location. `reused: true` means the intact app was verified without rebuilding. |
| Exit 2, `status: pending` | Do not claim completion. Existing-app updates retain/restore the old active version. Rerun **update** from a graphical session to finish. |
| Nonzero, `status: failed` | Read the current error and named stage log, resolve the diagnosed condition, and retry the same command. A failed installed check restores both old version records and the old launcher. |

A passed update already includes installed verification. Do not immediately repeat
the expensive checks without a new reason. To check later, use `setup.ps1 verify`
or `bash setup.sh verify` from the matching repository and pass the same locations.
Reports and logs stay in the external state folder; do not upload them automatically.

Confirm the selected launcher points to the reported version. Where available,
open the app normally and confirm the user's projects appear, without editing
them. Use **Alder (local)** on Windows, **Alder** in the Linux application menu, or
`~/Applications/Alder.app` on Mac. Report any user-visible confirmation that could
not be performed separately from the automated checks.

Use release labels such as **0.12** in user-facing messages. Preflight exposes
`installedRelease` and `repositoryRelease` for this purpose; `installedVersion`,
`repositoryVersion` and completion `version` retain machine-readable package versions.
Give the user a short outcome: old → new release, launcher, backup location, and
remaining limitations. Do not hand off routine commands for the user to execute.

Include advanced review's experimental quality status, Intel Mac's rules-only
restriction where applicable, and any missing native acceptance evidence. Do not
describe a model smoke test as comprehensive proofreading quality validation.

## Retry and rollback

Retry the same update after an interruption; components are content checked before
reuse. `--offline` requires a previously assembled app for this exact source
fingerprint plus its caches/workspace; it cannot fetch a new release.

For recovery, close Alder normally and run `setup.ps1 rollback` or
`bash setup.sh rollback` with the same explicit installation/state paths. This
verifies the previous files and declared data compatibility. It switches the app;
it does not overwrite user data or undo subsequent project edits. Do not restore
a data backup over newer work without an explicit recovery decision from the user.

## Older installer or portable copies

Older Windows installers, `.deb`/DMG packages or copied application folders may lack
the managed installer's records. Do not fabricate ownership markers or point the
updater at those folders. Complete this transition instead:

1. Identify the old executable, launcher and data path. Close normally and create
   the verified backup described above.
2. Use `setup.ps1 install` or `bash setup.sh install` to create a managed app in its
   own directory, following [SETUP.md](../../SETUP.md). Retain the old payload and
   its removal mechanism. This transition is a separate installation, not an
   in-place overwrite of the legacy directory.
3. Resolve only the exact conflicting launchers. For example, preserve an old
   `~/Applications/Alder.app` in a clearly named backup location before creating
   the new managed Mac launcher. Verify resolved paths and record any moves;
   never broadly delete directories or customised integrations.
4. Require installed verification to pass, then open the new launcher with the
   original data location and confirm projects/reference voices remain available.
   Prefer Alder's `.alder` import for portable project recovery; never hand-edit
   SQLite contents to make a migration appear successful.
5. Leave the old copy available and tell the user which launcher now runs 0.12.
   Removing the old copy is optional follow-up work; do not uninstall it as part
   of this update unless separately requested. Subsequent updates use update.ps1
   or update.sh against the managed root.

See [diagnostics](troubleshooting.md) for error codes and [platform status](../cross-platform.md)
for test evidence. Mac native acceptance remains outstanding; Intel Mac is
experimental and requires explicit `--allow-experimental`. Do not mistake source
or fixture tests for successful native installation on the user's machine.
