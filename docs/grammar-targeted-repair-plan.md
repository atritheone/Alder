# Improving the existing correction model

Execution reopened 13 November 2026. Use the installed Qwen3.5-4B Q4_K_M model;
do not change weights, quantization, runtime, model admission or package version.
Work on main. Commit and push when this work is complete, or stop and checkpoint
if account weekly usage falls to 20 percent **remaining**.

## Diagnose the actual losses

Analyse every missed reference edit in the frozen 120-sentence natural
development cohort, rather than selecting two convenient contraction examples.
Separate errors the raw model misses from corrections discarded by spelling,
name, number, modality and meaning guards. Review questionable references as
diagnostics; never turn a machine disagreement into a new human gold label.

An oracle-location probe may reveal whether the existing model can fix the
errors when located for it. Supply positions/categories only, no replacement
answers. Compare it with both raw first drafts and the delivered baseline on
the same population. Oracle results cannot qualify a production change.

## Improve generation and safe recovery

Try a conservative second pass which starts from the immutable original, sees
the fallible draft and the reason it was rejected, and preserves explicit source
terms. Combine spelling, grammatical repair and plural preservation in that one
retry. No loops, partial-edit splicing or publication of intermediate drafts.

Test two strategies on development material: retry rejected/residual-error
drafts only, and review all changed drafts. Prefer the cheaper strategy when its
benefit is adequate. If neither helps, use the diagnosed error categories to
make further focused changes before closing the investigation.

Repair validator false positives only with narrow paired evidence. In particular,
distinguish clause-initial malformed contractions and adverbs from literal names,
and malformed existential negative quantities from genuine polarity changes.
Explicit vocabulary, numbers, currency, participants, event time, negation and
plurality remain protected. Add adversarial near misses for every exception.
Do not globally exempt capitalized unknown words from spelling checks.

## Measure without requesting user ratings

Use the official ERRANT scorer with independent human correction references and
paired source-group comparisons. It measures reference edit overlap, not general
editorial judgment. Preserve raw outputs, complete-service delivered outputs,
suppression reasons, call counts, runtime/source fingerprints and resource use
outside the checkout. Include unchanged/withheld cases in the denominator.

The old corpus's validation examples have already been exposed. Freeze a genuinely
new external research sample before candidate selection; do not inspect its
corrections or metrics while tuning. JFLEG is research-only under its recorded
CC BY-NC-SA licence and is not bundled, trained on or treated as unrestricted
commercial qualification. Author/essay IDs and pretraining overlap are unknown.
Add new authored clean, dialect, creative and meaning controls, frozen before
their inference; templated controls are regression evidence, not independent
human judgments. Keep the old sealed test closed.

Select on development, freeze the candidate, then run final validation once.
Require a material correction gain (target at least 10 percent fewer remaining
reference errors), no reference precision/F0.5 regression, no new meaning-control
failures and no deterioration in clean/creative controls. Review every changed
development delivery for introduced meaning problems, and report validation
disagreements without post-hoc tuning. If validation contradicts the benefit,
retain the incumbent default and record that result explicitly.

## Integrate and verify

Only enable a supported policy after the evidence warrants it. Preserve creative
and explicit-rephrase behaviour. Test cancellation during both audit and retry,
Unicode offsets, protected fields, original-context handling, complete spelling,
cache separation and the maximum two-call budget. Reuse the existing hover/edit
regressions where the backend integration could affect them.

Measure complete-service warm latency and the whole owned process tree's memory.
Keep the existing runtime/model memory configuration; explain any added repair
latency rather than claiming it is free. CPU background work must not interfere
with the user's desktop. Do not install/update Alder or modify their data.

Publish reproducible aggregate evidence, representative real before/after
examples, known limits and the final decision. Broad semantic correctness and
Grammarly parity still require stronger qualified evaluation; do not claim them
from reference overlap, hand-written checks or the oracle probe. No paid API
calls or additional model downloads are part of this execution.

## Development amendment after the first validation

The generic retry failed to demonstrate a material gain on the first fresh
sample. It is not promoted. Preserve that adverse evidence and mark those
sources exposed. Continue with the diagnosed mechanisms: retain successful
incumbent plural/spelling repairs, compare self-generated error locations with
their first correction pass, and test grammar-first correction with conditional
whole-sentence clarity. Keep the same weights and maximum two calls.

Freeze a second nonoverlapping research sample before the new candidates run.
Use a fixed reference population: score all four human references separately,
sum within source, and bootstrap sources rather than treating references as new
observations. Official multi-reference scoring remains secondary; output-dependent
reference choice cannot justify a raw remaining-error reduction. This amendment
does not relabel the first result as passing or establish Grammarly parity.

## Completion record

Completed 13 November 2026. The reserved final comparison failed the promotion
criterion (2.33% fewer unmatched reference edits with slightly lower precision
and F0.5); the broader candidate and its lexical exceptions remain disabled.
The incumbent generation policy is retained with separately tested scalar and
collective-number safety fixes. All planned diagnosis, same-model trials,
reserved scoring, integration and reporting steps are recorded in
[`grammar-targeted-repair-progress.md`](grammar-targeted-repair-progress.md), with
283 relevant tests and 428 application-preservation replay cases. No claim of
Grammarly parity, physical 16 GiB or Mac qualification follows from completion
of this bounded investigation.
