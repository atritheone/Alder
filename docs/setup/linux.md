# Linux setup

The native adapter targets glibc 2.35+ x64 Linux (not musl/Alpine). Ubuntu 24.04 and Kali rolling are the initial
validation distributions; other distributions need equivalent libraries and native
acceptance. Run setup from a normal graphical desktop account, never root.

For an existing installation, follow the [agent update runbook](updating.md) with
`bash update.sh --check --expect-version 0.12 --json`. The update provisions local
spelling/grammar rules and the experimental advanced-review CPU model using pinned
Linux wheels. It reuses Alder's private Java/Python; no Windows C++ module or Visual
Studio tools are used. Installed checks must exercise the rules and model.

The bootstrap needs bash, curl, tar, a SHA-256 utility and a writable local state
directory. Debian-family prerequisite examples (only this command uses sudo):

```sh
sudo apt-get update
sudo apt-get install -y curl ca-certificates tar build-essential git pkg-config \
  libasound2t64 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 \
  libgtk-3-0 libnss3 libxss1 libxkbcommon0 libxrandr2 libxcb-cursor0 \
  libegl1 libopengl0
```

APT may select `t64` replacements. FUSE is not required. Doctor identifies missing
libraries; use your distribution's actual package names rather than changing the
repository. Then run `bash setup.sh doctor` and `bash setup.sh install`.

State defaults to `$XDG_STATE_HOME/alder-setup` or `~/.local/state/alder-setup`.
Installed versions live under `$XDG_DATA_HOME/alder/app` or
`~/.local/share/alder/app`. A desktop entry, PNG icons in the standard hicolor
sizes, a per-user MIME definition and `~/.local/bin/alder` are installed. Setup
does not change the default application for existing file associations.

Keep generated state on a native local filesystem. The source itself may be
read-only or shared; the installer creates its own local build workspace.
Use `--state-dir /absolute/path` if another disk has more space. Disk and filesystem
sizes differ: increasing a VM's VDI alone does not expand its Linux filesystem.
The installer diagnoses capacity but never changes partitions.

Electron requires a working sandbox and desktop session. Setup will not add
`--no-sandbox`, change system security settings or run Electron as root. Headless
assembly can leave verification pending. For an existing-app update, rerun
`bash update.sh` with the same options from the graphical desktop; the old version
stays active until verification passes. For a first installation, use
`bash setup.sh verify` from that desktop.

Optional system voices use the distribution-provided eSpeak NG library and data (Ubuntu: libespeak-ng1 and espeak-ng-data). Chatterbox does not require them. Restart Alder after installing voice packages. Doctor reports whether the optional library is found; installed checks report unavailable rather than passed when no voices exist. See [system voices](../system-voices.md).
