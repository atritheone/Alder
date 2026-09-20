# Alder repository instructions

## Updating an existing installation (usual 0.12 workflow)

Read docs/setup/updating.md. Refer to this release as 0.12; package.json retains its required three-part version;
never edit that version or its lockfile to make an update work. Use update.ps1 on
Windows or bash update.sh on Linux/macOS with `--check --expect-version 0.12
--json` first. Identify the existing managed installation and cache, preserve
custom --install-dir/--state-dir and ALDER_DATA_DIR settings, and resolve multiple
installations explicitly. A missing installation is not permission to create a
new one or overwrite a legacy installer/portable copy; follow the documented
transition for those copies.

For 0.12, inspect the preflight `features` report. All targets require the local
spelling/grammar pack. Windows x64, Linux x64 and Apple Silicon also require the
pinned advanced proofreading runtime/model; Intel Mac explicitly has rules only.
Windows builds require Visual Studio C++ Build Tools and a complete Windows SDK
for the native menu module; resolve that prerequisite only on Windows. Linux and
Mac must not build or install the Windows module. See the update runbook for
downloads, verification and platform limitations.

Perform the update for the user; do not hand them terminal commands. Close Alder
through its normal save-and-quit path and create a verified backup of their local
Alder data outside the repository/application/cache folders. The updater does not
make user-data backups. Ask the user to close Alder only if your tools cannot do
so normally. Run the same update command without --check. It includes
installed verification; require status passed and report previousVersion, version,
launcher and remaining limitations. Exit 2 is pending, not success: rerun update
in a graphical session. Do not run a second full verify after a passed update
unless a subsequent change or error justifies it. Preserve the previous version
for compatible rollback. Preserve this checkout; if the requested release is
missing, obtain its published repository revision separately without discarding
local edits or guessing release references.

## Installing for a new end user

Read SETUP.md. Treat the repository as read-only. Run `setup.ps1 doctor --json` on
Windows or `bash setup.sh doctor --json` on Linux/macOS, then the same entry point
with `install`.

Use the normal desktop account. Never run the entire setup as administrator/root,
disable Electron's sandbox, disable Gatekeeper, reset the checkout, or invent
dependency versions. Diagnose scoped OS prerequisites from the report. Setup
never asks for passwords; let the user's OS handle any prerequisite elevation.

All generated state belongs outside the repository. Resume by rerunning install;
use repair for damaged generated state. Require installed verification before
claiming success; install/update already run it, so avoid a redundant verify. A
pending graphical verification or experimental platform is not a tested install.
Preserve projects, settings, reference voices and authored exports. Do not upload
logs automatically. Give the user the launcher location and remaining limitations.
