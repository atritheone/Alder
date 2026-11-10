# Offline proofreading

Alder combines local LanguageTool spelling/grammar rules with local Qwen sentence revisions. The sentence editor can reconstruct an entire sentence, reorder clauses, remove redundant wording and propose several sentences in place of one. It is separate from the conservative small-edit proofreading action. Australian, British and US English are separate settings. Model suggestions require review; Grammarly parity has **not** been established.

## Sentence revisions

With the local model pack available, **Suggest sentence structure and clarity improvements** reviews writing after a pause. Spelling/rule checks run independently. Recent edits are reviewed first. Existing revisions can remain visible in unchanged, uniquely identifiable paragraphs; changing their context or language invalidates them. Superseded inference finishes its current bounded passage and caches the result rather than repeatedly unloading the model. Narration and shutdown can still interrupt it immediately.

Choose **Improve sentence or selection**, or press **F7** with the writing editor focused, to request a revision explicitly. This works even with automatic sentence suggestions disabled. A selection may contain multiple sentences; each paragraph remains a separate editing boundary. **Another version** requests an alternative construction. **Creative writing and dialogue** asks the model to retain intentional fragments, repetition, rhythm and character dialect.

Each suggestion shows the complete replacement. **Show changes** compares wording, **Compare original** shows the source, and **Edit revision** lets the author adjust a proposal before acceptance. **Accept rewrite** applies the revision in one undo step. The report stays open without blocking writing. **Review sentence structure across book** combines rule findings with sentence revisions chapter by chapter.

Uniform character formatting survives a revision. Unambiguously matched formatted phrases and hyperlinks can move with their wording. Inline citations and fields are retained as actual document objects, with their displayed wording protected during generation. A revision that changes or ambiguously locates a field or specially formatted phrase is refused rather than silently discarding document structure. The author can adjust the proposal or edit the manuscript manually. Generated bibliography/contents text remains excluded.

Sentence revisions use paragraph context and a separate validation policy; the previous 30% change limit does not apply. Ordered numeric values, accepted vocabulary, protected field wording and conservative name/modality checks are guardrails, not proof that meaning survived. Some valid proposals are deliberately suppressed. The model remains English-only and does not revise sentences spanning incompatible language tags.

### Development evidence, 10 November 2026

The real Windows desktop workflow passed automatic local generation, complete preview, non-modal writing, another-version generation, word comparison, acceptance and single-step undo. Focused editor tests cover moved emphasis, uniform formatting, hyperlinks, citations and stale-source rejection. A broader development regression run passed 2,341 backend tests; a fresh source-launcher build subsequently passed 691 frontend tests. Focused tests are extended as the feature evolves.

Both the existing 4B model and an isolated, checksum-verified Qwen3.5-9B Q4_K_M candidate completed the same 40 authored development cases (24 difficult, 16 clean). Under the subsequently rescored guardrails, both supplied displayable revisions on 21 difficult cases; the 4B model changed one clean case and 9B left all 16 unchanged. Twenty-eight paired outputs were identical. The user reviewed the blinded proposals and judged them good. This is user review of a small development set, not an independent held-out quality evaluation.

Observed median times were approximately 3.74 seconds for 4B and 5.66 seconds for 9B; maxima were 7.39 and 14.36 seconds. Tests and other work overlapped these runs, so these are not controlled hardware measurements. The 9B candidate did not establish a sufficient benefit to replace the smaller default. Its weights and runtime testing state remain outside the checkout; no shipped dependency or model pins were changed.

Grammarly's public free sentence rewriter, with its default tone, returned the same rewrite as the local 4B model for the reference meeting-cancellation sentence. This single comparison is not evidence of equivalence to paid Grammarly in Word. Native Word comparison was blocked by desktop capture/activation failures. Native Mac, reference 16–32 GiB hardware, GPU and broad independent editorial qualification remain separate release gates.

The user confirmed Windows as the delivery target on 11 November 2026; Mac remains explicitly unverified. Native Linux CPU sentence-revision probes also passed under Ubuntu WSL with external networking blocked (only the loopback interface existed). These exercised all three English dialect requests, an unchanged reference sentence and citation preservation, without claiming an installed Linux desktop qualification. The current Windows source launcher was rebuilt with the required native menu module and the existing verified proofreading pack. No active managed Windows installation was found, so no legacy copy was overwritten or fresh managed installation created.

`scripts/benchmark-sentence-revisions.py` records full proposals and implementation hashes. `scripts/prepare-sentence-review.py` creates offline blinded review packets with local rating export. `scripts/verify-sentence-revisions.py` performs real model, dialect, unchanged-text and citation-preservation smoke checks. All generated reports, review packets, candidate weights and test data directories belong outside the checkout.

Assigned paragraph languages and inherited style languages choose the local rules for each passage in Write, Sandbox and whole-book review. English conventions remain the default for unmarked English text; an explicit `en-US`, `en-GB` or other supported paragraph tag overrides that default. The installed LanguageTool instance supplies its supported-language list. Unknown languages are reported as unchecked, never submitted to English spelling rules. The advanced model checks English only. Generated wording is excluded from ordinary corrections; sentence revisions can retain inline fields unchanged. Text offsets remain tied to the original UTF-16 source, including selected passages and emoji; changing language or style metadata invalidates stale results even when wording is unchanged.

`check-proofreading-languages.py` qualifies the installed Windows rules for British/US distinctions, French and German spelling, unsupported Hebrew coverage and exact correction offsets. `test-proofreading-languages-desktop.mjs` covers inherited/direct languages, language-only invalidation, undo, save/reopen and a French correction that leaves neighbouring English text unchanged. This is routing and interaction evidence, not an independent quality evaluation for every language in the pack. Other-platform and broader multilingual quality gates remain open.

## Using the checks

Click **Spelling & grammar** in the bottom status bar, open **Checks** in the Sandbox word panel, or click an underline in either editor. The status bar shows checking progress, the number of suggestions, or an incomplete/basic-only state. Choose the English conventions for the project. Fast spelling and grammar checks run after typing pauses. Optional style advice is disabled by default.

If the full pack is missing, Alder retains its basic spelling and punctuation checks and explicitly reports that full grammar and dialect checks were not performed. It does not silently leave the editor without checking.

- Select an alternative to apply it. Linked changes are applied together in one undo step. Empty replacements are supported.
- Use **Check selected text** for the current selection, or **Check spelling and grammar** to return to the current chapter/draft.
- Use **Advanced review** for contextual suggestions. Every proposed model change requires review and acceptance. It does not rewrite the manuscript automatically.
- **Whole book review** scans chapter snapshots sequentially and lists the findings, their chapter context and completion status. Open a chapter to review its current suggestions. Changed chapters are marked for rechecking.
- **Ignore once** hides an occurrence for the current review. **Ignore rule in project** persists an exception. Restore ignored rules under **Vocabulary and ignored rules**.
- Accept names and specialised terms in the project dictionary or personal dictionary. Project vocabulary travels with the `.alder` archive; personal vocabulary stays in the configured Alder data directory and can be exported/imported explicitly.

Changing the text invalidates suggestions immediately. A correction validates its complete source snapshot and each edit before applying. Corrections spanning document structure or mixed formatting are rejected with a manual-edit explanation. Other marks and links remain intact. Previous/next issue controls support keyboard navigation without requiring a click on an underline.

“No issues found” appears only for a completed check with no visible findings. Missing packs, engine failures, unavailable checks and cancellation remain visible. A completed check is not a guarantee that the text has no errors.

The corner review panel shows only the issue at the text cursor. Hover over an underline for a small correction popup, or click **Spelling & grammar** in the status bar for the full report. Multi-chapter documents are scanned chapter by chapter in that report; selecting a finding opens its chapter and selects the affected text. Corrections remain bound to the checked text and can be undone.

## Runtime and resource packs

The Windows source-testing launcher (`start.cmd`) provisions a missing proofreading pack through setup's pinned resource builder into its external `AlderTesting` workspace. It reuses and verifies that pack on subsequent launches; `--offline` requires cached artifacts and prevents provisioning downloads. Resource selection is recorded in `last-build.json`, which the desktop regression test also uses. Managed installations continue to provision the pack through setup/update.

All Alder-owned proofreading service/worker code is Python. The editor integration is TypeScript. The inference dependency uses pinned native wheels, while LanguageTool runs in Alder's existing private Java runtime; proofreading needs no separate Java/Python application or inference compiler. Windows source builds separately require C++ Build Tools and a Windows SDK for the native menu module, as described in the [agent update runbook](setup/updating.md).

The current candidate pack contains:

| Component | Version / role |
| --- | --- |
| LanguageTool | 6.6, local spelling, grammar and punctuation; not its cloud AI service |
| Qwen | Qwen3.5-4B, community Q4_K_M GGUF pinned to revision `e87f176479d0855a907a41277aca2f8ee7a09523` |
| Python binding | `llama-cpp-python` 0.3.35 in an isolated runtime |
| CPU profile | 4,096-token context, at most four inference threads, one model request at a time |

Model weights occupy approximately 2.55 GiB. Allow additional space for the runtime, rules, download cache and staged/previous resources. Managed setup's existing disk preflight remains in force. GPU acceleration is not enabled or qualified in this implementation.

Managed setup provisions `proofreading/` under its external resource directory. SHA-256 manifests and per-platform dependency locks pin downloads. Normal checks never download resources or fall back to a cloud service. The resource preparer supports verified cache reuse with `--offline`; managed setup's existing offline-build constraints still apply. This is not yet a separate end-user pack-import wizard.

Windows x64, Linux x64 and Apple Silicon have pinned native inference wheel records. Intel Mac currently receives the rule pack only and reports the advanced runtime as unavailable. Apple Silicon packaging records exist but have not been tested on a Mac. A platform record is not evidence of a successful installation.

`ALDER_RESOURCES_DIR` selects the containing resource root. Developer overrides `ALDER_PROOFREADING_RESOURCES` and `ALDER_PROOFREADING_PYTHON` can select isolated test packs; managed setup clears these overrides. Personal vocabulary is `proofreading-dictionary.json` under the existing configured data directory, respecting `ALDER_DATA_DIR`.

The rules service uses loopback; the model uses private pipes. Requests and manuscript text are not written to inference logs. Paragraph caches and retained job counts are bounded; findings are kept in memory without a fixed result cap. UTF-8 is explicitly configured for worker pipes on Windows, independently of the system code page.

Fast checks have their own worker pool. Advanced review yields to active narration and unloads its model after idle time. A conservative launch check requires about 6 GiB of available memory; this is an admission estimate, not a reservation or proof of operation on every 16 GiB computer. If narration interrupts active inference, the panel reports that review is incomplete and must be restarted.

Paragraphs and table-cell boundaries are preserved. Long paragraphs split at sentence endings, falling back to word boundaries (or character boundaries for oversized tokens). Every passage is checked; the 2,400-character engine request size is not a document limit. There is no fixed document-length or finding-count cap. The model sees one passage at a time. Cross-paragraph contextual analysis and seamless retention of underlines during typing remain future work.

## Verification and measured limits

Development verification on 20 September 2026 included Windows CPU inference from a pack provisioned by managed setup's resource builder, an Electron review workflow, TypeScript checks, 291 backend tests, 74 frontend tests, and Linux CPU rules/model inference in Ubuntu under WSL. The Linux probe ran in a network namespace with only loopback enabled. It was not a full installed Linux desktop test. See the [development benchmark](verification/proofreading-development.json), [Windows pack probe](verification/proofreading-windows.json), [desktop result](verification/proofreading-desktop.json) and [Linux probe](verification/proofreading-linux.json).

The authored development corpus has only 18 short examples: nine incorrect and nine clean, balanced across the three dialects. It is a development set used while adjusting validation, not an independent held-out quality test. “Acceptable candidate” below means an expected complete correction was found among up to three alternatives for a diagnostic; this does not measure top-1 precision or merged-system quality.

| Engine | Error examples with an expected candidate | Clean examples flagged | Median check time |
| --- | --- | --- | --- |
| Previous Alder checker | 3 / 9 | 2 / 9 | below 1 ms |
| Local rules | 9 / 9 | 0 / 9 | 32 ms |
| Local model after validators | 8 / 9 | 0 / 9 | 2.77 s |

The first rule check took 4.31 seconds; the slowest model check took 6.84 seconds. These timings came from this development machine, which has about 50 GiB RAM, using CPU inference while other tests were also running. They are development observations, not isolated performance measurements or guarantees for 16–32 GiB systems.

The model initially changed quote typography and currency notation in correct text. Validators now suppress these changes. It still changed “The dogs is hungry” to “The dog is hungry”, which loses the intended plurality. The rule engine supplied the expected plural correction. This is a concrete reason to keep model suggestions experimental and separate from automatic correction.

The full plan is not complete. Release qualification still requires independent editorial evaluation, a legitimate frozen Grammarly comparison before claiming parity, broader engine/model comparison or adaptation, real Mac testing, Intel Mac advanced packaging, 16–32 GiB performance and concurrent narration measurements, GPU qualification if advertised, full installed offline/update/rollback tests, and completion of the redistributable pack's source/licence audit. There is no claimed human quality approval or cross-platform installed verification.

## Developer verification entry points

- `scripts/prepare-proofreading-resources.py`: hash-checked data provisioning outside the checkout, staged activation, cache reuse and retained previous rule data.
- `scripts/setup/resources.py`: isolated Python runtime and data-pack provisioning in managed setup.
- `scripts/verify-proofreading.py`: real AU/UK/US rule probes and real CPU model correction; called by managed installed capability verification.
- `scripts/benchmark-proofreading.py`: reproducible authored-fixture smoke comparisons with explicit corpus/model identity.
- `scripts/test-proofreading-desktop.mjs`: real editor replacements, undo, advanced review and Sandbox isolation.
- `scripts/test-proofreading-interactions-desktop.mjs`: caret-only review, hover corrections, whole-book findings and navigation, UI scaling, unified file opening and startup sizing.
- `backend/tests/test_proofreading*.py` and `frontend/src/proofreadingEdits.test.ts`: cancellation, failure visibility, corrupt resources, Unicode/ranges, linked edits, formatting and undo protections.

Missing or corrupt resources should be repaired through the documented managed setup workflow. Do not copy developer environments into an existing installation or change package versions to bypass update checks.
