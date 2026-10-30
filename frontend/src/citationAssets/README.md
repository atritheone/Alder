# Offline citation resources

Alder uses unmodified **citeproc-js 2.4.63** (`citeproc` on npm), choosing its
**CPAL-1.0** licence option. The pinned npm integrity is recorded in
`package-lock.json`. Its source, original licence notice and the full CPAL text
are included in the distributed JavaScript notices. Sources displays the
required attribution when the citation interface is opened. No citation data
is sent to a service. The larger Alder application retains its own licence.

The two styles and English locale are unmodified resources from the
[Citation Style Language project](https://citationstyles.org/), distributed under
**CC BY-SA 3.0**. Their original contributor and translator metadata is retained.
The full licence accompanies these files and the packaged application.

| File | Upstream revision | SHA-256 |
| --- | --- | --- |
| apa.csl | citation-style-language/styles `7bf7ec05bc31509d640c9a3ccf8f561f2b3d748b` (v1.0.2) | `41b4f3c9c61b58b7428ab21d653891995db7b4648d2f0a906eabcb8b2742e7ae` |
| ieee.csl | same | `6dee2b87ce90a7ab86f232d78a9216f47adc6193f13b6307b4a83c65594e721a` |
| locales-en-US.xml | citation-style-language/locales `6b70fe79264543aa538f8927fcc98d5b72425a94` (v1.0.2) | `6f2cd3d1d5527ff07a2981f7ec237753e3b6787568d053c08485802cc3d04ac0` |

Evaluation: citeproc-js provides contextual disambiguation, citation sorting,
locators and bibliography generation through `processCitationCluster`, with
an established CSL test corpus. The simplified `makeCitationCluster` API does
not provide those guarantees and is not used. The supported initial styles are
APA 7 author–date and IEEE numeric with English terms. Arbitrary style loading,
note-style citations, CSL-M/legal extensions and other locales are not claimed.
Sources import/export uses CSL-JSON; BibTeX/RIS conversion is not implied.

Upstream: https://github.com/Juris-M/citeproc-js and
https://citeproc-js.readthedocs.io/en/latest/running.html.
