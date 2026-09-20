# Windows setup

Use Windows x64 and a normal non-administrator PowerShell terminal. Windows' tar
utility and HTTPS access are the bootstrap prerequisites. Setup downloads private
Python/Node; no global Python installation is needed for the pinned wheels.
Building Alder from source also requires Visual Studio Build Tools (2022 or newer)
with **Desktop development with C++** and a Windows SDK for the native menu module.
Doctor and update preflight check MSBuild, the x64 compiler, SDK headers, UCRT,
x64 libraries and resource compiler before provisioning. Packaged Alder includes
the compiled module; running an installed release does not require build tools.

For an existing installation, follow the [agent update runbook](updating.md)
using `update.ps1 --check --expect-version 0.12 --json` before the update. An
older Alder installation can run without these tools but needs them to build
0.12 from source. If `ALDER_PREREQUISITE` reports missing tools, obtain the official
[Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)
installer or modify the existing installation in Visual Studio Installer. Select
**Desktop development with C++**, its x64 MSVC tools and a Windows 10/11 SDK.
For agent-driven installer invocation, Microsoft's workload ID is
`Microsoft.VisualStudio.Workload.VCTools`; include recommended components so the
SDK is installed. Follow [Microsoft's installer guidance](https://learn.microsoft.com/en-us/visualstudio/install/command-line-parameter-examples?view=vs-2022).
Allow prerequisite elevation through Windows, then rerun Alder preflight under
the normal desktop account. Do not run the whole update elevated.

Setup supplies private Python to pinned node-gyp and caches Electron headers
under the selected state directory. Generated C++ build files do not alter the
source fingerprint or prevent retries. The new spelling/grammar pack is provisioned
separately and verified with actual rules/model probes before update success.

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
