# Grammar quality and autonomous evaluation

Plan created 11 November 2026 for the Alder 0.13 development checkout.

**Execution stopped at the user's request on 13 November 2026.** The plan is
incomplete; retained research does not establish Grammarly parity or authorize
model promotion. See `grammar-quality-progress.md` for the final checkpoint.

## Objective and current boundary

Prospective evaluator fallback, 13 November: reuse the already verified official
Phi-4 Q5_K weights for one plain-instruction, grammar-aware/contextual profile.
Use the native Phi frame, fixed per-request state and seed, canonical candidate
ordering, 28 GPU layers, F16 GPU KV, 4,096 context tokens, 128-token batches and
four threads. Preserve the earlier source-only/raw-order Phi results. This
bounded test adds no download or shipping dependency. Run ten fresh readiness
controls, stopping at the first failure; only all ten passing permits the
original 80-pair calibration. Calibration must pass the existing gates before
the original 150-pair held-out validation; semantic and fixed 190-source ranking
checks remain conditional on earlier gates. Keep at least 6 GiB system RAM and
1 GiB VRAM available. The whole Phi family is one vote, including reasoning
variants. Do not inspect sealed product cases or tune this profile on validation.

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

Later 12 November evaluator protocol: the first Phi-4 reasoning readiness probe
exhausted its 2,048-token private-phase bound without a final verdict. A new,
separately frozen profile may use 8,192 context tokens, at most 6,144 reasoning
tokens, the same publisher system prompt/sampling and a 870-second cooperative
request deadline (900-second client deadline). This remains a bounded adaptation,
not the publisher's unrestricted benchmark configuration. The publisher documents
longer reasoning allowances; test the same four readiness controls before any
human calibration and keep all earlier failures. Native closure must occur
naturally; never decode/log private generated content or force an answer. A
responsive, single-inference transport pauses on infrastructure unavailability
and retains the current abstention, preventing one expired request from making
untouched subsequent pairs appear to have model verdicts. This changes no
agreement, ranking, semantic, coverage or independent-family acceptance gate.

A subsequent resource profile may put the same Phi-4 weights fully on the GPU,
using Q8_0 K/V cache and GPU flash attention to preserve desktop VRAM headroom.
The 8,192-context/6,144-reasoning-token bounds, publisher prompt, sampling and
quality gates stay fixed. This is a separate numerical/runtime configuration:
repeat readiness and calibration, preserve the partial F16-cache profile, and
never reuse its verdicts as if they came from the new profile. Check physical
VRAM headroom before inference and stop the resource probe if it cannot leave
at least 1 GiB free. There is no shipping runtime or memory-budget change.

The full-GPU Q8-cache resource probe failed that headroom test before inference.
A new resource profile may use Q4_0 K/V cache with the same model, context,
reasoning allowance and 1 GiB desktop reserve; its changed numerical precision
requires fresh readiness and calibration. No previous verdict can be reused.
All subsequent sampled profiles must reset context and seed for each uncached
request, explicitly seed final completion and disable implicit min-p filtering.
The pinned runtime otherwise advances its internal seed after completion, which
prevents a partial sampled session from being resumed by merely restarting the
server with the original initial seed. Verify a public readiness verdict across
a server restart before beginning calibration. Keep the earlier interrupted
session and all resource failures. These changes do not force native closure or
change any human-agreement, coverage, ranking or semantic target.

Evaluation-input correction, 12 November: the published human reviewers had
surrounding source text, whereas previous local comparisons supplied only the
target sentence. Preserve all source-only outcomes and introduce an explicit new
presentation with the previous/current/next original sentences from the same
physical essay. Verify the official source inventory, displayed lexical content,
pair identity and both published system outputs before adding context. Keep all
230 comparison identities, labels and folds; never include corrected neighbours
or edit-validity annotations. This declared three-sentence window is not claimed
to reproduce every human review window exactly. Fresh calibration is required;
no source-only responses may be reused. The frozen stable-seed Phi profile may
retain its passed readiness/restart controls. A separately frozen CPU Mistral
profile must repeat readiness before calibration, leave at least 6 GiB system RAM
available and run below normal priority. No held-out inference follows unless
calibration passes. These input/runtime corrections change no acceptance gate.

The older GPT-OSS adapter also receives token-ID-only private-phase handling,
fixed request state, responsive transport and the same content-canonical ordering
protocol. Its original raw-order failures remain intact. A new profile may repeat
readiness and context calibration with the existing weights, low reasoning effort,
an 8,192-token context and a 2,048-token native allowance. Require native final
headers; never decode the private body, force closure or reuse prior verdicts.
This is evaluator tooling, with no installed-model or generator-budget change.

Prospective hosted-evaluator protocol, 12 November: the user confirmed existing
OpenAI API access and an existing local credential, then stated that only US$54
is available and the balance also funds a daily scripting task. No paid inference
has run during preparation. The proposed first check is therefore limited to
**US$0.15 total**, requiring explicit approval before execution. Use only
`gpt-6-luna`, medium reasoning, at most 2,048 counted input tokens and 2,048 total
output/reasoning tokens, with full untruncated inputs and no tools. The
[published standard prices](https://developers.openai.com/api/docs/pricing) are
US$0.10/US$0.50 per million input/output tokens. Reserve each request using the
input-count endpoint, an additional 256 input tokens, the maximum published
cache-write input rate, and the entire output limit before paid inference.
Unknown charges retain their reservation; no automatic retries or paid fallback
model are allowed. A shared on-disk cap must reject a request before it can
exceed the approved allowance. This is conservative accounting, not an invoice.

The first permit contains only four authored readiness controls and the original
80 human calibration pairs. No manuscript, validation, ranking or sealed input
is authorized. Use the same blinded rubric and original context, exact-quote
public evidence, content-canonical ordering/cache and mathematical futility
criteria. Both caller orders are saved; cache symmetry is structural. Cache
bounded model failures as abstentions so swapping order does not trigger another
paid retry. Request `store:false`, save only public verdicts/usage metadata and
never inspect/log private output items or credentials. The existing key is read
in memory without creating, copying or persisting a new secret.

The provider exposes a published model ID rather than downloadable weights or an
immutable dated snapshot. Record that limitation explicitly; pin the model ID,
returned model, request profile, source and rubric hashes instead of inventing a
weight checksum. The original statistical, semantic, coverage and independent-
family gates remain unchanged. This would establish one OpenAI family at most,
and never qualifies Alder's local generator by itself. Any broader paid run
requires a separately approved allowance; the daily scripting balance is not
available for unrestricted grammar experiments.

After the concurrent CPU Mistral load failed its desktop-RAM reserve, a queued
profile may use the existing developer GPU runtime with 24 offloaded layers,
CPU K/V attention, 8,192 context tokens and the unchanged non-reasoning native
template. It must wait for preceding judge/generator study processes to exit,
leave at least 6 GiB system RAM and 1 GiB VRAM free, and repeat all readiness and
calibration judgments. No CPU, old-context or prior offload verdict is reused.
The 24-layer/8,192-context profile later crossed the VRAM reserve during
calibration. Vocabulary-only rendering found maximum inputs of 988 calibration
and 1,002 validation tokens, with no generation or quality scoring. A new profile
therefore uses 22 GPU layers, 4,096 context tokens and 128-token batches, retaining
the complete original context and the same RAM/VRAM reserves. Repeat readiness
and calibration; the old 20-pair prefix is retained, not reused as new evidence.

After these context-aware comparative profiles fail calibration, the existing
Qwen3.5-35B-A3B developer weights may receive the same corrected original context,
content-canonical ordering and fixed request state. Retain its original native
non-thinking template, ten GPU layers, CPU K/V, 4,096-token context and 128-token
batches; use four batch threads and the responsive transport. Run sequentially
after the edit-validity study, require 6 GiB available RAM and 1 GiB free VRAM,
and repeat four readiness controls before the unchanged 80-pair calibration.
No old verdicts, new weights, held-out inference or acceptance-gate relaxation
are permitted by this amendment. This same-family evaluator cannot provide the
required independent non-Qwen judgment even if it passes.

Prospective evidence-order ablation: the non-thinking Mistral context profile
may instead generate the same brief, exact-quote public defect findings before
its verdict. The existing schema emits the winner first, which may encourage a
premature choice. Use at most two findings across both candidates, then the same
A/B/tie/abstain judgment; never require an invented defect for clean alternatives.
Keep each quote bound to its candidate and validate losing-candidate evidence
after decoding. This is public editorial evidence, not a reasoning transcript.
Freeze the distinct prompt/schema identity and 650-token final limit before
running four readiness controls and fresh 80-pair calibration. Use the same
22-layer/4,096-context/128-batch/CPU-KV resource profile sequentially after other
studies. Preserve prior winner-first failures; change no acceptance gate, expose
no held-out fold on failure, and reuse no earlier responses.

Prospective rubric diagnosis: already-exposed calibration findings sometimes
classify repairing a malformed generic noun as changing an established count.
The separate `--grammar-aware` rubric may distinguish required grammatical
changes from facts established by source/context, and evaluate negation scope
rather than negative-word counts. Retain the original rubric and outcomes; never
rewrite human preferences or waive fact-preservation requirements. Require ten
authored readiness controls including explicit counts, event time, generic noun
repair and negation scope before fresh 80-pair calibration, using the original
verdict-first schema and unchanged 450-token final limit. Run sequentially with
the existing Mistral weights and 22-layer/4,096-context/128-batch/CPU-KV profile.
No held-out or paid calls are authorized by this amendment. A demonstrably
confounded original-rubric study may pause after its current complete pair; retain
its partial evidence as incomplete rather than claiming mathematical rejection.
The existing Qwen 35B non-thinking profile may independently repeat those ten
controls after Mistral exits, and proceed to calibration only if its own controls
all pass. A Mistral readiness failure does not establish a different model's
capability. Use ten GPU layers and the unchanged 4,096-context,
128-batch, CPU-KV profile with the same reserves. Its selected instruction and
source identity must be distinct from original-rubric trials. This same-family
judge still cannot replace the independent non-Qwen requirement.
The same repair-aware instruction may also be tested with the existing native
GPT-OSS profile after Qwen exits: 16 GPU layers, CPU KV, 8,192 context, low
reasoning effort and 2,048 native private-phase tokens, with the prior deadline,
token-ID-only handling and reserves. Bind the distinct instruction/source
identity, require all ten controls before fresh calibration, and retain the
original-rubric outcomes. No newly downloaded evaluator or paid calls are needed.

Subsequent independent-family amendment: after the revised GPT-OSS profile fails
calibration, evaluate Google's first-party **Gemma 4 26B A4B QAT Q4_0** as one
additional local judge. The official export is Apache-2.0 and ungated; retain its
published revision, SHA-256, model card and exact instruction-template hash.
Use native explicit non-thinking framing (including the publisher's empty
thought block), grammar-aware-v1, deterministic constrained public JSON,
ten GPU layers, CPU KV, 4,096 context, 128-token batches and the existing desktop
reserves. Run only after the Qwen validation process exits. Require ten controls
before the unchanged 80-pair calibration. Keep unknown pretraining overlap
explicit and do not treat broad model benchmarks as grammar qualification.
[Official QAT formats](https://ai.google.dev/gemma/docs/core#quantization-aware-training-qat),
[thinking formats](https://ai.google.dev/gemma/docs/capabilities/thinking).

Register one additional generator configuration, **21: Gemma 4 E4B QAT Q4_0**,
bringing the declared generator/helper-family inventory to seven. This is a
bounded resource-first extension beyond the previous 20 screens, based on a
newly verified first-party format/family. Use the exact publisher template with
thinking disabled and the existing production instructions, CPU/context/sampler
profile, service guards and spelling audit. Its 5.15 GB file size is not an
application-memory measurement. Run one complete-service probe after the judge
study; only a verified conservative peak at most 7 GiB permits a fresh matched
52-case development screen. Otherwise stop this profile before the broad screen.
This adds no installed dependency, default-model change or memory increase.
A same-family Gemma judge cannot be the sole authority promoting E4B.

After its 52-case screen, E4B fits the prospective 7 GiB development ceiling and
has lower observed latency, but diagnostic quality preferences are mostly tied.
Permit one additional matched **100-case natural development** screen of this
same configuration against a fresh incumbent baseline. Use the existing frozen
`iq3-natural-100-v1` population (92 conversations), exact same backend/model/
template/decoder and 7 GiB ceiling, without prompt or threshold search. This
population overlaps earlier development studies; it is not a new independent
replication. Measure complete-service results, ERRANT/reference precision,
recall and remaining errors, conversation-paired intervals and existing diagnostic
QE preferences. Do not rerun the passed resource/52-case probes, expose validation
or sealed inputs, add a new configuration, change shipping memory, or promote a
model from this screen. Run sequentially after the larger judge job releases
resources. Further advancement still requires qualified independent evaluation.

Held-out stopping amendment, declared before inspecting provisional validation
agreement: a separate frozen watcher may stop a human-validation trial only when
even perfect remaining outcomes cannot reach the existing 80% agreement gate,
or observed abstentions/order changes already exceed 10%/5% of the full locked
population. Reconstruct both saved public responses and verify source/pair/model
identities before applying a bound. Missing cases remain missing; no partial
trial can pass and no confidence interval is replaced by this rule. Keep the
calibrated server, prompts and decoding unchanged. This rejects impossible
qualifications; it supplies no permission to tune on held-out case verdicts.

Bounded thinking fallback: the earlier Qwen 35B thinking readiness failure used
greedy decoding and a 1,536-token allowance. The pinned publisher card supplies
sampled alternatives. If the frozen non-thinking profile fails complete
held-out qualification, test one separate local profile using the published
precise-coding sampler as an editorial-task adaptation: temperature .6, top-p .95,
top-k 20, min-p 0, repeat penalty 1 and zero frequency/presence penalties.
[Publisher settings](https://huggingface.co/Qwen/Qwen3.5-35B-A3B#best-practices).
Retain fixed per-request state/seed, native token-only private handling and
natural closure; allow at most 6,144 thinking tokens within 8,192 context, with a
1,170-second native deadline and longer client/driver deadlines. The publisher
recommends longer unrestricted allowances; this bounded probe is not its full
benchmark profile. Run sequentially after the Gemma resource/screen study with
the same ten-layer/CPU-KV/batch-128/thread-4/reserve profile. Require all ten
ordered readiness controls and stop at the first readiness failure; otherwise
repeat the unchanged 80-pair calibration. No held-out, paid or generator calls
are authorized by this fallback. It remains the same Qwen family, not a new
independent judge, and it changes no existing non-thinking profile.

The earlier Magistral run was rejected by transport failures while identity
requests waited behind inference. A distinct corrected profile may repeat
readiness and context calibration using the already verified publisher-reference
tokenizer and repaired Q4 weights, responsive transport, fixed request state and
content-canonical ordering. Retain a 2,048-token native thinking bound, 4,096
context, 22 GPU layers, CPU K/V, 128-token batches and four threads. Allow a
1,170-second cooperative native deadline, 1,200-second client timeout and
1,230-second driver timeout so one slow native request cannot make subsequent
identity reads fail. Require natural native thinking closure; decode/log no
private content. Run after the other studies with the same 6 GiB RAM/1 GiB VRAM
reserves, fresh four-control readiness and unchanged calibration futility gates.
This corrects transport, context and reproducibility; it does not reuse the old
16-pair prefix or assert intrinsic language improvement.

Proposed evaluator acceptance gates, fixed before the calibration run:

- At least 80% pairwise agreement on held-out, decisive human-rated pairs, with
  the lower document-cluster bootstrap 95% bound above 75%; report ties separately.
- Spearman system-ranking correlation at least 0.85 on the held-out ranking slice.
  This supplements sentence agreement and cannot replace it.

Before any comparative ranking inference, freeze a peer-ranking protocol on the
same 100 sources and 25 held-out documents as the unqueried source-anchor matrix.
A source-anchor star can saturate when many editors beat an erroneous original;
it does not adequately distinguish competing corrections. Use a single fixed
SHA-256-ordered cycle of all 15 systems for each source, giving every system two
peer comparisons and retaining 1,500 comparisons overall. No seed search,
outcome-dependent opponents, source reselection or document reassignment is used.
Attach verified original context and keep model/system names out of judge input.
Validate both saved orders/quotes, and compare model versus human TrueSkill ranks
on the same complete sources. Preserve the original >=100 complete-source,
>=90% coverage and >=.85 Spearman requirements. Keep earlier source-anchor data
and metric reports separate. This ranking is still neither absolute edit approval
nor full-sentence correctness. Calibration and held-out pairwise gates precede
model inference on this matrix.

Before the first peer-ranking inference, freeze a rejection-only source-coverage
watcher. Reconstruct each observed comparison from its exact pair hash and both
saved public responses. A source with an observed abstention cannot become a
complete matched source in that run. Assume every unqueried comparison succeeds;
stop normally only if even that optimistic remainder leaves fewer than 100
complete sources or less than 90% source coverage. Do not estimate final ranking
correlation from partial results, qualify a partial run, retry adverse judgments
or change the source population. This changes no model, inference profile or gate.

Ranking eligibility repair, 12 November: the first 100-source Gemma run stopped
after a real abstention made 100 complete sources impossible. A subsequent
source-ID audit also found that only 27 of its 100 sources had published human
system-ranking labels. Model and human ranks must use exactly the same sources;
unrated sources cannot count toward matched coverage. The existing pairwise
calibration/validation populations are unaffected: all 36/51 source identities
in those folds match the published human judgments.

Retain the original failed diagnostic, and freeze one full eligibility repair
for every judge: **all 190 published human-ranked sources in the same 25 locked
validation document groups**, with the same 15-system hash cycles (2,850 pairs).
Do not filter by human ranks, model decisions, sentence length, output quality or
availability. No further outcome-dependent population expansion is permitted.
Keep every original human-eligible pair byte-identical. Exclude original unrated
sources only because they lack gold rankings, retaining their diagnostic records.
Source-bound reuse may retain earlier judgments from the exact same frozen
profile; verify both public responses, the full old fingerprint and unchanged
pair/configuration/source identity. Never retry or discard the original known
abstention. A fresh readiness check precedes resumed inference after restart.
The >=100 complete matched-source, >=90% coverage, >=.85 correlation, human
agreement, semantic and independent-family thresholds remain unchanged. This is
a prospective repaired population, not a retrospective pass for the original run.

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

Prospective edit-validity component protocol, 12 November: the separately imported
SEEDA labels test unanimous acceptance of every proposed edit, not complete-
sentence correctness. Preserve the earlier TMU full-sentence protocol and its
failed coverage/quality results. Test a separate developer-only SURE acceptance
policy against the strict two-annotator SEEDA population, with official duplicate-
linked essay folds. Its calibration population has only 88 positive cases, so
the old 100-calibration-approval fit rule is mathematically unavailable. The new
task uses at least 60 calibration approvals across 25 sources and 10 essays at
95% unanimous-edit agreement to fit a policy. This does not change the held-out
target: at least 100 approvals across 35 sources and 20 essays at 95% agreement.
Report whole-essay bootstrap bounds, missing scores and every nonpositive label.

Freeze a 25-policy search before scoring: conjunctive SURE grammaticality and
faithfulness cutoffs at each calibration score distribution's 0th, 10th, 20th,
30th and 40th percentiles. Choose the eligible policy with greatest calibration
coverage, then agreement, then the two cutoff values to break ties. Do not inspect
validation outcomes until the policy is saved; if no calibration policy qualifies,
stop without validation analysis. No other features, thresholds or label repairs
are tried under this protocol. The component can qualify only edit-acceptance
agreement on this domain. It cannot qualify full-sentence quality, critical meaning,
voice, dialect, the independent comparative judges or a production scorer. All
assets and fitted state remain outside the application and repository.

The SURE-only policy failed calibration (maximum agreement .8852 at the required
coverage); validation outcomes remain unanalyzed. A separate, prospectively frozen
Mistral component may measure the native next-token YES-minus-NO logit for the
specific question whether every edit is acceptable. Use the existing pinned
non-reasoning Small 3.2 weights, native template, 4,096 context tokens, 22 GPU
layers, CPU attention and 128-token batches. Recover original annotation context
identities, clip windows to physical essays and mark each target by its position
in the sentence list. Include every recovered window; never guess context,
repair labels or expose human ratings/system names to the classifier.

This component generates no text and never treats a raw model score as truth.
Score calibration only first; fit a single cutoff from its 0th/10th/20th/30th/40th
score percentiles using the same 60-approval/25-source/10-essay/95% fit requirement.
Choose greatest coverage, then agreement, then cutoff. Require a saved, recomputed
calibration-only policy before any validation model access. The held-out target
remains 100 approvals, 35 sources, 20 essays and 95% unanimous-edit agreement.
Preserve the failed SURE protocol and all original full-sentence gates. This is a
developer-only edit-validity component, not a replacement for comparative,
semantic, completeness, voice, dialect or production qualification.

After both individual edit-validity scorers fail, a separate calibration-only
fusion diagnostic may test their complementary signals without more inference.
Verify that the independently fingerprinted SURE and Mistral records describe
the same source, proposal, human labels and essay folds. Freeze 25 conjunctive
policies: five native-margin cutoffs crossed with five SURE cutoff pairs, each
at 0/10/20/30/40 calibration percentiles. Each SURE pair uses that percentile
for both grammaticality and faithfulness. Preserve all failures/missing scores;
require the same 60 approvals/25 sources/10 essays/95% agreement. Choose greatest
coverage, then agreement, then cutoffs. Do not analyze validation outcomes or
authorize validation inference under an individual scorer's failed policy.
Any qualifying fusion would need its own frozen validation-access implementation
and the unchanged 100-approval/35-source/20-essay/95% held-out gate. This is a
new component diagnostic, not a retroactive pass for either failed scorer.

Prospective configuration 18 checks a larger member of the already tested
Ministral family: the existing publisher 8B Q4_K_M weights, with the separately
verified four-byte zero-score metadata repair already retained in the developer
workspace. No download or additional family is needed. First run one authored
complete-service CPU resource probe with the production prompt, native template,
spelling audit and validators. Reject before broader inference if the conservative
sum of component lifetime RSS peaks exceeds 7 GiB, or reserve monitoring fails.
Only a fitting configuration proceeds to fresh baseline/candidate runs on the
same 52-case development seed; assess resources, reference and existing diagnostic
metrics, with no promotion from these screens. Wait for large judge jobs to exit
and keep the 6 GiB system reserve. This adds one bounded configuration (18 total),
retains four generator/helper families and changes no quality or latency gate.

Prospective configuration 19 is a research-only specialization benchmark with
the pinned `grammarly/coedit-large` revision already recorded in model review.
Its CC-BY-NC-4.0 weights remain excluded from the unrestricted shipping-pack
search. This separate benchmark does not establish production eligibility.
Download only verified safetensors and tokenizer/configuration assets into the
external research workspace; execute no checkpoint code. Use the publisher's
grammatical-error-correction task prefix, deterministic greedy decoding, a
512-token untruncated input limit, 256-token output limit, float32 CPU execution
and four threads. It is a task-specific generator rather than the production
LLM prompt; it does not implement paragraph-context or dialect conditioning.
Keep all service source guards and spelling audits, and report those limitations.
Run one complete-service resource probe first, then a fresh matched 52-case seed
screen only if the conservative component peak is at most 7 GiB. Any subsequent
natural-text screen requires a separately declared protocol. This adds a fifth
research generator/helper family and a nineteenth bounded configuration without
changing installed assets, shipping model eligibility or any qualification gate.

Prospective configuration 20 is the final additional task-specialization screen:
the publisher's Q4_K_M GRMR-V3-Q4B export at
`3e8a0b2beb1ab373baee873ba9498ebbbef5aa02`. The original model review's unresolved
training-source audit and production exclusion remain intact. Use its documented
text/corrected delimiters, not an assumed instruction-chat template. Reject
inputs containing these reserved delimiters, retain the full untruncated source,
and use a 4,096-token CPU context with four threads, a 1,100-token output ceiling,
fixed per-request seed 917 and the publisher's prominently recommended sampler:
temperature .7, top-p .95, top-k 40, min-p .01, repetition penalty 1 and zero
frequency/presence penalties. The lower-temperature usage example is a conflicting
example, not a second search configuration. Never generate or decode a thinking
channel. As with configuration 19, this task generator has no context, locale
or creative conditioning; retain all service guards and spelling audits. Check
one complete-service resource probe before a fresh matched 52-case seed screen,
with the same 7 GiB ceiling, reserves and development-only restriction. This
brings the bounded research search to 20 configurations and six explicitly named
generator/helper families. No validation, sealed inference, installation or
production eligibility follows from this research benchmark.

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

Later 12 November amendment: allow one task-specialized tagging helper experiment
(16 configurations, with RoBERTa as a fourth generator/helper family). The earlier
task-specialized checkpoints were excluded by their source/weight terms. A pinned
DeepQuill GECToR export declares Apache-2.0 weights and commercial-use synthetic/
public-domain training sources. Inspect and retain those source notices separately;
this declaration does not itself qualify redistribution or accuracy. First probe
the local CPU runtime and tag/offset alignment on authored examples. If viable,
supply its high-confidence local edits as fallible hints to the existing 4B
sentence editor, keeping all complete-service audits and source guards. Use the
publisher's 0.6 detection/tag thresholds, with case-only tags excluded, without
tuning them on held-out text. Record the helper's memory and time as part of the
complete pipeline. Stop the configuration if the resource probe fails; do not
silently replace it with another model or expand the search. No installed pack,
memory ceiling, quality gate, evaluator rule or sealed-test partition changes.

After completing configuration 15, allow one conditional combination (17 total,
still four generator/helper families). On its 100-case natural development
screen, source diagnosis raised reference precision by 12.8 percentage points
but reduced recall by 8.3 points; both conversation-cluster intervals exclude
zero, and it left 18 more reference errors. Test existing rule-guided complete
revision when the source has usable local spelling/grammar/punctuation hints,
and source diagnosis when it has none. Style-only flags never select the first
path. The hints remain fallible and the complete output still passes the same
source guards and spelling audit. No additional model or generation pass is
introduced. Freeze the routing policy before inference; first check authored
regressions, then the same reviewed-text and natural development populations.
Reuse baseline outputs only after strict configuration-bound current-service
replay proves delivered equivalence. Existing independent quality, completeness,
runtime and sealed-test gates remain unchanged; do not promote from this screen.

After configuration 17's first 100 natural utterances, the remaining-error
interval still includes both a benefit and a regression. Evaluate this same
frozen candidate and a fresh matched baseline on the existing additional 200
development utterances from 92 conversations.
Those cases were previously used for configuration 13 development and are not a
new held-out qualification population. Preserve that exposure in the report.
This adds no configuration, threshold adjustment or sealed access. Record all
failed/withheld cases, full service memory/time and independent metric disagreement.
Selection-description correction after the run: this population was disjoint from
the earlier configuration-13 screen, but the configuration-17 first screen used
its 100-case IQ3 subset. The expanded set therefore includes all previous 100
cases and adds 100 utterances within the same 92 conversations. Keep the frozen
200-case population and its adverse results; do not reselect or claim an
independent replication or a pooled 300-case sample.

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
