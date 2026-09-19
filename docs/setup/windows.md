# Windows setup

Use Windows x64 and a normal non-administrator PowerShell terminal. Windows' tar
utility and HTTPS access are the bootstrap prerequisites. Setup downloads private
Python/Node; no global Python installation is needed for the pinned wheels.
Building Alder from source also requires Visual Studio Build Tools (2022 or newer)
with **Desktop development with C++** and a Windows SDK for the native menu module.
Setup doctor checks for the compiler before provisioning. Packaged Alder includes
the compiled module; running an installed release does not require build tools.

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
