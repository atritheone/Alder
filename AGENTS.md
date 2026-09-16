# Alder repository instructions

## Installing for an end user

Read SETUP.md. Treat the repository as read-only. Run `setup.ps1 doctor --json` on
Windows or `bash setup.sh doctor --json` on Linux/macOS, then the same entry point
with `install`.

Use the normal desktop account. Never run the entire setup as administrator/root,
disable Electron's sandbox, disable Gatekeeper, reset the checkout, or invent
dependency versions. Diagnose scoped OS prerequisites from the report. Setup
never asks for passwords; let the user's OS handle any prerequisite elevation.

All generated state belongs outside the repository. Resume by rerunning install;
use repair for damaged generated state. Use verify before claiming success. A
pending graphical verification or experimental platform is not a tested install.
Preserve projects, settings, reference voices and authored exports. Do not upload
logs automatically. Give the user the launcher location and remaining limitations.
