# Maintain a local installation

Agent reference: perform these operations for the user and report the outcome.
Do not ask the user to run the commands or supply repository metadata.

For the usual 0.12 upgrade, start with the [update guide](updating.md) and the
dedicated `update.ps1` / `update.sh` scripts. `--check` reports the existing and
target versions before building; `--expect-version 0.12` prevents using the wrong
repository. Preserve your original custom paths and back up your data before updating.

Use `setup.ps1` on Windows or `bash setup.sh` on Unix with the following commands:

| Command | Behavior |
| --- | --- |
| `doctor` | Validate metadata and inspect prerequisites without modifying the checkout |
| `install` | Resume verified components or assemble and install the requested revision |
| `verify` | Check installed hashes, desktop save/export behavior, publishing, speech and recognition |
| `repair` | Rebuild damaged generated workspace/application components from committed inputs |
| `update` | Update an existing managed installation; detect version/compatibility problems before building and refuse an accidental fresh install or downgrade |
| `rollback` | Reactivate a verified previous app with the same declared data compatibility level |
| `uninstall` | Remove manifest-owned application files and unchanged integrations; preserve user data |
| `clean-cache` | Preview downloaded-cache size; `--yes` removes only those caches |

Keep `--state-dir` and `--install-dir` consistent when using custom locations.
Setup operations use an OS lock. Close Alder before activation/maintenance; setup
does not kill the user's app. Re-running an interrupted command revalidates cached
work instead of trusting directory existence alone.

Updates with a changed data-compatibility declaration stop until the maintainer
provides a migration. Setup never assumes an older binary can open a newer database.
Failed installed verification restores the previous launcher and both version
records when one exists. Pending graphical verification keeps/restores the old
active version; rerun update in the desktop session to complete the upgrade.
The current and previous verified versions permit rollback; older unmodified
payloads are pruned after successful activation. Modified/user-added files are
preserved. Account for the current and new versions when selecting a disk.

Successful setup records `installation.json` in its state directory so a later
update can find a custom installation. The per-user launcher is also a location
hint. Multiple candidates require `--install-dir`; a location hint never replaces
the installation's ownership/active records. `--check` is a preflight preview and
does not assert that installed feature checks have passed.

The install root carries `management/maintenance.py`, allowing removal without the
original repository. Windows' uninstall registration uses the external setup Python
so it can remove the application's own runtime. Keep the setup bootstrap until
uninstall completes. Unrelated files added inside a version directory are preserved.
User projects/settings/reference voices are never part of cache cleaning/uninstall.

Offline reinstall requires both a verified resource cache and a previously assembled
application for the same source fingerprint. Setup returns `ALDER_OFFLINE` when a
necessary component is absent. It does not silently resolve new versions offline.
