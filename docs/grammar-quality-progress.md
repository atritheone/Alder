# Grammar quality execution record

Started 11 November 2026. **Plan incomplete; no Grammarly parity claim.**

Stopped on 12 November at the user's **20% weekly-usage limit**. All owned
inference work was stopped and partial evidence retained. The larger source-
diagnosis screen has 20/100 incumbent reviewed-text cases, with candidate and
natural phases unstarted. The control-passed Magistral evaluator has seven of
80 calibration pairs recorded; its process was stopped during the next request,
so its raw ledger still says running and must not be treated as completed. A
separate operational checkpoint records the budget interruption. No candidate
was promoted and no installation, package version, model pin or memory limit was
changed. The stopping-point run passed **167 relevant tests** (81 sentence/service,
86 evaluation-tool cases); the complete application suite was not repeated.

The user authorized work until completion or weekly usage reaches 20%, with Git
writes only to main at either stopping point. Development evidence and research
assets are held outside the checkout in the local `AlderTesting/grammar-quality`
workspace. Do not upload user manuscripts or raw logs.

Word background access now works through the ChatGPT for Word add-in: a later
discovery returned a connected session, and Office.js inserted/read back three
authored sentences in the verified blank document without mouse, keyboard, focus
or selection commands. The page also rendered through the document API. The
initial empty discovery results are retained; no application binary or permission
setting was changed. The user requires unobtrusive operation while using this PC,
so native desktop control remains off. Word's annotation query returned no
critiques; HTML/OOXML contained no Grammarly references, and the test text remained
unchanged. This establishes document access, **not actual Grammarly corrections**.
Comparator collection remains unverified. A later read-only query again found no
annotations on all three exact test sentences, with no explicit `w:noProof`
elements. Waiting did not expose corrections. The retained response is
`word-background-recheck-v2.json`; absence of annotations is not a Grammarly
decision to leave the sentences unchanged.

A lower-memory 9B IQ3 developer candidate exposed an actual source-preservation
bug: a raw revision changed the literal `<|im_end|>` to `<im_end>`, which the old
validator accepted. The validator now requires the ordered list of recognized
control literals to remain identical, rejecting deletion, mutation, invention and
reordering. Literal terms also enter the passage's protected vocabulary without
marking ordinary prose as a generated field. Five regression cases failed before
the fix; all 71 sentence-revision tests passed afterward.

The IQ3 worker's three-case production-profile probe peaked at 3.83 GiB for the
model process, compared with the earlier Q4 candidate's resource rejection. This
is not full-service or physical-16-GiB qualification. A separately registered
fourteenth configuration compares the current service on nine literal cases and
100 natural development utterances from 92 conversation groups. The literal
screen preserved all markers for both models; required grammar checks passed
8/9 for the incumbent and 6/9 for IQ3. Withheld unchanged text is not a successful
grammar correction. The natural screen and assessment completed: service checks
were 99/100 for the incumbent and 100/100 for IQ3. Reference precision/recall/F0.5
changed from .4098/.5787/.4352 to .4303/.6713/.4636, with 20 fewer missed reference
edits. All paired 95% conversation-bootstrap delta intervals crossed zero
(remaining errors: -47 to +2). IMPARA preferred IQ3/incumbent 35/28 times and SURE
38/25, with 37 ties each. Component peak sums were 5.32/5.00 GiB, but busy-host
warm p95 increased from 10.45 to 22.99 seconds. This is a possible quality/memory
trade-off with substantial latency, not a demonstrated editorial or resource
qualification. No shipping model or memory cap has changed.

A source-aligned comparator adapter now prepares controlled capture bundles and
imports declared observations with product/Word versions, settings, dates,
categories and evidence hashes. It never infers an unchanged Grammarly decision
from unchanged document text or unavailable annotations. Missing observations
remain explicitly unavailable through pair preparation and judge execution;
identical fallback strings cannot become ties. Two focused tests passed, including
that end-to-end missing-capture path. These use synthetic fixtures, not actual
Grammarly edits. Import integrity cannot authenticate the product or close the
collector/quality gates; both remain unverified.

Nine verified public-domain book snapshots now provide a separate 900-case
literary preservation diagnostic: 300 development, 300 validation and 300 sealed
test cases, with whole books/authors confined to a fold and balanced narrative/
dialogue and AU/UK/US settings. The original 837 sealed cases are unchanged.
The first import correctly refused insufficient dialogue under a double-quote-
only parser. Structural counts identified Cather's single curly quotation marks;
the separately frozen second import handles them without treating internal
apostrophes as quote boundaries. It retains the same 50-per-stratum policy.
Two focused tests passed. A prospective development diagnostic now selects 15
cases by fixed ID hash from each of the six book/dialogue-or-narrative strata
(90 cases, three source books). It uses the current incumbent service; model
outputs and scores did not determine selection. Validation and sealed literary
folds remain unqueried. These cases have no independent grammar labels and remain
explicitly ungraded document-track diagnostics; publication, unchanged output or
only three books per fold cannot pass the clean-text or general genre-quality
gates.

The completed 90-case literary diagnostic used the earlier control-literal backend:
80 service completions, ten spelling-audit withholds, 40 displayed revisions,
35 unchanged results and 15 suppressed proposals. All 90 remain editorially
ungraded. Busy-host warm p95 was 41.95 seconds and the component peak sum was
5.56 GiB; neither is reference-hardware qualification. All cases had model
responses, and the recorded model-call error inventory was empty. This is not
evidence of 40 unnecessary edits: the corpus has no independent clean labels.

Inspection exposed two further implementation defects. The audit treated the
period in an honorific as a sentence boundary, so an unchanged name after `Dr.`
or `Mr.` could still fail spelling verification. Separately, a quoted question
was split from its reporting clause; the model sometimes copied that clause
from read-only context, risking duplicate speaker text. Titles and narrow speech
tags now remain within the same sentence target, preserving UTF-16 offsets and
independent following narration. The audit recognizes unchanged names in those
tags. A conservative new guard also rejects newly introduced internal named
terms, including copied speakers, while permitting case repairs of existing
words and existing narrow lexical corrections. These heuristics are not general
entity recognition or proof of meaning preservation.

The new regressions first failed on the old behavior. All 80 sentence tests then
passed; one additional attribution-order case was subsequently added. Four fresh
authored model cases corrected three mixed dialogue/title/grammar/spelling inputs
with no duplicate speakers or warnings. A fourth, clean control was needlessly
reordered and remains a failure. The initial fixture used unsupported expectation
keys and its first report correctly left all four ungraded. A retained, separate
metadata correction converts exactly those predeclared expectations to supported
labels, verifies identical model inputs and rescored the existing outputs without
claiming another inference run. That report has three successful specified checks
and one unnecessary-change failure, not a four-case editorial pass. The 90-case
run is not silently rebound to this newer sentence-boundary implementation.
The corpus loader now rejects those unsupported expectation names and malformed
check lists before future inference; three focused schema tests passed.
A complete recorded-model integration replay of the earlier 100-case incumbent
conversation screen through the new guards retained every delivered proposal,
display decision and service status (99 completions, one retained audit failure).
No unrecorded model requests were needed. This is evidence about these guards on
that population, not another neural generation run or fresh editorial grading.

An additional public-rating review verified a 7 November Tatoeba snapshot and
required distinct non-owner current reviews, matching text-version timestamps,
structurally valid self-reported English level-5 metadata and no opposed/unsure
current vote. The broader attributed-text pool has 2,159 community-OK and two
community-not-OK sentences after filtering and exact-source deduplication. Its
positive examples have 248 declared owners and 27 reviewers, but one reviewer
appears on 87% of them. Only one positive example was created after the declared
1 April 2026 cutoff. The CC0-only review found just 38 positives. These are
experimental community labels, not expert perfect-grammar labels or sufficient
negative coverage for an approval classifier. Seven focused date, self-vote,
duplicate, attribution and snapshot-binding tests passed. No TMU labels changed.
Primary provenance and limitations are retained with the
[Tatoeba exports](https://tatoeba.org/en/downloads) and
[reuse guidance](https://en.wiki.tatoeba.org/articles/show/using-the-tatoeba-corpus).

A fixed-hash development sample selects one sentence from each of 100 declared
owners; 148 other owner groups remain unqueried by models. Attribution and exact
source hashes are retained outside Git. Locale requests are balanced, while
actual source locales remain explicitly unknown. All cases remain editorially
ungraded document-track preservation diagnostics, not a clean-text or dialect
qualification. The selected sample still has 86% reviewer overlap concentration.

The fifteenth registered pipeline asks the existing 4B generator for exact source
defect evidence or an explicit no-change branch before a complete rewrite. This
same-model diagnosis is not an independent judge. A standalone rendered worker
retains raw assessments externally and leaves the production worker unchanged;
spelling repair and explicit rephrasing bypass the gate. Two protocol/rendered-
worker tests and three grammar compilations with the pinned runtime passed. The
first frozen trial left the clean example unchanged but dropped a speaker from
one error correction; the source guard withheld it, and the failure is retained.
A second frozen prompt clarifies that evidence never narrows the target. It
passed all four authored checks, correcting three error cases completely and
leaving the clean sentence unchanged. This is development evidence only. Its
larger matched reviewed-text/natural-error screen was interrupted at the budget
limit before candidate inference or metric assessment, and cannot support a
quality or performance claim.

The additional local-rule-guidance pipeline completed its first matched 100-case
development screen using the current service. Both configurations completed 97
service checks and withheld three spelling-audit cases. ERRANT precision/recall/
F0.5 changed from .4925/.5410/.5015 to .5779/.6284/.5873: 16 additional true
positives, 18 fewer unmatched edits and 16 fewer missed reference edits. IMPARA
preferred the baseline 13 times and the candidate seven times (80 ties); SURE
preferred the baseline 12 times and the candidate eight times (80 ties). These
disagreements prohibit a simple promotion claim. Conservative component peak sums
were 5.29/5.36 GiB, with busy-host warm p95 observations of 7.26/10.75 seconds.

A compact, token-budgeted revision completed a fresh matched screen on 200
additional development utterances from 92 conversation groups absent from that
first screen. Baseline/candidate service completions were 198/199; ERRANT
precision/recall/F0.5 changed from .4016/.5154/.4202 to .4855/.5832/.5023.
The paired 95% conversation bootstrap intervals for the respective deltas were
[.0564, .1139], [.0358, .1017] and [.0558, .1111]; 33 fewer reference edits were
missed (interval: 17–49 fewer). These are reference-overlap improvements, not
editorial approval. IMPARA preferred baseline/candidate 46/23 times, SURE 42/27,
with 131 ties each. Peak component sums were 5.47/5.53 GiB and busy-host warm
p95 was 11.39/12.33 seconds. The metric disagreement and latency prevent promotion.
Post-hoc SURE axis diagnostics preferred the hints for faithfulness 53/16 (131
ties), but preferred the baseline for grammaticality 42/27 and fluency 46/23.
Conversation-bootstrap mean-score intervals crossed zero for grammar and fluency;
the faithfulness delta was positive. These uncalibrated continuous-score deltas
are diagnostics, not evidence that the semantic approval gate passed.
Optional hints are removed before rejecting an over-budget prompt; source text,
context and protected terms are preserved. No sealed or validation cases were
opened. This remains one additional registered pipeline, not a new model family.

A separate higher-reliability human stratum requires at least two agreeing raters
and no opposing vote. Its 80 calibration / 150 validation pairs span 14/25 source
essays with no document overlap or reassignment relative to the broader cohort.
Mistral again reached the order-instability futility boundary: five changes in the
first 16 planned calibration pairs already imply a minimum 6.25% final rate; a
17th in-flight pair completed. This stratum does not erase the broader failures.
The reference-assisted protocol failed a basic condition-preservation control
before calibration and was also stopped.

Two evaluation-specialized, non-Qwen research candidates are now pinned separately
from Alder: publisher Flow Judge Phi-3.5 BF16 and Selene Mini Llama-3.1 Q8 exports.
Their publisher prompt frames are verified and retained outside the repository.
The new adapter asks for bounded exact defect evidence before the native score,
with separate safety and grammar assessments; a safety failure cannot be averaged
away by fluency. The structured-feedback adaptation has its own identity and
requires fresh calibration. Twelve native grammar constructions and 45 focused
evaluation-tool tests passed; these are protocol tests, not editorial ratings.
Neither model is an Alder dependency, model replacement or memory-limit increase.

Flow's first four-control trial exposed score/evidence disagreement and abstained
on all controls. A second, separately frozen protocol couples allowed native
scores to the evidence branch during generation; it does not repair scores after
generation. All twelve revised native grammars compiled and four focused tests
passed. Flow then returned three ties and one abstention on the four controls,
mostly assigning perfect grades even to clearly defective alternatives. It is
not qualified and its human calibration fold remains unopened. Selene abstained
on all four controls because structured feedback was truncated. Removing the
generation grammar did not make Flow follow the JSON contract; all four controls
still abstained. These are separately frozen protocol trials.

A publisher-format score-only diagnostic removed the structured feedback
adaptation. It is explicitly incapable of qualifying an evaluator because exact
defect records are absent. Flow chose the correction in two controls and tied
on the plural/role controls. Selene chose the correction in the first two, but
abstained on the role/condition controls, assigning unsafe grades even to unchanged
valid source text. Neither proceeded to human calibration. A larger verified
Qwen3.5 35B-A3B Q4 developer evaluator is now preregistered; its native template
explicitly disables thinking for the JSON verdict. It cannot satisfy the separate
non-Qwen-family requirement or alter Alder's shipping memory budget.

The larger evaluator exposed a native grammar conversion defect: JSON Schema
integer minimum/maximum constraints were ignored, allowing score 100 inside the
branch that carries defect evidence. The strict decoder rejected these outputs;
no malformed assessment became an approval. The defect-score domain now explicitly
enumerates 0–99, disjoint from the perfect-score branch. Four native grammars
compiled with no unrestricted integer production, and nine relevant pointwise/
futility tests passed. A fresh fixed-protocol four-control run chose B on grammar,
roles and conditions, but tied on explicit plural preservation. It did not proceed
to human calibration. A separately frozen comparative protocol is now being checked
with the same verified weights and native nonthinking template. The earlier run
remains an interrupted protocol diagnostic, including its shutdown-related error.

The larger Qwen comparative profile passed its four basic controls, then stopped
at 34 of 80 consensus calibration pairs: five order-dependent decisions already
exceed the frozen 5% final limit (minimum 6.25%). It agreed on 22/34 completed
pairs; missing pairs remain missing, and its held-out fold is unopened. The
content-canonical non-Qwen Mistral profile passed the same controls, then stopped
at 64/80 calibration pairs with 47 correct decisions. Even perfect remaining
ratings could reach only 78.75%, below the unchanged 80% target. Its zero observed
order changes are structural and did not establish accuracy; held-out inference
was not opened. A separate bounded native-thinking Qwen protocol is a developer
diagnostic, not a qualified evaluator or a replacement for a non-Qwen judge.
That trial was interrupted after its first two-order control abstained with
server `ValueError` responses; the old log does not identify which native stage
failed. It is not a completed four-control rejection or a judgment on unseen
human pairs. Its owned server was shut down before loading another evaluator.

The next non-Qwen diagnostic uses verified first-party Magistral Small 2509 Q4
weights and the publisher's pinned `mistral-common` 1.8.5 tokenizer in a separate
developer environment. The publisher explicitly warns that the embedded GGUF
string template may be incorrect. The new bridge preserves the structured
publisher system prompt, verifies the complete 131,072-token byte vocabulary
against the GGUF and requires native `[THINK]` / `[/THINK]` boundaries. Private
generated reasoning is neither decoded nor logged; truncation or a missing native
boundary abstains. Five focused reference-tokenization/reasoning tests passed.
This is a distinct protocol requiring fresh controls and calibration, with no
application dependency, default model, memory or editorial gate change. Earlier
embedded-template Mistral results describe those specific pipelines, not a claim
that all reference-tokenized Mistral evaluators must fail.
The first-party export initially failed to load because its all-zero tokenizer
score array was typed INT32. The existing four-byte, bit-preserving metadata
repair created a separately hashed developer copy; the original is retained.
A subsequent vocabulary check identified a verification bug in the pinned
binding's 32-byte convenience buffer for long token pieces. The verifier now
retries the native API with the required buffer length, with a focused regression
test. All 131,072 complete token pieces then matched the publisher reference
hash exactly. No mismatched token mapping was allowed through to inference.
The first driver then failed identity preflight because the client did not yet
recognize the new reference-template profile; it sent no inference request. The
client now accepts that profile only with the pinned server identity, with a
focused transport test proving preflight sends no document content. Fresh
controls/calibration use the separately frozen third source archive and repaired
copy. No human held-out judgments are opened by this driver.
All four controls subsequently chose the intended correction. Calibration was
interrupted before its first human pair to prioritize a potentially faster,
fully GPU-resident evaluator; this is neither a calibration failure nor a pass.
The Magistral server was shut down and its source/configuration retained for a
content-identical resume. Each unique control took several minutes on this host.

A prospective Phi-4-reasoning-plus 14B Q4 developer trial uses verified MIT
publisher/export assets and the exact first-party mandatory system instruction.
Its native chat and thinking markers were verified as single control tokens.
The bounded reasoning phase follows the publisher's .8 temperature / 50 top-k /
.95 top-p recommendation, with seed 917; final JSON is constrained and
deterministic. This is a declared bounded-profile adaptation, not a replication
of unrestricted publisher benchmarks. Four focused sampling, framing and
identity-preflight tests passed. The new checkpoint cannot reuse the earlier
nonreasoning Phi model's calibration. Its 8.43 GiB weight file is a developer
evaluator, with no change to Alder's application memory limit or dependency pack.
The first Phi runtime profile abstained on the first two attempted controls and
was interrupted before human inference; only the reasoning stage was identified
in that log. A separately frozen profile adds fixed failure codes and token counts
without decoding generated reasoning. It uses 36 GPU layers, GPU attention and
128-token batches to preserve desktop headroom; startup left about 2 GiB VRAM
free, with an identity/readiness check before any inference. This profile change
was chosen for runtime diagnostics, not to change a human quality threshold.
It exhausted the 2,048-token reasoning budget in both orders of its first control,
then stopped without human inference. No forced native closing marker or fabricated
final verdict was inserted. That server was closed. The previously control-passed
Magistral profile resumed its unchanged 80-pair calibration with the original
frozen source, prompt, runtime identity and mathematical futility criteria.

Comparative evaluator outputs now have an explicit ranking interpretation:
validated two-order wins/ties/losses against each source sentence become
1/.5/0, while abstentions leave the corresponding source incomplete. This is a
source-anchor win rate, which may saturate; it is not an absolute grammar grade.
Before any held-out model scoring, a fixed-hash, document-balanced ranking matrix
selected 100 distinct source sentences from the existing 25 validation document
groups and all 15 systems (1,500 cells), with zero calibration-document overlap.
The consensus preference cohort's 51 distinct validation sources is unchanged.
No human winners or model scores determined the expansion. A strict display
transform initially rejected one newly identical comparison. An explicit mode
for unlabelled source-anchor matrices now retains and marks that cell as a tie;
it rejects human-labelled inputs and never discards or relabels their preferences.
Two focused comparative-ranking/display-boundary tests passed. The existing
100-source, 90%-coverage and .85-correlation requirements are unchanged, and no
ranking judgment or ranking gate has been completed for the new evaluator.

Calibration now has an optional built-in mathematical futility boundary. It stops
after both orders only when perfect remaining ratings cannot attain the frozen
80% agreement target, or observed order changes/abstentions already exceed 5%/10%
of the complete population. Missing ratings remain missing. Five relevant tests
passed, including an end-to-end runner check that stops after five biased pairs
and leaves 75 of 80 unrated. Held-out validation cannot enable this option.

The new content-canonical comparison profile freezes one source/candidate hash
ordering, caches its verdict and restores exact evidence to caller labels. It
strips model names and expected-winner fields. Structural symmetry cannot replace
human accuracy or the independent non-Qwen requirement. The earlier raw-order
failures remain intact. Focused transport tests verify both caller orders and
that cached evidence is not mutated. Separately, calibration reports now hash
their actual input pairs, ratings and evaluation code, and reject a winner that
contradicts its saved order decisions. Ranking preparation now follows the raw
source identity retained by display normalization; unmatched sources and attempts
to overwrite a frozen matrix are rejected.

A further developer-only native Qwen profile permits bounded, unlogged thinking
before final constrained JSON. It verifies the closing control token and abstains
if the native phase does not finish within budget. Three focused tests passed,
including checks that private tokens are never decoded and an unfinished phase is
not forcibly closed. This is not an evaluator qualification or a shipping runtime
change; its controls and calibration have not yet run.

The direct generation entry point now enforces the same sealed-test permit as
the experiment runner before opening inference resources. The permit binds the
corpus, selected candidate, verified full source snapshot and qualified evaluator
artifact. Source verification also recomputes the manifest identity and rejects
unlisted Python/JSON files. Four relevant checks passed, including rejection of
direct unpermitted inference before resource initialization; only synthetic test
fixtures were used. No sealed product case was opened.

The normalized comparative Mistral trial also stopped at a mathematical futility
boundary: five order changes in its first 23 of 80 planned pairs imply a minimum
6.25% final instability, above the frozen 5% limit. A 24th in-flight pair completed;
the held-out fold remains unopened. The independent pointwise and comparative
failures are distinct; presentation fixes do not establish evaluator accuracy.

A fresh current-service 9B resource screen exceeded the prospective 7 GiB cap:
the recorded conservative component peak sum reached approximately 8.4 GiB.
It was stopped after the in-flight case rather than expanded into a full natural
quality trial. This is a resource rejection on the development host, not a
physical 16 GiB qualification measurement. The 4B model and admission limit remain
unchanged. One additional development-only local-rule-guidance pipeline is now
preregistered as described in the plan; it does not change the three-family limit
or any qualification threshold.

Two subsequent raw-worker resource probes retained the same 9B weights, 4,096
context tokens, production instructions and CPU-only placement. A 128-token
batch/microbatch recorded 8,315,551,744 bytes model peak RSS; adding flash attention
recorded 8,309,702,656 bytes (about 7.74 GiB each, excluding rules/backend). These
profiles remain above the prospective total 7 GiB budget. Neither justifies a
model promotion, admission change or reference-hardware claim.

## Latest interpretation and follow-up (12 November)

The earlier generative judge trials used the benchmark's space-tokenized
sentences. Those results are retained as **tokenized-input protocol diagnostics**,
not clean natural-prose capability measurements. A new presentation tool checks
lexical-character equivalence, retains original pair hashes and transforms the
official document map consistently. Its 80 calibration / 150 validation pairs
still have zero source-document overlap. It does not normalize real learner or
user prose. SURE already detokenized internally; its published metric results
are separate from these generative-judge trials.

Independent candidate assessments removed A/B position from the model input.
Four basic controls passed, but the normalized calibration could no longer meet
the frozen 80% agreement gate after 18 pairs: 17 disagreed with human preferences,
mostly because the model assigned perfect scores to both alternatives. Even
perfect remaining ratings would reach only 78.75%. A final in-flight pair was
allowed to finish. Structural order stability does not establish accuracy.
The run was stopped without opening its held-out fold. A separate normalized
comparative protocol subsequently failed the order-instability boundary recorded
above; it has no qualification result.

The matched natural-text family screen is complete on 100 development utterances
from seven conversations. All three configurations made 100 attempts:

| Generator | Service completions | ERRANT precision / recall / F0.5 | IMPARA wins / losses / ties against Q4 | SURE wins / losses / ties against Q4 |
| --- | --- | --- | --- | --- |
| Pinned Qwen 4B Q4 | 94 | .495 / .536 / .503 | baseline | baseline |
| Phi-4 Mini Q4 | 95 | .478 / .481 / .479 | 20 / 26 / 54 | 18 / 28 / 54 |
| Ministral 3B Q4 | 93 | .216 / .273 / .226 | 32 / 28 / 40 | 27 / 33 / 40 |

Neither alternative establishes an improvement. Reference overlap can penalize
valid paraphrases, and these grammar metrics do not certify meaning. The paired
conversation interval includes no F0.5 improvement for Phi; Ministral's reference
F0.5 interval is below the baseline. Busy-host timings are not reference-hardware
qualification. The completed automated assessment resumed without rerunning
inference or metric scoring. No model pin or memory increase is justified.

The separate 300-case controlled validation completed with no specified literal
check failures: 150 correctness, 100 clean and 50 semantic cases. ERRANT measured
384 true positives, 10 false positives and 16 false negatives (F0.5 .972).
These are only six construction families; they are not 300 independent natural
language examples. This run and the larger natural validation precede the two
subsequent targeted fixes below.

Two real failures found during development now have bounded regressions:

- Unchanged internal source names such as Edu and Gaviria no longer cause the
  complete spelling audit to reject an otherwise useful edit. Only names already
  protected by the existing source-name policy are exempted, and only when their
  exact spelling remains in the proposal. Sentence-initial unfamiliar words and
  known initial/contraction misspellings remain auditable. Three paired fresh
  cases failed before this fix and completed afterward.
- A textual model stop marker could truncate corrected JSON containing the
  literal `<|im_end|>`. The worker now relies on its JSON grammar and native
  end-of-generation handling. Three fresh AU/UK/US cases preserve that literal
  and complete successfully. The other 21 document-challenge generations were
  replayed through the current service: all 24 specified checks pass, comprising
  **21 recorded-generation integration replays plus three fresh neural cases**.
  This is not a fresh 24-case editorial qualification run.

Absolute SURE approval also remains unqualified. Against the separate TMU meaning
ratings, no calibration threshold reached the preregistered 95% approval target
with required coverage; the best eligible calibration precision was 24.2%.
The policy therefore has a null threshold and grants no automatic approvals.
Human-label rebinding reused only identical source/output/model inputs, with
explicit provenance; it did not rerun the neural metric or tune on validation.
The strict unanimous-top human target must not be interpreted as proof that all
other outputs are wrong.

Word and Grammarly are installed on this Windows host. Earlier, a fresh Word launch still
failed desktop capture twice with `window capture timed out`; the user asked to
return to Word computer use later while they are busy. No comparator result is
claimed from those desktop attempts. Background Word access subsequently succeeded
as recorded above; actual Grammarly correction collection remains unverified.
The host has three 16 GiB DIMMs (48 GiB installed, about 47 GiB usable),
not a verified physical 16 GiB reference environment. Mac remains unverified by
the agreed delivery scope. Concurrent menu edits in App.tsx and Editor.tsx are
being preserved separately from the grammar changes.

## Implemented and exercised

- Overlapping spelling and sentence suggestions remain independently selectable.
  Complete sentence generation includes spelling, a bounded repair and audit.
  Real Windows hover acceptance/undo and AU/UK/US repair probes passed.
- Source-bound guards now reject explicit named active/passive role reversals,
  changed measurement/currency units and removed numeric signs. Supported unit
  spacing and regional spelling remain acceptable. These are conservative
  checks for known forms, not a general semantic parser.
- Against 200 controlled harmful mutations, the committed baseline rejected
  100; the working-copy verifier rejected 200. This is controlled coverage, not
  a measured global semantic error rate.
- A 100-document property check preserved actual citation/text-field nodes,
  moved emphasis and links, refused altered fields and restored the original
  document in one undo step. This is one parameterized property check, not
  100 independently designed scenarios.
- Developer tooling validates corpora, prevents source/family partition leakage,
  fingerprints and resumes actual service inference, records raw and delivered
  outputs, retains failures, runs blinded two-order judges, validates quotations,
  scores specialist neural metrics, calibrates against human ratings, produces
  clustered uncertainty intervals and combines qualification evidence.
- An optional grammar-evidence input is integrated into the developer release
  validator. Ordinary install/update checks are unaffected. Missing or merely
  asserted `passed` evidence cannot pass numerical qualification gates.

## Corpus and evaluation evidence so far

- SEEDA is pinned at `f1b7d88f7b1c0b5701696198800cc42266d02da5`.
  Import produced 26,175 source-aligned preference comparisons from 600 ranking
  tasks across 391 source groups. Conflicting repeated ratings from one annotator
  abstain; repeated comparisons are not counted as independent human votes.
- A consensus-focused calibration cohort and a broader cohort are frozen
  separately. Four source groups exposed during initial protocol debugging were
  excluded from the broader cohort. The broader cohort has 100 validation and
  80 calibration pairs. Main judge trials use calibration data by default.
- IMPARA-GED is pinned at `14105736845c9c97e404c2f9eb169d9ece9fea14`.
  Pairwise agreement was 95% on the consensus validation cohort (cluster bootstrap
  interval approximately 89.5–99.0%) and 85% on the broader validation cohort
  (78–92%). These pass the pairwise portion only. Its initial harmful-edit
  detection was 72.7%, demonstrating why grammar scores cannot certify meaning.
- SOME is evaluated with separate correctness, fluency and meaning submetrics.
  Its published aggregate reached 73% agreement on the broader validation cohort
  (64–81% interval), below the frozen pairwise threshold. It is not qualified.
- Older Mistral 7B and newer Ministral 3 8B protocol trials showed unstable or
  unsupported preferences and did not qualify. All raw local ratings are retained.
  A native Windows UTF-8 transport issue was fixed rather than counted as a
  language judgment. The official Ministral candidate also required a separately
  fingerprinted, bit-preserving tokenizer metadata repair; installed packs were
  not modified.
- The Qwen 9B diagnostic judge completed 80 calibration pairs: 35% agreement
  including 51.25% abstentions. Transport timeouts and invalid evidence contributed
  to failure, so this is not a pure language-capability score. It did not qualify
  and cannot be the sole authority selecting Qwen-generated text.
- The 52-case development seed completed through the real service. It includes
  24 old clarity examples without independent grading, 16 clean controls and
  12 new multi-error controls. Ungraded examples do not count as quality successes.
  A locale-sensitive `programme` example was withheld under Australian rules;
  this adverse result remains in the evidence.
- Source spelling hints produced identical delivered outputs to baseline on all
  52 seed cases. There is no evidence to enable that extra pass by default.
  A 9B generation challenger also completed the seed; comparative grading is
  separate from merely completing inference.
- A 1,300-case compositional suite has 400 development, 300 validation and 600
  sealed-test cases, balanced across three locales with 150 creative cases and
  100 protected-field controls. It has **26 independent construction families**,
  not 1,300 independent editorial examples. Entire families remain in one split.
  Natural-text qualification is still required; sealed generator tests have not
  been used to tune prompts or models.
- TMU-GFM is pinned at `e22b35502e0fcdbf79bfe2a2bc1771c7ad301786`.
  Its 4,221 graded outputs span 1,378 source groups. Zero means “Other” and is
  excluded from rating means, matching the paper. The importer derives explicitly
  labelled Pareto preferences rather than inventing direct human pairwise votes.
  SOME trained on this dataset; IMPARA-GED trained on its CoNLL-2013 source
  benchmark. These overlaps prevent using it as independent qualification for
  either scorer. No normalized source overlap was found with the broader SEEDA
  cohort.

## Subsequent measurement and implementation work

The following results remain development/diagnostic evidence. They do not promote
a model or close the overall quality gate.

| Experiment | Result and implication |
| --- | --- |
| Full SEEDA held-out sentence fold | IMPARA agreement 83.3%, 97.5% document-cluster interval 79.7–86.3%; SURE 81.1%, 76.0–85.5%. Ranking correlations were 0.925 and 0.918 across the same 149 sources. The previous calibration cohort shared essays with this fold, so these are not document-disjoint qualification results. |
| New whole-essay cohort | Frozen before the new independent judge trial: 80 calibration pairs from 16 document groups and 150 validation pairs from 33 separate groups (143 validation source sentences). IMPARA agreement 85.3%, 95% document interval 79.3–90.6%; SURE 86.7%, 80.8–92.1%. Both pass the pairwise component only. Earlier exposure and failed runs remain recorded. |
| Meaning controls | Grammar scores failed to provide reliable meaning protection. SURE's faithfulness axis reached 88% on 200 both-rewritten controls. Bidirectional NLI reached 96.5% on those controls, but only 87.5% on a fresh 200-case challenge, missing negation-scope changes. It is not a qualified general verifier. |
| Source spelling hints, larger generator, few-shot and two-stage editing | All completed the 52-case development screen. Source hints changed no delivered outputs; two stages did not establish a benefit worth their latency. Few-shot examples introduced a plural-to-singular meaning error and a comma splice. The earlier 9B screen also had verifier differences, so it is not a clean one-variable model ablation. None supports a new default. |
| Additional neural meaning veto | Matched source and pipeline on 52 seed cases: every delivered output was identical with and without the veto. Conservative component peak sums rose from 5.36 to 6.50 GiB. No demonstrated benefit justifies enabling it, even under the prospective 7 GiB allowance. |
| Controlled development population | All 400 cases ran through the real service. Fifty quantity cases were withheld when otherwise useful revisions changed `20 dollars` to `$20`. Equal-amount notation restoration fixed those cases in a clearly labelled 400-case recorded-model integration replay; this was not 400 new model inferences. |
| Targeted plurality repair | An accepted-term-only retry did not reliably keep plurals. An explicit constrained retry subsequently returned `Definitely, the reports were late.` from `Definately, the reports was late.` in fresh inference. Both attempts remain in the evidence. |
| Natural conversational development screen | On the same 100 utterances from seven conversations, reference-edit TP/FP/FN changed from 77/80/106 to 98/100/85. F0.5 rose from 0.4747 to 0.5026, with 21 fewer missed reference edits. The paired conversation-bootstrap recall difference was +1.6 to +22.4 percentage points; the precision interval included a small loss. This is an earlier verifier snapshot and a development signal, not a held-out editorial qualification. |
| Full natural-text baseline | All 864 development utterances were attempted: 844 service completions and 20 failures. All are retained in scoring. Official ERRANT reference-edit precision/recall/F0.5 were 0.4667/0.4556/0.4644. Valid paraphrases can differ from the single reference, so reference precision is not judged editorial precision. |

ErAConD supplies 1,398 MIT-licensed human-corrected utterances across 160
conversation groups, split 864/297/237 by whole conversation. Shared source
utterances are excluded before partitioning. The release does not link participants
across conversations: these are conversation groups, not 160 independently sampled
authors. Its US evaluation setting is not a claim that source dialect is annotated.
The final 237 natural cases and 600 authored cases remain sealed.

The candidate now handles a bounded set of malformed contractions and initial
misspellings without globally allowing name changes, preserves source acronyms
and CamelCase identifiers during spelling audit, and rejects explicit plural
narrowing and known negation-scope movement. Equal ordered dollar/euro amounts can
restore source notation before strict validation. A failed plural check requests
at most one retry from the original source, sharing the spelling-repair budget.
Project vocabulary, facts and protected fields still pass the final source guard.
Literal chat delimiters are escaped losslessly in document JSON.

The frozen 297-case natural validation comparison is complete. Baseline delivered
292 service completions and five failures; the candidate delivered 293 and four.
Every case returned a neural response, and failures remain in scoring. Reference
precision/recall/F0.5 changed from **0.4125/0.4408/0.4179** to
**0.4205/0.5859/0.4457**. Missed reference edits fell from 293 to 217: **76 fewer,
or 25.9%**. Across 35 conversations, the paired bootstrap recall difference was
+7.6 to +23.1 percentage points. Precision and F0.5 difference intervals still
include a regression; this does not establish higher editorial precision.
IMPARA preferred 42 candidate outputs and five baseline outputs, with 250 ties;
SURE preferred 43 and four, with 250 ties. These metrics do not qualify meaning.

The first validation attempt produced **zero neural responses** because an
evaluation-only large judge left insufficient available memory. All 297 failures
per candidate are preserved. The completed retry used the exact same source
archives after correcting infrastructure conditions. It remains diagnostic.

Bidirectional NLI rejected the same five outputs from each validation candidate,
including the harmless correction `muscian` to `musician`. Together with its
earlier semantic challenge failures and extra memory, this rules out enabling it
as a production veto on the present evidence.

The whole-essay ranking check is also complete on 143 validation source sentences
and 15 systems: IMPARA Spearman correlation **0.929**, SURE **0.943**, with full
coverage. This strengthens their grammar-ranking component, while leaving the
meaning and absolute approval requirements open.

## Additional model and approval screens

A matched-source 52-case quantization experiment compared Q4_K_M, Q6_K and BF16
of the same 4B model. All had 51 service completions and the same withheld AU
`programme` case. Conservative sums of component lifetime RSS peaks were
5.29/4.77/9.36 GiB; warm p95 was 7.47/7.84/13.03 seconds. The host was shared with
developer evaluation work. Q6's lower observed working set can depend on kernel
repacking and OS residency; it is not a guaranteed reduction. BF16 exceeds both
the prospective memory allowance and latency goal. Model pins remain unchanged.

The remaining two registered family slots are Phi-4 Mini and Ministral 3 3B.
Their verified local assets use a developer-only adapter that renders each GGUF's
native chat template with the existing production instructions, CPU profile,
decoding budget and service validators. JSON string content escapes native role
delimiters losslessly. The original Ministral export failed before inference;
a separately hashed developer copy changes only an all-zero tokenizer score-array
metadata type. Original files and failed attempts are retained. Family screens
are development evidence, not qualified defaults.

Both new family screens completed all 52 attempts with 51 service completions and
the same withheld AU spelling-audit case. Against the matched Q4 baseline, IMPARA
preferred Phi-4 Mini eight times and the baseline nine times, with 35 ties; SURE
gave the same counts. Ministral had 12 wins/15 losses/25 ties under IMPARA and
14/13/25 under SURE. Their warm p95 observations were 3.63 and 4.95 seconds, with
conservative component peak sums of 5.17 and 4.89 GiB. The matched natural-text
development comparison subsequently completed as recorded above, without evidence
to justify an immediate model swap.

Higher precision also showed limited benefit: Q6 had three wins and 49 ties under
IMPARA, and two wins/one loss/49 ties under SURE. BF16 had three wins/one loss/48
ties and two wins/two losses/48 ties, respectively. Several differences concerned
equally grammatical wording; one Q6/BF16 output preserved an introductory completed
action more explicitly. No new model pin or memory increase is justified yet.

The minimal-correction variant completed 51/52 service checks but left an obvious
mixed-error case unresolved. It had seven wins/14 losses/31 ties under IMPARA and
three wins/18 losses/31 ties under SURE. All original twelve generator/pipeline
slots have development attempts. A thirteenth rule-guidance pipeline was explicitly
preregistered in the plan and experiment manifest; additional natural-text screens
reuse those candidates.

SURE scored 4,217 unique TMU outputs for an absolute grammaticality threshold,
using source-group calibration/validation partitions. No calibration threshold
met the preregistered 95% precision and minimum approval coverage. The validation
policy therefore has no threshold and cannot approve suggestions. Unanimous human
top ratings are a strict target, not proof that all other outputs are wrong;
essay-disjoint alignment is unavailable. SOME and IMPARA cannot independently
qualify on this corpus because of known supervised training-origin overlap.

A population-only feasibility audit found a separate limitation in this strict
approval target. The 1,765 grammar validation outputs contain only 85 unanimous
top-rated positives. Even an oracle can approve at most 89 outputs at 95% point
precision, fewer than the required 100. The calibration population has 114
positives; the meaning populations have 300/203 and are not ruled out by this
necessary count condition. This does not excuse the observed calibration failures
or change any labels, thresholds or gates. The original source paper confirms
that larger ratings are better. The evaluation must add independently rated,
rights-cleared positive coverage before this grammar approval gate is attainable;
relabelling existing outputs cannot substitute for that work. The reports are
`tmu-grammar-population-feasibility-v1.json` and
`tmu-meaning-population-feasibility-v1.json` in the external evidence workspace.

Additional public-rating sources were reviewed without treating their labels as
interchangeable. [GUG](https://github.com/EducationalTestingService/gug-data)
declares noncommercial terms; no new inference corpus was prepared from it.
[CoLA](https://github.com/nyu-mll/CoLA-baselines/blob/master/acceptability_corpus/cola_public/README)
retains underlying publication copyrights. The
[Syntactic Acceptability Dataset](https://github.com/tjuzek/sad) dedicates its
ratings/arrangement to CC0, but explicitly retains the quoted sentences' original
copyrights; its pinned preview is retained externally for source review only,
with no model inference or approval labels prepared. Neither repository's code
licence establishes unrestricted rights in those quoted sentences.

[GMEG](https://github.com/grammarly/GMEG) provides eight-rater mean correctness
scores and broader native-writing coverage. Its paper describes a meaning-change
checkbox, but the published Wiki segment-score files do not expose that axis.
A labels-only review of each official split found 7,840 rated system entries and
96 missing cells, with zero mean-100 entries even before output deduplication.
It therefore cannot supply this strict perfect-score population without a new
label protocol. Lower continuous scores are not proof of incorrect writing.
Yahoo access requires a separate research-data process, which was not attempted;
article licensing was not assumed to cover the dataset. No GMEG source text or
model inputs were downloaded, and no old gate was retroactively passed.

An isolated, verified CUDA developer runtime makes larger local judge evaluation
practical on the host's RTX 4070 SUPER. It adds no application dependency. Native
Phi-4 14B completed 80 calibration pairs with **66.25% agreement**, **15%
abstentions** and **12.5% order instability**. It failed the frozen criteria, so
its held-out fold was not opened. Native gpt-oss was stopped after 28 of the
planned 80 calibration pairs. It already had six order changes: even perfect
remaining results leave a minimum 7.5% final instability, above the frozen 5%
limit. The completed prefix agreed with humans on 12/28 pairs; unattempted pairs
remain missing in the full-population report, rather than being described as
language judgments. Its held-out fold was not opened. A
JSON-schema enum escaping failure with ASCII quotation marks was recorded in an
interrupted run; the new frozen protocol uses representable exact interior spans
without normalizing the source, and abstains when no such span is available.

A separately verified Mistral Small 3.2 24B developer judge now uses its embedded
native chat template, with an identity-bound template hash and lossless escaping
of document role delimiters. Four protocol controls passed in both orders;
calibration subsequently failed as recorded above. Neither this larger evaluator nor its isolated CUDA
runtime is a proposed Alder application dependency or memory-budget increase.

The combined corpus inventory preserves both existing child partitions: 2,698
cases across 186 construction/conversation groups, including 837 still-sealed
cases. Shared authors across conversations cannot be audited from the published
release. A separate 24-attempt/eight-construction development challenge adds
literal chat tokens, hostile read-only context, quoted accepted vocabulary,
Unicode offsets, URLs and fields without altering the sealed set.

`assess.py` automates source/model/corpus-bound population checks, literal and
resource audits, optional reference metrics and IMPARA/SURE preferences. It
verifies local metric assets and environment identity, records each successful
step, and reuses unchanged results on resume. Changed or unrecorded outputs fail
closed. Its JSON/HTML report remains diagnostic and retains the incumbent;
grammar metric preferences cannot replace the missing editorial qualification.

New independent local model judging uses native Harmony and a separately verified
gpt-oss checkpoint. Protocol parsing failures and an early calibration prefix
with missing evidence are retained as failed/interrupted trials. The revised
schema requires an exact defect quote for a decisive verdict without forcing
defects for ties. Readiness/identity preflight precedes judging, both orders are
saved together, source changes invalidate evidence, and stop files preserve
resumable completed pairs. Calibration success has not yet been established.

Inference audits distinguish completed attempts from service successes and keep
row-level memory maxima after a no-work resume. Reference comparisons require
identical populations and bootstrap by conversation/document. Qualification will
not upgrade an explicitly unverified artifact merely because its numbers fit.
The prospective v2 7 GiB allowance leaves all quality, latency and physical 16 GiB
hardware requirements intact; existing model/dependency pins remain unchanged.

The targeted sentence-service/evaluation run passed 91 tests; subsequent
assessment-resume, source-binding and approval-policy checks passed individually.
On 12 November a fresh run of exactly `test_sentence_revisions.py` and
`test_grammar_evaluation.py` initially passed all 140 tests. Following the dialogue,
name, ranking and corpus-schema changes, the same two relevant files passed all
158 tests (81 sentence/service and 77 evaluation-tool cases). This includes the
new control-literal, reference-tokenizer, complete-token-buffer,
identity-preflight, source-boundary and reporting-clause regressions.
The full regression suite has not been repeated following the user's instruction
to run only relevant tests when necessary. Earlier Windows desktop evidence
includes independent overlapping choices, whole/word acceptance and one-step undo.

## Work still required

1. Finish evaluator calibration, ranking correlation, semantic challenge testing,
   independence checks and uncertainty/coverage qualification. A pairwise pass
   alone cannot close this gate. Qualify alternatives if current candidates fail.
2. Complete natural-text corpus/reference metrics and document/genre/dialect
   coverage, with rights and training-overlap records. Controlled expansion must
   not substitute for independent natural examples.
3. Run the bounded pipeline/model experiments using qualified measurement,
   validation and a sealed qualification run. Retain the incumbent if evidence
   is insufficient; adapter training is conditional on a demonstrated deficit.
4. Complete actual comparator collection if permitted product access supports it.
   A writing score or one public rewrite is not a Word/Grammarly comparison.
5. Qualify the final deployed configuration, offline interaction and resource
   limits. The present host has 48 GiB installed RAM (about 47 GiB usable); it is not the specified
   physical 16 GiB reference machine. Mac remains unverified by agreed scope.
6. Freeze and review the complete evidence report, then commit/push on main only
   when the plan is complete or the weekly 20% stopping condition is reached.

All provisional results above are development measurements. Current overall
qualification remains **unverified** and no candidate has been promoted.
