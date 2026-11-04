# Third-party source and assets

This file records where the repository keeps third-party attribution and
provenance. Alder's own licence is in [LICENCE.md](LICENCE.md); third-party
components retain their respective terms.

- Vendored Chatterbox source: [licence](chatterbox/LICENSE) and
  [upstream documentation](chatterbox/README.md).
- Citation styles, locales and citeproc attribution:
  [citation resource documentation](frontend/src/citationAssets/README.md).
- STIX Two Math: [font licence](frontend/src/equationAssets/OFL.txt) and
  [pinned provenance](frontend/src/equationAssets/provenance.json).
- Legacy Sitka assets: [provenance record](docs/sitka-provenance.md), including
  the outstanding source and licence evidence.
- Downloaded runtime components: `resources/manifests/`, `resources/locks/`
  and resource preparation scripts record their inputs. Generated dependency
  notices remain in the resource/build output, outside source control.

`scripts/prepare-javascript-notices.mjs` collects JavaScript dependency notices
for packaged applications. This index does not replace those full notices.
