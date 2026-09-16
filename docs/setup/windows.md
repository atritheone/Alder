# Windows setup

Use Windows x64 and a normal non-administrator PowerShell terminal. Windows' tar
utility and HTTPS access are the bootstrap prerequisites. Setup downloads private
Python/Node; no global SDK or Python installation is needed for the pinned wheels.

Run `./setup.ps1 doctor`, then `./setup.ps1 install` from the repository. The source
is copied into private state without edits. Default state is
`%LOCALAPPDATA%/AlderSetup`; the application is in
`%LOCALAPPDATA%/Programs/AlderLocal`. The Start menu entry is **Alder (local)** and
Windows Settings receives a per-user uninstall entry. Existing Alder installations
and project data are not overwritten.

Use `--state-dir` and `--install-dir` with absolute paths for another disk. Existing
unowned folders are rejected. If setup reports a missing Visual C++ runtime, install
the official Microsoft runtime and retry; do not replace package pins. Filename
and directory permissions must permit native executables.

No compressed offline installer is built by this flow. The installed application
includes everything it needs and can run without the source checkout.
