# Bounded existing-model grammar repair

Execution started 13 November 2026. Model: the installed, unchanged
Qwen3.5-4B Q4_K_M (`00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4`).

## Scope and decision policy

Implement one post-generation grammar audit and one shared repair budget for
grammar, spelling and accidental plural narrowing. Retain the incumbent default
unless independent final evidence supports changing it. A completed failed or
inconclusive trial closes this bounded investigation; it does not establish
Grammarly parity or complete the earlier abandoned qualification programme.

At most two candidate policies, three engineering days and eight inference hours.
No paid inference, new inference models, memory-admission changes or sealed-test
access. Additional generated storage is capped at 2 GiB. Reuse the installed
model/runtime; never restore the deleted experimental downloads. Only a small
reference-scoring environment (ERRANT 3.0.2, spaCy 3.8.18 and its retained pinned
English reference parser) was restored without pip's download cache. Its measured
environment size is approximately 274 MiB; no Torch/CUDA evaluator is installed.

## Frozen study and current state

The external study is `AlderTesting/existing-model-repair-20261113` in Local
AppData. Its manifest binds the selected corpus, exposure audit and installed
resources. Development contains 120 natural error sentences, 40 clean/creative
controls and 40 meaning-preservation controls, selected deterministically by case
ID hash before candidate inference.

Every one of the retained core corpus's 597 validation cases already has prior
generator output. **Zero unused validation groups remain.** Those cases cannot
be renamed held-out evidence. The old sealed test set remains closed. Therefore
this development study cannot independently qualify a default change, regardless
of a favourable point estimate. This limitation was reported before candidate
inference, not discovered after seeing its results.

Baseline archive: `8f5146b93d1a95244e99b5cc8599e04927082e33160d274d03109d4141ac3b5f`.
Candidate archive: `d25deaeac31d7ef0887527a5bd23fa7f9b014b79cb8aa7b6b0e22a764e7e1b1f`.
Runs are sequential, CPU-only and below normal process priority. No mouse,
desktop focus, user database or installed application payload is used or changed.

## Implementation

- `revision_rejection()` explains existing rejection paths without changing the
  predicate order or retaining manuscript text. The incumbent finaliser was
  extracted as an override seam; its policy remains the default.
- The optional developer service checks original and draft separately, using
  exact UTF-16 spans. Its four frozen grammar rule IDs are `A_NNS`, `HE_VERB_AGR`,
  `PRP_VBG` and `ITS_TO_IT_S`. Source/reference diagnostics informed this limited
  list; it is not a broad precision certification. Style and ambiguous punctuation
  are excluded; grammar retries are disabled in creative mode.
- One additional model call combines residual spelling, supported grammar and
  original plural requirements. Both full original and draft are sent; optional
  repair context is limited to 600 characters. Accepted terms and fields remain
  protected. Rule alternatives are explicitly fallible, never blind replacements.
- The final proposal must pass the original-source guards and repeated spelling/
  supported-grammar checks. There is no retry loop or partial-edit splicing. An
  intermediate draft is never published. Raw traces exist only in developer
  evaluations on public/authored material.

## Relevant verification

The initial 115 repair/sentence-revision tests passed, followed by two additional
async integration regressions covering Unicode/context alignment and cancellation
during repair (21 tests in the new repair file). All 86 existing developer
evaluation tests passed. Frontend hover/edit application checks and the live
development comparison are tracked below when complete. The complete repository
test suite is not part of this bounded task.

## Completed scoped decision — retain incumbent

Both frozen runs completed all 200 cases. Their first drafts and all delivered
suggestions were identical: **zero additional corrections, 0% error reduction**.
ERRANT counts for both were TP 179, FP 187, FN 145; reference precision .4891,
recall .5525 and F0.5 .5006. Every paired conversation-bootstrap difference was
zero. These reference scores are diagnostic, not editorial correctness ratings.

Each run had three two-call cases and two spelling-audit withholds. No sentence
exceeded two calls. The candidate had **zero grammar-triggered repairs**: the
model's first drafts had already addressed the narrow rules this policy supports.
The audit therefore did not address the remaining reference errors. Forty clean/
creative controls stayed unchanged; all forty authored meaning controls matched
their references and met their explicit requirements. This does not establish the
larger 300-clean/150-meaning qualification gates, which were not run after the
development-benefit failure.

The baseline contained two reference-supported contraction guard misses,
`Lets go` and `Thanks, Ill watch...`. Even oracle recovery of both could remove
at most three of the 145 reference errors (2.1%), short of the required 10% after
the first candidate's zero gain. A second full candidate and potentially
ambiguous name exceptions were therefore not justified. All name/fact guards
retain their incumbent decisions. Raw first-draft diagnostic reasons are before
currency-notation restoration; they must not be mistaken for final withholds.

Warm complete-service p95 was 8.36 seconds baseline and 8.33 seconds candidate.
Conservative owned-process-tree peak sums were 6,150,270,976 and 6,170,763,264 bytes
(about 5.73/5.75 GiB). Coverage included all owned descendants. Total recorded
evaluation time was 1,741 seconds, within the eight-hour inference budget. These
are development-host measurements, not physical 16 GiB hardware qualification.

Focused verification passed: 96 incumbent sentence-revision tests, 21 new repair
tests including async cancellation/context checks, 86 evaluation tests, seven
report-integrity tests and 15 hover/edit-application tests. The repository lacked
Vitest after earlier cleanup, so only the pinned test runner and ProseMirror
dependencies were restored in an isolated temporary directory; both selected UI
files then passed. Neither package.json nor its lockfile changed.

The bounded plan is **complete with a failed development-benefit decision**;
independent validation remains unavailable and broader quality remains
unverified. No production default, installed payload, model pin, RAM admission,
document format or package version changed. No sealed cases, paid API or extra
inference models were used. Further model/prompt searches are not authorized by
this study. Its opt-in implementation and evidence are retained for inspection.

## Storage and cleanup limitation

The complete external study occupied 499,397,366 bytes (about 476 MiB), below
the 2 GiB budget. Automatic approval review rejected removal of its temporary
`reference-python` and `ui-check` environments, including a second attempt using
verified, explicit literal paths; it supplied only "blocked by policy". Neither
environment was deleted. Both remain inside the named external study directory,
alongside the preserved corpus, source snapshots, package report and results.
No background inference or monitoring jobs remain.
