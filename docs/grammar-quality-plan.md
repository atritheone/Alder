# Grammar quality and autonomous evaluation

Plan created 11 November 2026 for the Alder 0.13 development checkout.

## Objective and current boundary

Make a sentence suggestion a useful complete edit: spelling, grammar, punctuation,
clear structure and natural wording, while retaining meaning, voice, dialect and
document formatting. Aim to match Grammarly on a defined English proofreading
suite. A working local model or a few attractive rewrites does not establish that
standard. Report measured results by category before making a parity claim.

The two immediate fixes are implemented in this working copy:

- A misspelled word and its enclosing sentence rewrite remain independently
  selectable in the hover card. Spelling opens first over the misspelled word;
  buttons expose the other suggestions for that sentence. Overlapping
  ProseMirror decorations retain all their identities through CSS classes rather
  than relying on the single DOM id attribute that can be overwritten.
- Sentence generation explicitly includes spelling and punctuation. The complete
  proposal is checked with the installed local rules engine. Detected spelling
  issues trigger at most one contextual model repair, followed by another spelling
  check. A proposal with remaining detected misspellings is withheld. Project
  vocabulary and protected field phrases are excluded from this audit. The final
  result still passes the original-source fact and vocabulary guards, and applies
  as one undoable transaction. Missing spelling resources are reported explicitly.

These fixes do not certify all grammar, real-word spelling, semantics or style.
The existing 40-case development comparison is useful regression material, not a
held-out qualification set. Windows is the tested delivery platform; Mac remains
unverified, and Intel Mac has rules only. No dependency/model pin, document format,
package version or installation is changed by this plan.

## Why the existing system reaches a quality ceiling

`worker.py` currently asks a general 4B quantized model for one deterministic
rewrite. It has paragraph context but no calibrated quality ranker. The same
policy handles clear errors and optional structural changes. `revision()` uses
literal fact, name and modality checks, which catch some dangerous edits but also
reject legitimate corrections. For example, its heuristic can mistake a
capitalized misspelling for a protected name. Names can retain their spelling and
order while their grammatical roles or implied claims still change. A dictionary
also cannot decide whether a valid word such as "their" is wrong in context.

The frontend can offer and safely apply a whole sentence; the next gains must
come from generation, contextual spelling, candidate selection and measurement.
The evaluator must assess the delivered suggestion, including cases suppressed
by validators, rather than only the attractive raw model outputs.

## 1. Define separate quality tracks

Maintain two modes in generation and evaluation, using the existing standard and
creative profile settings:

| Track | Required behaviour | What is penalized |
| --- | --- | --- |
| Correctness | Fix spelling, agreement, tense, articles, prepositions, punctuation and sentence boundaries together | Remaining errors, introduced errors, altered facts or dialect |
| Structure and clarity | Repair awkward clauses, dangling modifiers, run-ons, redundancy and poor information order | Unnecessary rewriting, ambiguity, lost qualifications or voice |
| Clean and creative controls | Leave effective prose, intentional fragments and dialogue alone | Any gratuitous change; flattening deliberate voice |

Automatic suggestions should have a higher benefit threshold than an explicit
request for another construction. Do not equate shorter text, fewer rule warnings
or more edits with better writing. Keep the user in control of applying changes;
autonomous *development evaluation* does not mean automatic manuscript rewriting.

Deliverable: a versioned rubric, error taxonomy and case schema under
`scripts/developer/grammar/`, with separate scores for correctness, fluency,
meaning, voice, dialect and completeness. Every finding must identify an actual
source/output span and give a short reason; invalid spans invalidate the rating.

## 2. Build the test corpus before further prompt/model tuning

Create a manifest with exact revisions, SHA-256 hashes, rights and attribution for
each source. Store downloaded corpora, weights and generated reports outside the
checkout; only redistributable authored fixtures and manifests belong in Git.
Development tooling is excluded from end-user installation prerequisites.

Use several sources for different purposes:

1. **SEEDA human-rated corrections** to test the evaluator itself. The repository
   provides sentence/edit judgments and system rankings, including fluency-focused
   corrections and unchanged input. Use both sentence-level agreement and system
   ranking; a judge that merely separates very bad from very good systems is not
   qualified to choose between similar Alder candidates. [SEEDA paper](https://aclanthology.org/2024.tacl-1.47/),
   [data and evaluation scripts](https://github.com/tmu-nlp/SEEDA).
2. **Reference-based correction sets**, including BEA/W&I+LOCNESS and JFLEG where
   permitted. ERRANT measures edit precision/recall and F0.5; use it for correctness
   categories. JFLEG supplies fluency-oriented references and its GLEU procedure.
   JFLEG is CC BY-NC-SA 4.0: do not assume that it can be redistributed or used in
   every commercial workflow. Record dataset restrictions separately from tool
   code licences, and exclude incompatible data. [ERRANT](https://github.com/chrisjbryant/errant),
   [JFLEG](https://github.com/keisks/jfleg).
3. **An Alder-specific suite**, initially at least 1,300 cases: 600 mixed-error
   corrections balanced across AU/UK/US English, 300 clean controls, 150 semantic
   traps, 100 rich-document/offset cases, and 150 fiction/dialogue/domain cases.
   Include multiple errors per sentence, ambiguous spelling alternatives, real
   words used incorrectly, capitalized typos, invented names, quotations, emoji,
   Unicode, tables, citations, fields and copied hostile instructions.
4. **Metamorphic cases with known invariants**: vary names, currencies, dates,
   negatives, quantifiers, pronouns and agent/patient roles independently. Create
   good and deliberately corrupted output pairs. These provide objectively wrong
   examples for testing a judge's resistance to fluent but unfaithful prose.

Partition authored cases by source document and mutation family: 400 development,
300 validation and 600 sealed test cases. All dialect variants and paraphrases of
one example stay in the same partition. Keep evaluator calibration data separate
from generator adaptation data. Group SEEDA judgments by source sentence when
splitting them; never scatter different system outputs of one sentence across
calibration and validation. Public data may occur in model pretraining: label
that uncertainty and retain fresh authored controls.

Do not turn machine disagreement into new gold labels. Such cases enter a
development challenge queue with provenance; they cannot silently alter the
locked test set or become training labels. Every observed product failure gains
a regression case without exposing sealed-test answers to the optimizer.

## 3. Qualify an automatic evaluator using existing human judgments

This is the replacement for asking the user to rate every proposal batch.

Build four independent evaluation layers:

1. **Deterministic checks**: exact preservation of fields/links, quantities and
   URLs, stale-source rejection, one-step undo, dialect conventions, residual
   detected spelling, latency, memory, cancellation and offline operation. Reuse
   the product validators but add independent adversarial fixtures to detect their
   blind spots. Broken structure or a protected-fact change is a hard failure.
2. **Reference metrics**: ERRANT precision, recall and F0.5 by error type, plus
   reference-based fluency scores. Score minimal corrections and rewrites
   separately: one reference wording must not define the only valid rewrite.
3. **Grammar-specific reference-free metrics**: evaluate SOME and IMPARA-GED on
   the human-rated calibration set, selecting the best reliable combination.
   `gec-metrics` supplies these adapters. Its default IMPARA-QE checkpoint is
   described as unofficial; explicitly select and verify the intended checkpoint
   rather than treating all IMPARA variants as equivalent. Inspect individual
   grammar, fluency and meaning signals rather than accepting a weighted average
   that could conceal a meaning failure. [Metric library](https://github.com/gotutiyan/gec-metrics).
4. **Blinded comparative model judges**: qualify at least two judges with different
   model families, including a non-Qwen judge. They can be larger/slower than the
   shipped generator because this is offline developer tooling. Run sequentially
   to fit the available development machine. A 9B Qwen judge can be a diagnostic,
   but cannot be the sole authority selecting Qwen-generated revisions. Pin exact
   weights, quantization, runtime, prompts, rubric and decoding parameters after
   measuring calibration; this plan does not assume an untested judge model wins.

Judges receive source, read-only context, locale/profile and anonymized candidate
texts. They never receive model names, expected winners or other judges' answers.
Evaluate both A/B and B/A orders. Identical outputs are recorded as ties without
an inference call. Require explicit error spans for grammar and semantic failures;
do not trust a judge's self-reported confidence. Malformed output, timeouts and
order-dependent decisions are abstentions, not ties or successes. Model judges
have documented self-preference bias, so separate families and order swapping
are controls, not a guarantee of independence. [Self-preference study](https://aclanthology.org/2025.emnlp-main.86/).

Proposed evaluator acceptance gates, fixed before the calibration run:

- At least 80% pairwise agreement on held-out, decisive human-rated pairs, with
  the lower document-cluster bootstrap 95% bound above 75%; report ties separately.
- Spearman system-ranking correlation at least 0.85 on the held-out ranking slice.
  This supplements sentence agreement and cannot replace it.
- At most 5% winner changes after swapping order; at most 10% abstentions on the
  calibration domain. Report all losses, errors and missing ratings in coverage.
- Detect at least 95% of controlled harmful semantic mutations; never prefer a
  known harmful mutation because it is more fluent. All critical deterministic
  invariants must pass. These thresholds require enough examples per category,
  not a favorable aggregate from a handful of pairs.

If no local evaluator qualifies, record that result and retain the incumbent.
Improve the judge/rubric using calibration data or qualify another checkpoint;
do not lower thresholds after seeing the test outcome. Domain-specific claims
remain unverified where existing human ratings provide insufficient coverage.
This can guide work without new user ratings, while acknowledging that automated
judgment cannot prove universal editorial quality.

Prospective protocol amendment, 12 November: evaluate a stable comparison pipeline
that orders candidates by a fixed source/candidate SHA-256 key before model input
and caches the resulting verdict. Restore winner labels and exact evidence to each
caller's A/B order. Do not search hash seeds or candidate orders against human
winners. Both caller orders still run through the pipeline. Its order symmetry is
structural, not evidence that the underlying model is unbiased or accurate; report
that limitation separately. The original human-agreement, system-ranking, harmful-
mutation, coverage and independent-family requirements remain unchanged. Preserve
the earlier raw-order failures and freeze the new implementation before inference.

## 4. Make generation and verification work together

Run controlled experiments, one change at a time, retaining unchanged input and
the current implementation as explicit candidates:

1. Improve the prompt with a completeness checklist and a few disjoint examples
   for multi-error sentences, word usage, sentence boundaries and dialogue.
2. Supply original-sentence spelling alternatives as contextual hints. Never
   replace every word with LanguageTool's first alternative: "mispelled" can have
   several suggestions, and only the context determines the right one.
3. Separate a faithful correctness pass from an optional structure pass. Preserve
   original-to-final mappings and evaluate the combined output against the
   original, not only each intermediate string. Measure whether two passes earn
   their added latency versus the single-pass baseline plus spelling repair.
4. Generate at most two genuinely different candidates when uncertainty or an
   explicit request justifies it; do not run a large judge committee during typing.
   Distill the successful developer ranking into a small runtime quality scorer or
   calibrated acceptance threshold only after validating it independently.
5. Check candidate grammar and spelling, and test semantic entailment in both
   directions against the source/context. Preserve conditions, tense, negation,
   quantities, referents and who did what to whom. Embedding similarity alone is
   insufficient. Ambiguity or conflicting checks should suppress the structural
   rewrite and retain usable word-level corrections.
6. Replace overly broad capitalized-token guards with carefully tested entity and
   accepted-term protection. Add sentence-initial spelling examples before allowing
   name changes. Do not relax the existing guard globally to improve recall.

Keep correctness and optional stylistic polishing distinct in scoring and UI.
Spelling repairs must not change names or fields, erase deliberate character
dialect, or make a sentence more confident than its author intended.

Deliverable: a measured ablation report comparing prompt-only, contextual hints,
two-pass editing, candidate selection and verifier variants. Report missed
corrections *and* harmful/unnecessary edits, including validator rejection rates.

## 5. Compare models and adaptation after the evaluator is frozen

Re-run the pinned 4B baseline and the existing 9B challenger on the same unseen
suite with the same pipeline. Add a task-specialized GEC/editing checkpoint only
after inspecting its code/data/weight terms, local runtime support and memory.
Compare native/reference precision with deployed quantization on a representative
subset to distinguish model limitations from quantization loss. Record peak RSS,
cold load, warm p50/p95 and total pipeline time including rules and repair.

Use a staged search: development screening, validation of the best two, then one
sealed qualification run for the selected candidate. Keep a written trial budget
(initially at most 12 prompt/pipeline trials and three model families). Repeated
tries against the same test set would turn it into another development set.

12 November amendment: allow one additional, preregistered pipeline (13 total,
still three model families) that supplies fallible local grammar and punctuation
hints alongside spelling. The earlier source-hint experiment supplied spelling
only; residual reference errors motivate this distinct test without adding a
model or raising memory. Compare it with a fresh matched current-service baseline
on the existing 100-case development screen first. No quality threshold, held-out
partition or sealed-test rule changes, and no shipping change follows from a
development metric preference alone.

A second 12 November amendment allows one resource-motivated 9B IQ3_XXS
configuration (14 total, still three families). Q4 remained over budget after
batch/flash probes; the smaller export was selected from published sizes before
quality inference. Its raw-worker probe completed three authored inputs at about
3.83 GiB model peak RSS, excluding rules/backend, but altered a literal control
token. The current source guard now rejects such changes and automatically
protects those literals. First run fresh document-preservation sentinels, then a
matched 100-utterance, conversation-balanced development screen with current 4B.
Measure the complete service, not file size or raw output alone. The independent
quality, latency, physical reference-hardware and 7 GiB maximum gates remain in
force; lower precision is not presumed to preserve the larger model's benefits.

Prospective fifteenth-pipeline amendment (12 November): fresh dialogue regressions
showed an unnecessary rewrite of a clean sentence. Test a one-pass source-defect
diagnosis before constructing the revision, with an exact source quote and an
explicit no-change branch. Retain whole-sentence structural editing, all service
guards and the complete spelling audit; explicit rephrasing remains available.
This is same-model generation control, not an independent evaluator. Freeze the
source and compare reviewed-text preservation and natural-error recall before
considering promotion. Community-reviewed examples retain their experimental
label status, attribution and reviewer-concentration limitations. The total
generator budget is now 15 configurations across the existing three families;
no quality, latency, independence or sealed-test criterion is relaxed.

If prompt/pipeline changes plateau, train a small adapter with licensed correction
and preference data. Train on development/training data only; include unchanged
controls, dialect and creative examples. Distil stronger-editor outputs only
where their generation and reuse terms permit it and the evaluator accepts them.
Freeze an export, quantize it and rerun the complete deployed-pipeline gate.
Do not ship a larger model merely because it is larger.

## 6. Establish the Grammarly comparison properly

Create an adapter for source-aligned comparator corrections, with product version,
date, language, tone/style settings, suggestion category and exact resulting text.
Use permitted, authenticated product access and controlled test documents, through
a supported interface or validated UI automation. Include Grammarly with Word if
that is the claimed target, not only the public sentence rewriter. A UI capture
failure should trigger an accessible alternative; it should not generate invented
comparator data or block all non-comparator development.

Grammarly's documented Writing Score API returns document-level category scores;
it does not provide the corrected sentence text needed by this comparison. Treat
it as an optional secondary measure if access exists. Do not mistake its score for
an edit-quality gold standard. [Writing Score API documentation](https://developer.grammarly.com/writing-score-api.html).

For every comparator case evaluate source, Alder and Grammarly blindly, including
unchanged outputs. Report ties, wins, losses, abstentions, missing corrections and
critical defects separately. Bootstrap by document, not by treating correlated
mutations as independent. Keep dialect/creative categories separate.

Proposed claim gate: on at least 500 valid held-out comparator cases, the lower
95% bound of `(wins + 0.5 * ties) / valid comparisons` is at least 0.48 (a stated
two-percentage-point non-inferiority margin), while the independent correctness,
coverage and semantic gates also pass. Missing/abstained cases must be at most
10%, with comparable category coverage. Pre-register the margin and denominator.
If product access or trustworthy automation is unavailable, mark *Grammarly
comparison unverified* and continue measurable Alder improvements. Do not ask the
user to replace the missing comparison with informal ratings.

## 7. Automate iteration, selection and reporting

Implement a developer-only pipeline with these planned artifacts:

| Artifact | Responsibility |
| --- | --- |
| `scripts/developer/grammar/corpus.py` | Validate manifests, rights, partitions, hashes and source-aligned JSONL |
| `scripts/developer/grammar/generate.py` | Run the real service, record raw/validated/suppressed candidates, timing and memory |
| `scripts/developer/grammar/calibrate.py` | Meta-evaluate metrics/judges against held-out human ratings and adversarial controls |
| `scripts/developer/grammar/judge.py` | Isolate blinded judging, schemas, paired order swaps and abstentions |
| `scripts/developer/grammar/compare.py` | Combine hard gates, error-category metrics and paired bootstrap intervals |
| `scripts/developer/grammar/qualify.py` | Run the frozen pipeline, emit `passed`, `failed` or `unverified` and an HTML report |
| `scripts/developer/grammar/experiments.json` | Bounded candidate configurations and explicit baseline |

Provide local, resumable JSONL outputs and a summary JSON containing source hash,
model/runtime/quantization hashes, rule versions, prompt/rubric versions, corpus
and split hashes, seeds, hardware, complete timing and all failure counts. Resume
only exact matching fingerprints; never silently reuse ratings from another
judge configuration. Do not log or upload the user's manuscript.

The improvement loop is: run baseline → identify failure categories on development
data → make one change → rerun development → evaluate shortlisted candidates on
validation → stage the winner only if all gates pass → run sealed qualification.
The automated report names the winner or keeps the incumbent. It does not need a
user rating task. Judge disagreement is a failed/uncertain experiment and a useful
diagnostic, not a request for the user to arbitrate. A report can recommend a
candidate; publishing, installation and Git writes still follow user authorization.

Integrate optional grammar qualification with
`scripts/developer/validate-release.py`. Keep it separate from normal install/update
integrity and launch checks. No always-running scheduler or telemetry is needed.

## 8. Freeze practical acceptance gates and deliver in stages

These are proposed engineering targets to freeze before the new experiment suite,
not claims about today's measured quality:

| Measure | Gate |
| --- | --- |
| Structural safety | All protected fields/links, source guards, offset and undo tests pass |
| Meaning | Zero failures in the critical trap set; no statistically supported rise in semantic defects versus baseline |
| Completeness | No displayed proposal with unresolved spelling detected by the configured audit; report known rule false positives and real-word limitations |
| Precision | At least 95% judged-valid correctness edits on the qualified held-out suite; inspect by category |
| Clean text | At most 2% unnecessary automatic rewrites on 300 clean controls; upper 95% interval at most 5% |
| Useful corrections | At least a 10% relative reduction in remaining target errors versus current baseline, without precision loss; report abstention and suppressed-output coverage |
| Creative/dialect | No regression in each locale and voice-preservation slice; no trading AU quality for an overall US-weighted gain |
| Runtime | On named reference 16 GiB Windows hardware, warm p95 complete single-sentence result at most 10 seconds, with no typing blockage; document cold load separately |
| Memory | One inference worker; initial protocol: 6 GiB peak additional proofreading memory on the 16 GiB target. Prospective protocol v2 allows at most 7 GiB only when the independent quality gates justify the increase |
| Comparator | The separately defined non-inferiority and coverage gate, only with actual comparator evidence |

Report uncertainty when a slice is too small; do not advertise a 0% error rate
from a small clean sample. If a threshold proves impractical, propose and justify
a new future protocol without retroactively passing the old experiment.

On 11 November 2026 the user authorized a modest memory increase if the quality
benefits are great enough. Prospective protocol v2 uses a 7 GiB ceiling; the
existing precision, useful-correction, meaning, latency and hardware gates remain
in force. Earlier measurements retain their original 6 GiB protocol. Merely fitting
under the new ceiling is not evidence of a worthwhile quality improvement.

Implementation order and reviewable exits:

1. **Current fixes:** overlap selection and complete spelling, unit checks and
   live Windows hover acceptance/undo evidence. Complete before quality work.
2. **Corpus and evaluator (roughly 3–5 engineering days):** manifests, partitions,
   calibrated reference metrics and qualified judges; repeatable baseline report.
3. **Pipeline experiments (3–5 days):** completeness/context/verifier ablations,
   measured effects on precision, fluency, semantics and latency.
4. **Model selection/adaptation (3–8 days, conditional):** qualify challengers;
   train only if the prior experiments establish a worthwhile deficit.
5. **Comparator and release qualification (2–4 days once access/hardware exist):**
   freeze results, test the deployed pack offline on Windows and use the developer
   release validator. Mac remains unverified until native testing actually passes.

Estimates exclude model training time, acquiring external product access and
unavailable hardware. The first deliverable is trustworthy automated measurement;
the final deliverable is a reproducible quality report and a proven better local
configuration, with a clearly scoped Grammarly comparison if the evidence permits.
