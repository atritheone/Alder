# Setup diagnostics

`report.json` and stage logs are in the external setup-state directory. JSON reports
include stable error codes. A failed command has a nonzero exit; a pending graphical
verification uses exit 2. No report is uploaded automatically. Review logs before
sharing them; they include local paths and tool diagnostics but no project data is
intentionally collected.

| Code | Recovery |
| --- | --- |
| `ALDER_METADATA` | Repository/release defect. Report the field/asset to its maintainer; do not edit package.json or pass an override |
| `ALDER_ROOT` | Run from a normal desktop account without sudo/administrator elevation |
| `ALDER_PERMISSION`, `ALDER_PATH` | Select a dedicated writable local state/install directory outside the checkout |
| `ALDER_SPACE`, `ALDER_INODES` | Free space on the named filesystem or choose a different state/install disk |
| `ALDER_PREREQUISITE` | Install the specified OS prerequisite, then retry the same command |
| `ALDER_HASH` | Retry online for damaged download cache; use repair for an altered installed payload |
| `ALDER_NETWORK`, `ALDER_DOWNLOAD` | Fix network/proxy/TLS access and retry; never disable certificate or hash checks |
| `ALDER_BUSY` | Let the existing setup finish; shared stage state cannot be modified concurrently |
| `ALDER_WORKSPACE` | Run repair; do not hand-edit generated source |
| `ALDER_SOURCE` | The repository changed during setup; retry with a stable repository version |
| `ALDER_IO` | Resolve the reported file, disk, permission or network issue, then retry; the current failure replaces older reports when the state directory is writable |
| `ALDER_RUNNING` | Close Alder normally, then retry maintenance |
| `ALDER_INTEGRATION` | An existing unowned launcher conflicts; setup preserves it |
| `ALDER_OFFLINE` | Required cached material is missing; complete an online install first |
| `ALDER_EXPERIMENTAL` | Intel Mac needs an explicitly selected experimental native source build |
| `ALDER_MIGRATION` | A release changes user-data compatibility without a supported migration; keep the existing install |
| `ALDER_STAGE`, `ALDER_CAPABILITY`, `ALDER_TIMEOUT` | Read the named stage log and report reproducible failure; do not invent dependency changes |

A successful compilation is not a verified installation. Setup requires actual
publishing tools, speech generation/recognition and desktop lifecycle checks.
Headless machines remain pending until verification runs in a graphical session.
