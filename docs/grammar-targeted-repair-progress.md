# Existing-model targeted repair results

Execution began 13 November 2026. **Completed. Final native quality gate failed; incumbent generation retained.**
This is the continuation of the user-authorized existing-model plan, superseding
the premature completion claim in the earlier four-rule checkpoint.

## Diagnosis completed

All 120 natural development examples were inspected. Exact ERRANT alignment
identified 145 unmatched reference edits across 63 examples, including punctuation
(32 missing), orthography (24 replacements), other replacements (21), contractions
(12) and spelling (8). These are unmatched edits, not 145 independently verified
remaining grammatical errors. Alternative contractions, semicolons, rearranged
clauses and dubious human reference spellings account for some mismatches.

Of those unmatched edits, 77 occurred in withheld suggestions. Reconstructed
reasons included name protection (27), modality/negation (26), spelling/other
audits (7), accepted terms (7), new names (6), unchanged output (2) and numbers
(2). Several guards correctly reject unsafe paraphrases. In particular, one
baseline rewrote "we are more closed now" to "we are more open now". A small
new scalar-direction check rejects that polarity reversal; this is not a general
semantic verifier.

On the same 63 affected examples:

| Output measured | TP | FP | FN | Reference F0.5 |
| --- | ---: | ---: | ---: | ---: |
| Actual delivered incumbent | 64 | 132 | 145 | .3223 |
| Unfiltered original model drafts | 111 | 197 | 98 | .3851 |
| Model given oracle error locations/categories | 130 | 123 | 79 | .5324 |

The oracle did **not** receive reference replacements or full reference text.
It demonstrates that locating errors can help this model. It is neither a
deployable detector nor an independently validated production improvement. Its
outputs did not pass the complete final service audit.
The standalone probes supplied the case's read-only conversation context,
whereas the application service currently supplies paragraph context. Their
comparison with the application's raw drafts therefore also changes context;
the effect cannot be attributed to error locations alone. First/second-pass
ablations within the standalone probe share the same context. Final policy
selection uses complete-service runs, not this confounded comparison.

## Candidate execution

The first candidate combines narrow paired validator repairs with a maximum of
one conservative source-based retry for rejected/incomplete drafts. The second
also reviews changed drafts without detected residual errors. Both use the same
installed weights, CPU runtime and initial generation prompt. Creative and
explicit-rephrase paths retain the incumbent policy.

The development source archive is
`cdf3dbfb1657c0892d05b2c9d814d6ddd3626bb6d3b9b1176f7a2dfa3c7b4811`.
All raw public development outputs, model-call traces and audit decisions remain
outside the checkout in Local AppData's
`AlderTesting/existing-model-targeted-20261113`.

## Independent research validation prepared

150 JFLEG development examples were chosen by fixed source-ID hash before
candidate selection, excluding normalized overlaps with both retained core and
literary datasets. Selection used no reference errors, model outputs or scores.
Corpus hash:
`3685bd18da8e3843a9c9ba8ca3ddd692288d8ee10d9d4d453ee65b36eae5eb2d`.

[JFLEG](https://github.com/keisks/jfleg) revision
`ee06ff806a208aba815ac45313f4e750a48330a5` supplies four human
references per example. NLTK's Treebank detokenizer reconstructs the published
tokenized text; no new inference model was downloaded. The full artifact
manifest records original hashes and attribution to Napoles, Sakaguchi and
Tetreault (EACL 2017). This is local noncommercial research evaluation under
CC BY-NC-SA 4.0, not bundled data or unrestricted commercial qualification.
Author/essay IDs are unavailable, so source-group intervals cannot establish
essay-disjoint confidence. Public pretraining overlap remains unknown.

The incumbent run has completed; its correction text and quality scores remain
sealed until selection. A further 78 fresh authored controls in 26 families
cover AU/UK/US spelling, creative fragments/dialogue, modality, negation, roles,
money, time, plural nouns, Unicode and protected fields. Dialect variants stay
in one group. These controlled expectations supplement human references; they
are not independent editorial ratings.

## Development decision — targeted retries selected

The targeted policy completed all 200 development cases. Delivered reference
counts improved from TP 179 / FP 187 / FN 145 to TP 194 / FP 193 / FN 130:
**10.3% fewer unmatched reference edits**, precision .4891 → .5013 and F0.5
.5006 → .5182. Conversation-group bootstrap intervals still include zero
difference; this development sample cannot establish a general quality gain.
All 40 clean/creative controls remained unchanged, and all 40 meaning controls
retained their exact references and explicit invariants.

Eight natural deliveries changed: seven recovered corrections and one withheld
the baseline's "more open" meaning reversal. Some newly delivered proposals
still leave awkward or incomplete source phrasing; this policy is not a promise
that every sentence becomes fully grammatical. The review retained those
limitations rather than silently relabelling outputs as perfect.

There were 22 two-call cases versus three in the incumbent, with no third call
or model-call errors. Quality-audit withholds increased from two to eight. They
remain original text in all scores; a safety veto is reported separately from
a crashed/timed-out service. Warm full-service p95 was 10.67 seconds versus
8.36. Conservative owned-process-tree peak sums were 6,209,941,504 versus
6,150,270,976 bytes: approximately 57 MiB more. No memory-limit change is needed.
This remains the 47 GiB development host, not physical 16 GiB qualification.

The broader review policy was rejected during development after 37 completed
cases. It restored "Because this movie was made in 2020, pretty new movie."
after the first draft supplied a finite main clause, and restored an original
comma splice after its first draft repaired the sentence boundaries. Continuing
the full expensive trial was unnecessary after those observed regressions. Its
interrupted population is preserved, never reported as a complete comparison.
One flawed human reference also accepts the missing-main-clause example;
reference overlap alone would therefore reward this regression.

Selection was recorded before opening the final research/control outputs.
The original candidate archive remains immutable during final inference.

## Integration checks

The prepared application path reproduced all 200 development deliveries,
statuses and warnings using recorded model responses and the actual local rules
engine. Every recorded call was consumed, its complete configuration matched,
and actual serialized model requests matched the frozen native engine. The
worker/prompt, runtime and model identities were also bound. This integration
replay is not fresh neural inference or a new quality benchmark.

Code review found a large-dictionary request issue: unrelated accepted words
could fill the protected-term hint list before relevant source names. The engine
now filters that list by occurrence before applying its cap. Protocol tests
cover 150 unrelated entries preceding the real name. The 200 replayed model
requests remain identical after this integration fix; final-population replay
is still pending.

## Completion requirements

The first final comparison did not support a broad quality improvement. Further
development below uses a separately frozen, previously unused research sample;
the first sample is now exposed and cannot be called held out again.
Measure complete-service latency and owned-process-tree memory. Enable a policy
only if supported, run integration checks, record limitations and commit/push
main. No installed application or user data is being changed by this work.

## First final comparison — do not enable the generic retry

All 150 research cases and 78 authored controls finished. Official ERRANT
multi-reference F0.5 changed only .5117 → .5130, with precision .5164 → .5167.
This does not confirm a material general improvement. The six new successful
authored corrections belong to two construction families across three dialects:
preserving money/event time while correcting agreement. No new literal-control
failures or clean changes appeared.

Review found that replacing the incumbent plural-repair request with the generic
retry could lose an existing useful correction of a collective noun. The revised
recovery policy therefore preserves the established plural/spelling sequence,
never rewrites a successful incumbent delivery for an advisory grammar warning,
and spends only an unused retry on an otherwise rejected suggestion. This is a
new development candidate, not a claim that the failed validation passed.

Scoring also exposed an important measurement limitation. Official ERRANT's
output-dependent multi-reference choice selected 478 reference edits for the
baseline and 497 for the candidate. Raw FN differences are not a fixed-denominator
error reduction in that setting. The report now detects that mismatch and refuses
such a reduction claim. An explicitly labelled post-hoc analysis scoring every
distinct supplied reference separately found only 1.96% fewer unmatched edits,
with precision .3490 → .3481 and F0.5 .3335 → .3365. This also fails the benefit
target. Both original and corrected reports are retained.

## Self-location diagnostic and grammar-first candidate

A further 63-case development probe generated a minimal correction with the
existing model, derived possible error **positions** from its token differences,
then asked the same model to correct the original with those positions. No human
reference positions or replacement words entered either request. The guarded,
spelling-audited result had TP 79 / FP 101 / FN 130 versus the incumbent's
64 / 132 / 145 on that affected cohort. This is a diagnostic subset, not a
complete product comparison or independent editorial judgment.

The ablation mattered: its first minimal correction alone, before factual/name
guards, had TP 104 / FP 54 / FN 105 and F0.5 .6183. Its second pass had
114 / 130 / 95 and F0.5 .4810. One invalid multiline first response was withheld
and counted as unchanged, not omitted. The second pass recovered some edits but
introduced many more unmatched changes. A full two-pass location trial was
therefore deferred before it started.

The next candidate is grammar-first: use that complete correction when it makes
one, preserving the incumbent plural/spelling checks. If the first pass leaves
the source unchanged or makes only case/punctuation/spacing changes, use the existing complete-sentence structure/clarity
request, auditing it without a third call. Creative writing and explicit
alternative constructions keep the existing editor. This preserves whole-sentence
restructuring while avoiding a routine second rewrite of corrected prose.

Both the conservative-recovery and grammar-first policies are measured on the
original 200 development cases. A second 150-source research sample was frozen
before their inference, excluding every source in the first sample and the old
core/literary cohorts. Its hash is
`166376b6e0b280ddc03b453d47c28bbb48e679b4b19b447bf46b1c49b12b7142`.
All four published references are retained. Primary scoring sums individual
reference counts within each source group, with official multi-reference scoring
secondary. Dataset rights, missing essay IDs and pretraining limitations remain
unchanged. Final outputs stay sealed until development selection.

The initial grammar-first version was stopped during development when it offered
a capitalization-only edit while leaving the known "Because…" fragment
unfinished. The revised version reserves the sentence-review call for mechanical
edits too, and tests both capitalization alone and capitalization plus punctuation.
The actual revised native output completes that main clause. This prevents a
cosmetic edit from standing in for sentence-level grammatical correction.

## Development selection after the additional trials

The revised grammar-first policy completed all 200 development cases. Its
reference score improved to TP 191 / FP 149 / FN 133 (F0.5 .5671), but review
found less complete grammar: a delivered question retained "Do you also like?"
where the incumbent supplied the missing object. This is a useful example of why
reference overlap cannot alone select an editor. Grammar-first is rejected as a
production default. Its first interrupted version and all adverse outputs remain
in the external study directory.

An explicit clause-completeness prompt was also tested in a 16-case native
readiness comparison. It completed a missing object in one sentence but changed
"The young are still working" into "The young still working" in another. That
prompt was removed rather than promoted or run across another large benchmark.
The error-location and grammar-first adapters remain reproducible developer
experiments; they are not additional product modes.

The selected conservative policy preserves the original successful plural and
spelling repair requests. It never reviews a successful incumbent delivery just
because a limited grammar rule disagrees. Only an otherwise rejected proposal
with its retry still unused can receive an original-source recovery request.
The final delivery passes original-source fact/name/modality checks and a complete
spelling audit; recovery also passes the supported grammar audit. There are at
most two model requests in total, not two retries.

Narrow paired validation also recognises malformed contractions, initial
"may be", aligned existential "no much", a unique unquoted "a Lo of" quantifier,
and an aligned "do not have anything" / "have nothing" predicate. Subject,
tense, conditional/local scope, explicit vocabulary and ambiguous repeated uses
have adversarial near-miss tests. These checks do not rewrite document text or
claim general semantic equivalence. A new collective-number guard withholds
rewrites from "the young" to an individual; it does not change the incumbent's
regular-plural repair request.

The frozen final source identity is
`0288be683927d2ab7fe1f2a97d9e697163af508e1a4464564aef8adab931e38d`.
The selection and rejection reasons were written before opening second-sample
scores. The unchanged model identity is
`00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4`.

A complete 200-case source-bound replay of recorded conservative inference
returned no unrecorded requests. Its final reference counts are
195 / 202 / 129, F0.5 .5099, against the incumbent's 179 / 187 / 145, F0.5 .5006.
This is **replay-derived development evidence**, not fresh native timing. One
additional long cooking/TV paragraph is now accepted from its original single
model request: all spelling is corrected and its equivalent negative wording no
longer triggers the guard. Forty clean/creative and forty meaning controls remain
in the matched population. Of nine changed deliveries, several are deliberately
partial improvements; none establishes that all residual grammar is corrected.
One change correctly withholds the incumbent's closed-to-open meaning reversal.

All 248 selected repair, invariant, replay, sentence-contract and reporting tests
passed, plus the 40 existing proofreading/API tests. Existing third-party test
warnings concern Starlette/httpx/AnyIO deprecations. No full repository suite,
installation, graphical desktop control, paid API or model download was used.
Final integration and final native results are recorded below when complete.

## Final reserved comparison and production decision

The second 150-source sample completed in full, with all four references scored
separately: 600 reference assessments retained within 150 source groups. The
frozen reference edit population was 1,911 on both sides.

| Primary fixed-reference result | Incumbent | Conservative candidate |
| --- | ---: | ---: |
| Matched reference edits (TP) | 664 | 693 |
| Unmatched proposed edits (FP) | 1,060 | 1,131 |
| Unmatched reference edits (FN) | 1,247 | 1,218 |
| Reference precision | .3852 | .3799 |
| Reference F0.5 | .3770 | .3763 |

The 2.33% FN reduction fails the preregistered 10% target, and precision/F0.5
point estimates decline. F0.5's source-group bootstrap difference interval is
approximately [-.0142, .0111]. The official multi-reference secondary score also
falls, .5722 to .5696. Its different selected edit populations (443 and 467)
again cannot establish a raw remaining-error reduction. This is an adverse final
result, not grounds to tune the candidate on these newly exposed sentences.

There were no model-call errors or new operational service failures. One new
quality-audit withhold remains unchanged source text in the metrics. Native
warm full-service p95 rose from 8.66 to 13.58 seconds. Conservative complete-owned-
process peak sums were 5,940,314,112 and 6,005,575,680 bytes (about 62 MiB apart);
these are lifetime component peak sums, not simultaneous resident memory.
Neither the same-model quality gain nor the added tail latency supports promotion.
The 47 GiB shared development host and uncontrolled concurrent workloads remain
important timing limits. No physical 16 GiB, Mac or Word/Grammarly qualification
is inferred from this experiment.

**The broader recovery policy stays disabled.** Narrow contraction/quantifier/
negative-equivalence exceptions also stay confined to that developer candidate.
Alder's production generator, initial prompt, spelling/plural sequence, model,
runtime, context and memory admission remain the incumbent configuration.

Two independently reproduced safety defects are fixed in the final source:
explicit scalar reversals (for example, "more closed" becoming "more open")
are withheld, and a collective group ("the young") cannot silently become a new
individual ("the young person"). These are conservative source-preservation bug
fixes with adversarial regressions, not evidence that general grammar has reached
a higher editorial standard. No new generation or retry is introduced by them.
Failed grammar-first and self-location algorithms live only in the developer
experiment module, with no application switch. The tested source-recovery adapter
remains opt-in for reproducing this negative study.

The final 279 relevant tests pass. The complete suite was not run. Final selected-
candidate integration and production-preservation replay are recorded below.

## Integration, examples and completion

Both final native candidate populations replay exactly through the current
source-recovery seam: all 150 research cases and all 78 controls match delivered
text, service status, warnings and request consumption. Worker/prompt, runtime,
weights and actual serialized model requests are bound to the verified archive.
This verifies implementation, not quality promotion.

The retained application policy was separately replayed across 428 cases:
200 original development cases, the second 150-source sample and the 78 controls.
Every initial native response matches the incumbent's response. Final deliveries,
statuses and warnings match the incumbent on 427 cases. The remaining development
case now withholds the known scalar reversal. There are no unbound model requests
or new literal-check failures. Recovery-only recorded calls are intentionally
unused by the retained incumbent policy; this preservation replay is not presented
as exact agreement with the rejected candidate.

Representative real development evidence (ErAConD; earlier sample already exposed):

| Status | Original excerpt | Model draft / outcome |
| --- | --- | --- |
| Shipping safety fix | "so we are more closed now" | The incumbent's "so we are more open now" is withheld. |
| Developer candidate only | "Lets go" | "Let's go." is recovered without another model call. |
| Developer candidate only | "may be i will change my phne and i would like to by the iphone 13" | "Maybe I will change my phone, and I would like to buy the iPhone 13." |
| Developer candidate only | "a Lo of TV series" / "dont have anything else to do" / "receipts ... cheescakes" | The original full draft fixes the quantifier, uses equivalent "have nothing else to do", and writes "recipes ... cheesecakes". Previously all of that draft was withheld. |

Those candidate-only examples are deliberately **not** advertised as shipping
behaviour. The independent final comparison did not justify enabling their wider
recovery policy. Some recovered development deliveries still contain fragments;
neither a selected attractive example nor more matched edits proves complete
sentence editing.

All 279 original relevant checks and four additional application-default guard
checks pass (283 distinct selected tests). The additional checks exercise the
unchanged application default, both withheld safety violations and a valid
collective agreement correction. The full suite and frontend/UI tests were not
rerun because no frontend code or hover interaction changed in this continuation.

The diagnosis of all missed edits, oracle/confound analysis, candidate trials,
reserved validation, source-bound integration, resource measurement and final
report are complete. There is no pending inference, API approval, user rating or
installation step in this bounded plan. Its promotion target failed; the earlier
broader Grammarly-equivalence programme remains unqualified. Reaching that level
of editorial quality is not claimed as completed.

Machine-readable aggregates and provenance are in
[`verification/grammar-targeted-repair.json`](verification/grammar-targeted-repair.json).
The final production source archive is
`0ce705a693e0346b77f56d36bcfc3d963fe86549e510ad27155910858296947b`.
Public raw outputs and adverse reports remain outside the checkout. No benchmark
sentences, authored exports, user documents or model weights are included in the
aggregate. The installed application and user data remain untouched.

After integration, one terminal empty line was removed from the developer-only
experiment module. AST equality was verified; executable behaviour is unchanged.
The aggregate records both integration and final-source identities.
