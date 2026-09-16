# Maintain a local installation

Use `setup.ps1` on Windows or `bash setup.sh` on Unix with the following commands:

| Command | Behavior |
| --- | --- |
| `doctor` | Validate metadata and inspect prerequisites without modifying the checkout |
| `install` | Resume verified components or assemble and install the requested revision |
| `verify` | Check installed hashes, desktop save/export behavior, publishing, speech and recognition |
| `repair` | Rebuild damaged generated workspace/application components from committed inputs |
| `update` | Install the obtained repository revision; never fetch/reset/edit the user's checkout |
| `rollback` | Reactivate a verified previous app with the same declared data compatibility level |
| `uninstall` | Remove manifest-owned application files and unchanged integrations; preserve user data |
| `clean-cache` | Preview downloaded-cache size; `--yes` removes only those caches |

Keep `--state-dir` and `--install-dir` consistent when using custom locations.
Setup operations use an OS lock. Close Alder before activation/maintenance; setup
does not kill the user's app. Re-running an interrupted command revalidates cached
work instead of trusting directory existence alone.

Updates with a changed data-compatibility declaration stop until the maintainer
provides a migration. Setup never assumes an older binary can open a newer database.
Failed installed verification restores the previous launcher when one exists.
The current and previous verified versions permit rollback; older unmodified
payloads are pruned after successful activation. Modified/user-added files are
preserved. Account for the current and new versions when selecting a disk.

The install root carries `management/maintenance.py`, allowing removal without the
original repository. Windows' uninstall registration uses the external setup Python
so it can remove the application's own runtime. Keep the setup bootstrap until
uninstall completes. Unrelated files added inside a version directory are preserved.
User projects/settings/reference voices are never part of cache cleaning/uninstall.

Offline reinstall requires both a verified resource cache and a previously assembled
application for the same source fingerprint. Setup returns `ALDER_OFFLINE` when a
necessary component is absent. It does not silently resolve new versions offline.
