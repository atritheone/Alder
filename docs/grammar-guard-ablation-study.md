# Grammar guard-only evaluation

Completed 14 November 2026. **Keep application defaults unchanged. Take forward
only the stricter, exact-contraction subset as a small candidate fix.** This is
not promotion of the previously rejected retry strategy or a demonstrated general
grammar-quality improvement.

## What was isolated

The incumbent model request and plural/spelling finaliser ran through recorded,
source-bound responses once per example. Every combination of five exception
families then inspected the **same final audited draft**. No family requested a
second model response or rewrote any words itself. All 32 combinations were
measured across 428 cases: 200 development cases, 150 previously exposed JFLEG
cases, and 78 authored regression cases.

The engine's actual serialized requests, worker, pinned model/runtime and native
source archives were checked. The capture refuses unrecorded requests, missing
drafts and incomplete populations. Previously recorded recovery-only responses
were left unused. There were **zero new model calls and zero paid API calls**.

Scoring used ERRANT 3.0.2 and the retained human references, each reference scored
separately and summed within its source. Clean and meaning controls supplement
the natural references. The 150 JFLEG cases were exposed in the preceding study;
this reuse is an ablation, not fresh independent natural validation.

## Results by family

The current development baseline has TP 176 / FP 181 / FN 148 and F0.5 .5023.
It includes the scalar/group safety guards committed in the preceding study.
Counts below are differences against that current baseline, not against the
earlier pre-safety policy.

| Guard family | Development suggestions recovered | Additional matched reference edits | Additional unmatched proposed edits | Reference F0.5 |
| --- | ---: | ---: | ---: | ---: |
| Contractions | 2 | 3 | 0 | .5074 |
| Initial "may be" to "maybe" | 1 | 7 | 0 | .5140 |
| Existential "no much" to "not much" | 1 | 3 | 8 | .4983 |
| Quantifier "a Lo of" alone | 0 | 0 | 0 | .5023 |
| Negative possession alone | 0 | 0 | 0 | .5023 |
| Quantifier plus negative possession | 1 | 1 | 9 | .4939 |
| All five families | 5 | 14 | 17 | .5064 |

None of the 32 combinations changed a delivery in the 150 previously exposed
validation cases or the 78 regression cases. No new literal-control failures or
clean/creative changes occurred. The supplied human references may omit valid
paraphrases: an unmatched proposed edit is not an independently judged grammar
mistake. The attractive long quantifier/negative-possession rewrite is one
example requiring **both** exceptions; neither has demonstrated standalone
benefit in these samples.

The two contraction recoveries are real development outputs:

- `Lets go` becomes `Let's go.`
- `Thanks, Ill watch as soon as I can.` becomes
  `Thanks, I'll watch as soon as I can.`

The initial-maybe case also corrects phone spelling and wording throughout its
sentence. Its observed benefit is useful, but the safety result below prevents
promotion of that broad exception as currently written.

## Safety findings and contraction refinement

Twenty-three authored contracts cover 12 faithful repairs, eight deliberately
harmful edits and three explicit-vocabulary protections. They are reproducible
functional checks, not independent editorial ratings or estimates of naturally
occurring harm. The challenge set was written before its first execution; the
contraction refinement was then developed against its failures. Additional unit
regressions cover the refined scope.

The original five families collectively admitted all eight harmful mutations.
Examples include:

- An apostrophe repair accompanied by changing a condition from "approved" to
  "rejected".
- A contraction changed inside an explicitly quoted command.
- Negation moved from coffee in the pot to coffee in the cup because the
  existential matcher compared only a short noun prefix.
- A quantifier corrected while a later noun changed from invoices to orders.

This does not mean the model produced these mutations during this ablation.
They deliberately probe what each guard would admit. Nor does a single exception
claim to verify all semantics. The failures show why recovering a genuine typo
must not be interpreted as permission for the rest of a passage to change freely.
All explicit-vocabulary checks continued to hold.

The contraction exception is now stricter in the **developer opt-in candidate**:

- The complete passage must match after inserting the paired apostrophes.
- Only a terminal full stop is optional; unrelated clause, word, punctuation or
  question changes receive no contraction exemption.
- Quoted spans, declared vocabulary, repeated/mixed name uses and ordinary
  third-person verb constructions retain their protection.

That version keeps both natural recoveries, admits all four faithful contraction
challenge cases, blocks both harmful contraction cases, and preserves the
explicit-vocabulary check. It also passes the additional exact-change unit
regressions. All 96 profile/cohort scoring projections were compared after the
change and remained identical to their original natural outputs; the stricter
rule lost none of this sample's observed recoveries.

The other four families still admit their specified harmful cases. They remain
developer-only and should not be enabled as a bundle. In particular, a positive
reference-edit result for initial-maybe does not override its conditional-meaning
failure.

## Cost, verification and decision

There is no additional inference. On one known development sentence, a warmed
1,000-iteration guard-only check measured baseline median .155 ms versus .355 ms
for exact contractions; p95 was .170 ms versus .378 ms. This is a narrow Python
microbenchmark on the shared host, not complete service, hover or model latency.
No model, runtime, memory-admission, installation or user-data change was made.

**237 relevant tests pass**, including individual-family isolation, interactions,
protected facts, exact contraction limits, bad-admission reporting and an async
guard-only hook using one request with UTF-16 document offsets. Creative and
explicit rephrase keep their existing behaviour. The full suite was not run.

The evaluation request is complete. The evidence supports taking forward the
exact-contraction candidate as a small correction to false rejections. Initial-
maybe needs its unrelated-condition risk addressed before promotion. Existential
and possession/quantifier handling need stronger clause and noun alignment plus
independent evidence of benefit. Another broad retry or larger model is not part
of this result.

**No application default was enabled in this evaluation.** The natural samples
were previously exposed and show no newly independent benefit estimate. Unknown
names, ambiguous intended wording and cases outside the explicit tests still
require conservative handling. Nothing here establishes Grammarly parity.

Machine-readable counts and provenance:
[`verification/grammar-guard-ablation.json`](verification/grammar-guard-ablation.json).
Verified original and stricter sources, all raw profiles, human-reference reports,
and adverse challenge outcomes remain under
`%LOCALAPPDATA%/AlderTesting/guard-ablation-20261114`. Benchmark sentences and weights
are not redistributed with the aggregate. JFLEG use remains local noncommercial
research under CC BY-NC-SA 4.0; its author/essay identities and pretraining overlap
are unknown. The old sealed test remains closed.
