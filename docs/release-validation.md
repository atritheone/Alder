# Developer release qualification and end-user downloads

The development repository contains regression tests and qualification tools.
End users receive `Alder-0.13-source.zip`, built by
`scripts/developer/prepare-download.py`; do not distribute the development checkout
as the recommended installation package. GitHub's automatic source archives are
developer checkouts, not the named end-user asset.

## Developer procedure

1. Run the setup/update unit suite on Windows and Linux, and on Mac when available.
2. Run `python -B scripts/developer/validate-release.py --state-dir <external-state>`
   on each target being qualified. The orchestrator provisions pinned resources,
   builds in external state, runs frontend/backend regressions and exercises the
   staged application: save/quit, fonts, publishing, real speech/recognition, local
   rules/model, document migration and sentence revisions. It does not install,
   activate a launcher, open user projects or change the user's data.
3. Require `release-validation.json` to report passed; retain the target, source
   fingerprint and logs. A pending graphical check is not qualification. Report
   untested platforms and editorial/model limits separately.
4. Run `prepare-download.py --output <external-output> --node <pinned-node>
   --npm-cli <pinned-npm-cli>` with the setup-provisioned Node/npm. It copies an
   explicit source/runtime/tooling allowlist, excludes tests and developer files,
   removes test-only dependencies and prunes their lock graph offline. Existing
   dependency versions/integrities must remain unchanged. It writes a file-hash
   manifest and ZIP checksum.
5. Run `python -B scripts/developer/verify-download.py <archive.zip>` to check the
   ZIP and per-file hashes, excluded developer paths, dependency pruning and all
   target metadata. Then install from an extracted copy and exercise an update.
   Publish the exact tested archive and checksum as named release assets.

## Installation contract

Normal `install`, `update`, `repair` and `verify` never invoke developer regression
suites, edit/export exercises, speech tests or model-quality benchmarks. They
retain checksum/inventory validation, prerequisite checks and a brief isolated
desktop launch that confirms the UI starts and desktop/backend versions match.
These checks diagnose installation damage; they are not delegated development
qualification. A failed update restores the previous activation; user data is
never test input. Existing backup and data-compatibility safeguards still apply.

The source download contains build tools because users compile on their own OS.
It contains runtime resources or their pinned download records, platform icons,
licences, source needed by the app and setup, and agent installation instructions.
It contains no Alder test suite, benchmark data, development reports or Git history.
The app installed from it runs independently of the extracted source folder.
