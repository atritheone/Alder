# macOS setup

Run `bash setup.sh doctor`, then `bash setup.sh install` in Terminal as your normal
user on macOS 14 or newer. The native Apple Silicon adapter uses pinned native wheels. Install Apple's
Command Line Tools with `xcode-select --install` when doctor requests them.

State is in `~/Library/Application Support/AlderSetup`. Managed application versions
are in `~/Library/Application Support/AlderInstall`; `~/Applications/Alder.app`
points to the active app. The app includes the committed multi-resolution Alder
ICNS icon and native document/menu integration. An existing unowned Alder.app
launcher is preserved and reported as a conflict.

The application is signed locally with an ad-hoc identity, without Developer ID,
notarisation or Apple Developer membership. If macOS requests approval, use its
normal per-application approval flow. Never disable Gatekeeper globally.

Intel Mac provisioning is experimental and requires `--allow-experimental`. It
compiles the pinned Torch/torchaudio source and may take hours and at least 80 GiB
of working space. Other native dependencies must also pass their checks. This
route is not a promise of a verified Intel Mac installation. A virtual Mac may
have no usable Metal GPU; setup validates CPU inference independently.

See the [platform validation status](../cross-platform.md) for what has been tested.

The core Python locks now include the PyObjC bridge for optional Apple system voices. Voice discovery runs at Alder startup. Native Mac speech and installed acceptance remain pending; dependency availability alone is not a tested Mac installation. See [system voices](../system-voices.md).
