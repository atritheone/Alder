# Developer grammar qualification

These tools never install, update or publish Alder. Generated corpora, reports,
downloaded weights, virtual environments and caches belong outside the checkout.
They do not send manuscripts to cloud services. The judge client accepts only
an explicitly identified loopback service; runtime scoring uses verified local
weights with remote-code loading disabled.

## Entry points

- `corpus.py`: validate schema, rights declarations, unique ids, locales and
  source/family partition isolation; produce a hash and coverage inventory.
- `make_seed.py`: reproduce the 52-case development seed. Its old clarity cases
  have no independent grading and are reported as ungraded, never successes.
- `make_stress_corpus.py`: produce 1,300 controlled cases from 26 construction
  families. The 400/300/600 partitions keep whole families together. These are
  compositional regressions, not 1,300 independent editorial samples. Additional
  natural-text benchmarks are required for quality claims. The document controls
  include protected ranges; a text-only service run does not prove rich-document
  application safety.
- `make_document_challenge.py`: 24 development attempts across eight literal-token,
  context, quotation, Unicode, URL and field constructions. This remains a small
  adversarial challenge, separate from the sealed corpus. Intentional quoted
  misspellings use explicit accepted vocabulary; no general quotation protection
  is inferred from that fixture.
- `import_preservation.py` and `preservation-sources.json`: verify nine external
  public-domain book snapshots and freeze 900 literary preservation diagnostics,
  balanced across dialogue/narrative and AU/UK/US settings. Whole books/authors
  occupy one fold; exact cross-book duplicates are excluded. Only typeset wrapping
  is normalized, with lexical characters checked. These are document-track,
  explicitly ungraded cases, not 900 independently labelled clean sentences or
  contemporary dialect gold. Three books per fold limit genre claims. Import
  requires an existing developer spaCy installation; it never downloads text,
  tokenizers or models. Raw books and their notices stay outside the checkout.
- `generate.py`: run the actual proofreading service, preserving original/context
  offsets, protected ranges and source guards. Failed and suppressed results count
  as unchanged text. Resume requires the same corpus, source, tools, resources and
  configuration fingerprints. Results are appended and flushed after each case.
- `freeze.py` and `run.py`: verify external implementation snapshots and run a
  bounded experiment registry. All candidates are frozen before inference starts.
  Diagnostic validation is explicitly labelled; sealed tests require a qualified
  evaluator and a corpus/candidate/source-bound permit. Direct `generate.py`
  calls enforce the same check before opening resources. The permit protocol is
  `alder-sealed-test-permit-v1`, with `status: passed`, `corpusSHA256`, `candidate`,
  `sourceSHA256` and `evaluatorArtifactSHA256`; all must match verified artifacts.
  Frozen source verification checks both the manifest digest and the complete
  declared Python/JSON source inventory. Preserve old diagnostic archives; compose
  a fresh harness with a verified old backend for a new sealed run.
  Use a stop file for clean
  interruption. A completed run means inference finished, not that quality passed.
- `experiment.py`: developer-only minimal-edit, few-shot, two-stage and semantic
  veto prototypes. Extra research models and dependencies are never installed
  into Alder's pack. Every intermediate output remains in the trace.
- `native_generate.py` and `native_worker.py`: developer-only family comparisons
  using each verified GGUF's embedded template. They keep the production system
  instructions, CPU profile, decoding budget and final validators. Document role
  delimiters are escaped losslessly inside JSON strings. A missing template or
  unexpected source framing fails the probe rather than falling back to ChatML.
- `import_eracond.py` and `reference.py`: import licensed conversational corrections
  with conversation/source isolation and score delivered outputs using official
  ERRANT. Missing or withheld suggestions remain unchanged source. Reference edit
  overlap is useful diagnostics; it cannot certify acceptable paraphrases.
- `comparator.py`: prepare source-bound Grammarly-for-Word capture bundles and
  import actual captured text. Each observation records exact source hash/locale,
  corrected or explicitly unchanged text, product/Word versions, timezone-aware
  date, method, suggestion category and retained local evidence hashes. Missing
  and abstained observations remain unavailable, even when their fallback source
  matches Alder's output: `candidate_pairs.py` preserves that marker and `judge.py`
  abstains without inference. Import validates declarations and integrity, not
  product authenticity; its report remains unverified until the collector and
  quality evidence are independently qualified. Sealed exports enforce the same
  permit as generation. Neither command controls Word or contacts Grammarly.
- `subset.py`: freeze a declared corpus prefix and require aligned outputs from
  every candidate. It cannot select only successful outputs.
- `make_semantic_controls.py` and `make_semantic_challenge.py`: produce separate
  harmful-edit controls. The both-rewritten condition prevents a preference for
  copying source text from masquerading as meaning preservation.
- `import_seeda.py`: import a pinned external SEEDA checkout. It aligns full system
  output files with original source ids, deduplicates each annotator's votes and
  excludes conflicting repeats. No data redistribution right is asserted.
- `sample_pairs.py`: freeze source-balanced calibration/validation cohorts before
  experiments, recording sampling policy and excluded protocol-exposed groups.
- `document_cohort.py`: freeze subsequent independent judge trials by whole
  official source essay, unioning documents with shared source sentences. Earlier
  sentence-only cohorts retain their overlap limitations; repartitioning does not
  erase a model's previous exposure.
- `judge_server.py` and `judge_client.py`: keep one verified local GGUF loaded
  across bounded requests; identify its checksum before every request. The
  server is a developer tool and is not Alder's shipping inference worker.
  Optional `--canonical-order` uses one fixed source/candidate hash order and a
  content-bound verdict cache, then restores labels and exact evidence to caller
  order. Its symmetry is structural; human accuracy, ranking, semantic and family
  qualification still apply. Never select a hash/order using expected winners.
  Native `--nonthinking` and explicit batch sizes are separate identity-bound
  research settings, with no change to the shipping worker.
  Optional `--reasoning-tokens` instead permits a bounded native Qwen thinking
  phase before constrained final JSON. `native_reasoning.py` neither decodes nor
  logs that content. An absent verified closing token causes abstention; it never
  forces an unfinished phase into an answer. The runtime profile and source are
  pinned separately and still require fresh calibration.
  `judge_http.py` keeps identity reads responsive during a long native call and
  refuses concurrent inference instead of queuing behind an expired client.
  Transport exit 75 pauses `judge.py` after recording the current abstention;
  untouched pairs remain pending. Explicit context/request budgets are included
  in server identity. Larger developer reasoning profiles still require a real
  native closing token, never a forced final answer or private-content logging.
- `tagger_hints.py`: a local-only, pinned CPU GECToR feasibility adapter with
  exact source spans and no truncation or direct document editing. The initial
  six-case probe exposed unsafe suggestions and about 0.88 GiB helper peak RSS;
  configuration 16 was rejected before integration. Its hints cannot approve a
  sentence, and the installed pack has no ONNX/tagger dependency.
- `harmony_judge_server.py`: a separate native-Harmony adapter for a verified
  local gpt-oss judge, with bounded reasoning and constrained final JSON. Only
  final verdicts are returned; reasoning text is never logged. The HTTP identity
  includes implementation/runtime hashes. Its large evaluation-only memory
  footprint is not an increase to Alder's shipping budget. Shut the owned service
  down through its loopback `/shutdown` endpoint before generation experiments.
- `judge.py`: anonymize candidates, execute both orders, validate exact evidence
  quotations and abstain on invalid, unsupported or order-dependent preferences.
  Protocol experiments default to calibration data. Validation must be explicitly
  selected. Store raw local ratings for diagnosis, but print only ids/status.
  Local servers require a successful identity-only preflight. Stop files finish
  the current two-order pair before pausing. Code changes invalidate the current
  pair rather than mixing implementations in one run.
  Optional `--futility` stops decisive human calibration only when even perfect
  remaining ratings cannot reach 80% agreement, or observed order changes or
  abstentions already exceed 5%/10% of the complete frozen population. It finishes
  both orders, preserves missing ratings, and never opens held-out validation.
  This rejects an experiment early; it cannot qualify one. The shared
  `judge_protocol.py` constrains evidence to exact candidate substrings, including
  the actual whitespace of tokenized benchmarks; it never silently repairs an
  invented quotation or supplies an expected winner.
- `score_qe.py`: reproduce the published mean-pooling IMPARA-GED grammar-quality
  estimator. This is a grammar score, not a semantic equivalence measure. Inputs
  beyond its 128-token training window abstain instead of silently truncating.
- `calibrate.py`: score against held-out human preferences with source-cluster
  bootstrap intervals. Missing judgments count against agreement and coverage.
  Passing pair agreement alone never produces a qualified evaluator verdict.
- `expand_validation.py`, `conll_documents.py` and `ranking.py`: freeze one declared
  full-fold expansion, align official source essays, audit calibration/validation
  document overlap and compare system rankings on exactly matched source sets.
  Sentence-disjoint evidence must not be described as document-disjoint.
  Comparative ratings use saved, evidence-validated decisions in both orders to
  measure each system's win rate against the same source anchor. Abstentions make
  a source matrix incomplete; the 100-source/90%-coverage/.85-correlation gates
  remain unchanged. This score can saturate and cannot approve individual edits.
- `score_some.py`, `score_sure.py` and `score_nli.py`: independent diagnostic axes
  with verified local checkpoints and explicit over-length abstentions. A learned
  grammar score or entailment score alone is not a qualified editorial judge.
  `evaluate_semantics.py` counts abstentions against harmful-edit detection.
- `normalize_display.py`: render tokenized benchmark text using Treebank
  detokenization, verify lexical-character equivalence and preserve original
  hashes. Transform the official document map at the same time, reject newly
  identical comparisons and recheck document-disjoint partitions. This is a
  benchmark presentation transform; never apply it to actual user/learner prose.
  Explicit `--unlabelled-ranking-matrix` retains newly identical source-anchor
  cells as marked ties without discarding cells; human-labelled pairs still
  reject that transform, so published preferences are never silently relabelled.
- `pointwise_judge_server.py`: assess each candidate independently with no A/B
  label or other candidate visible to the model. Every sub-perfect axis requires
  its own exact defect quote. Meaning, voice and dialect veto a preference rather
  than being averaged into fluency; the remaining axes compare lexicographically.
  Symmetry is structural and must not be counted as evidence of human agreement.
  Record raw structured assessments, template/runtime identity and timings.
- `specialist_judge_server.py`: use verified publisher Flow/Selene prompt frames
  and each GGUF's native chat template. A declared adaptation emits exact JSON
  defect feedback before the native result. Safety is a separate binary pass;
  grammar quality uses five levels. Invalid evidence, score/evidence conflicts or
  explicit uncertainty abstain. Meaning failures cannot be offset by fluency.
  Publisher benchmark claims are not reused as grammar qualification. Templates,
  weights, runtime and adapter are identity-bound; cached candidate comparisons
  are structurally symmetric and still require human calibration.
- `mistral_tokenizer.py`: local-only publisher reference tokenization for the
  Magistral developer evaluator, in an isolated pinned `mistral-common`
  environment. Verify assets and the complete byte vocabulary against the GGUF
  before inference. Preserve the publisher's structured system prompt and native
  thinking boundaries; private generated content never enters this bridge.
  `judge_server.py --template mistral-reference-v1 --tokenizer-config ...` requires
  bounded native reasoning and a pinned tokenizer identity. This separate profile
  must pass fresh controls and human calibration before any held-out judging.
- `review_tatoeba.py`: inspect locally pinned community-review exports without
  exporting prose, querying a model or declaring grammar gold. Require current
  text-version dates, distinct external level-5 reviewers, no opposing/unsure
  current review and no duplicate reviewer/source inflation. Preserve CC0 versus
  attributed-text provenance, recent-creation counts and contributor/reviewer
  concentration. Self-reported skill and experimental community OK ratings cannot
  replace expert perfect-grammar labels or a qualified evaluator.
- `source_diagnosis.py` / `experiment.py --variant source-diagnosis`: render a
  standalone developer worker that identifies an exact source-defect span before
  a complete rewrite. The explicit no-defect branch maps to unchanged source;
  malformed decisions fail closed. All service guards and the spelling audit
  remain active. Explicit rephrasing and spelling-repair requests bypass this
  gate. Keep raw source assessments in the external trace. This same-model
  self-check is a generator ablation, never an independent editorial approval.
  `--variant hybrid-hints` selects ordinary rule-guided revision when usable
  spelling/grammar/punctuation hints exist, and diagnosis otherwise. Style-only
  flags do not select the first path. One worker/pass and all final audits remain.
- `judge_server.py --template phi4-reasoning-v1 --publisher-prompt ...` uses the
  pinned first-party Phi reasoning system instruction, verified native controls
  and publisher-recommended reasoning sampling (.8/50/.95). A natural native
  closing token is required before constrained final JSON; no private generated
  content is decoded or logged. The bounded profile has its own frozen identity
  and cannot reuse the earlier nonreasoning checkpoint's calibration.
  New stable-seed profiles reset native context/seed before every uncached request,
  explicitly seed final completion and disable implicit min-p pruning. Old sampled
  sessions retain their seed-progression/resume limitations. KV precision and flash
  attention are identity-bound resource settings, not evidence of equal quality.
- `reference_guidance.py`: reconstruct the two official CoNLL human corrections,
  verify source alignment and prepare a source-hashed map without ranking labels
  or candidate outputs. Optional `--pairs` and `--output-cohort` freeze a new
  document-disjoint cohort excluding reference systems and exact reference-copy
  comparisons. `judge_server.py --reference-map` uses these non-exhaustive examples
  in a separately pinned protocol. It needs its own calibration, and cannot
  qualify an evaluator for unreferenced user writing. Whole-sentence deletions
  remain explicit in the map and do not authorize empty Alder suggestions.
- `absolute_grading.py`: fit an absolute grammaticality or faithfulness approval threshold on
  published human ratings, then evaluate the frozen threshold on separate source
  groups. Repeated outputs are deduplicated and known supervised training-origin
  overlap is rejected. No threshold meeting the target means no automatic
  approvals; pairwise preference alone cannot approve an imperfect sentence.
  `prepare --human-dimension grammar|meaning` selects the published human axis.
  `rebind` permits score reuse only when model inputs and partitions are identical
  and only human label metadata changes; it preserves the original score binding.
  `feasibility` checks necessary positive-count bounds without model inference;
  an impossible approval population cannot be repaired by changing old labels.
- `import_edit_acceptability.py`: inspect the separate SEEDA edit-validity labels.
  Require at least two independent annotators, preserve original True/False labels,
  quarantine complete sources with malformed/unaligned corrections and exclude
  declared format-inspected documents. This distinguishes acceptable edits from
  a fully correct sentence. Its initial calibration population permits at most
  92 oracle approvals at 95% precision, below the existing coverage requirement;
  no evaluator was fitted or qualified from it.
- `replay.py`: replay recorded model responses through current service guards.
  Bind context, locale and vocabulary through the recorded request-configuration
  hash. Unbound requests invalidate the manifest even if the service reports a
  failed job without raising an exception to the runner.
  Unrecorded requests fail. Reports identify recorded-model integration replay;
  it must never be reported as fresh model inference. `--case-ids` freezes an
  explicit subset in the replay fingerprint; missing or unknown cases fail.
- `compare.py`: aggregate source-bound deterministic checks. Unchecked prose is
  explicitly ungraded. A correct word containing an erroneous stem is not falsely
  counted as a remaining typo (for example, “hearing” versus “hear”).
- `reference_comparison.py`: compare exactly matched ERRANT populations with
  paired document/conversation bootstrap intervals for precision, recall, F0.5
  and remaining reference errors. This remains reference-overlap evidence.
- `audit_inference.py`: separate attempted cases, service failures, missing model
  responses and editorial qualification. Recover memory maxima from every row
  even after a no-work resume. Warm timings on a busy development machine are
  explicitly separate from reference-hardware qualification.
- `assess.py`: run resumable diagnostics after all selected inference populations
  finish. Its external JSON plan names the corpus, split, baseline and candidate
  result paths, the isolated metric Python and verified IMPARA/SURE asset paths.
  It verifies complete source-bound populations and metric assets, records the
  environment, then runs literal/resource audits, optional ERRANT and blinded
  grammar preferences. Reference assessments also emit matched, conversation/
  document-paired uncertainty intervals after all reports finish, independent of
  candidate-map order. Completed unchanged steps are reused. Tampered output or
  changed inputs require a new directory. It emits JSON and HTML and always
  retains the incumbent: these diagnostics cannot substitute for qualification.
- `qualify.py`: combine hashed artifacts for the frozen gates. Missing evidence,
  wrong protocols or mismatched corpus/source identities cannot pass. Numeric
  thresholds are evaluated rather than trusting an arbitrary `passed` string.
  Exit 2 means failed/unverified qualification and retains the incumbent. It emits
  JSON plus a local HTML report. The optional `--grammar-evidence` switch on
  `scripts/developer/validate-release.py` includes this decision in release checks.

`fetch_checkpoint.py` requires an immutable revision and verifies selected model
files against repository/LFS metadata. It downloads only into an explicit external
workspace. Model-card, dataset and implementation licences are separate records;
the presence of an open-source implementation does not license its weights.

`experiments.json` fixes the initial candidate/trial budget. No candidate is
promoted just because it appears in this file. A production pin change requires
completed qualification and user-authorized Git/publication actions.
`model-review.json` records specialist checkpoint inspections and exclusions with
immutable source revisions. A model-card licence and its training-source audit
are recorded separately. These records contain no model weights.

The documented 12 November amendment adds one local-rule-guidance pipeline to
the initial twelve trials, retaining the three-generator-family limit and all
qualification gates. Its developer worker preserves the source, context and
protected terms while trimming optional hints if its token budget is full.
Additional conversation-disjoint development screening is explicitly separate
from validation or sealed qualification.

Judge servers default to CPU. Explicit developer GPU offload has a separate
runtime, source archive, identity and calibration output. Its wheel/dependency
hashes and offload profile must be recorded; CPU calibration is not reused as
GPU qualification. This does not enable or qualify GPU acceleration in Alder.
The loopback client disables environment proxies and HTTP redirects.

## Reproducibility and limitations

`peer_ranking.py` builds a fixed, source-hash-ordered cycle of published editors
on the existing ranking population. It verifies source identities, original
context, output alignment and graph coverage. Evaluation requires saved public
evidence in both orders, uses only complete matched sources, and binds the human
ranking file and all inputs. It retains the original 100-source, 90%-coverage and
.85 correlation gates. Run model ranking only after calibration and held-out
pairwise qualification; an empty or partial matrix cannot qualify a grader.

`edit_acceptance.py` is a separately scoped, fixed-grid SURE edit-validity
calibration. It retains missing scores and requires a reproducible calibration-
only fit before validation. Its label is unanimous acceptance of all proposed
edits, not a completely corrected sentence. The original full-sentence approval
protocol remains separate.

`binary_edit_acceptance.py` tests the same edit-validity label with the pinned
non-reasoning Mistral model. It measures two public-label logits without text
generation, using fresh native logits rather than the unfilled Python score
array in llama.cpp 0.3.35. The payload excludes ratings and system names, verifies
original context windows/target positions, and never clips input. Calibration
scores are separate from validation; validation model access requires the saved,
recomputed policy and the identical classifier identity. A passed component is
not a passed whole evaluator, product, or production scorer licence.

`seq2seq_generate.py` and `seq2seq_worker.py` are a separate CoEdIT research
baseline. They use the pinned local safetensors/tokenizer inventory, execute no
checkpoint code, and never download during inference. The publisher GEC prefix
uses deterministic float32 CPU generation, four threads and explicit untruncated
input/output limits. The normal service still validates source fidelity and
audits spelling. This baseline has no context, locale or creative-profile
conditioning and rejects explicit rephrasing. Its noncommercial weights remain
excluded from Alder's unrestricted shipping pack. The experiment runner permits
development only, with no validation, sealed-test or installation path.

`grmr_generate.py` and `grmr_worker.py` provide the final task-specific research
screen. They retain the reviewed GRMR production exclusion and use its published
text/corrected delimiters with verified local Q4 weights. Literal task delimiters
in source inputs are rejected; context is never truncated. The documented fixed
sampler/state and CPU profile are explicit, with no thinking channel or paragraph/
locale conditioning. Service guards and complete spelling audits remain active.
This candidate also has development-only access and cannot open sealed tests.

The developer memory collector includes owned model/rules descendants, including
Windows virtual-environment redirectors. The backend is counted separately once.
A missing process snapshot or child peak leaves the conservative total
unverified; launcher-only RSS must never establish model resource fit. These
component/descendant lifetime peaks are still a development diagnostic rather
than a physical 16 GiB reference-hardware measurement.

`audit_inference.py` preserves lineage uncertainty rather than reconstructing a
verified total from partial component figures. Legacy/partial observed sums remain
diagnostic. A no-work resume does not erase earlier verified row-level peaks.

`cloud_judge.py` is an optional public-data developer evaluator. It requires a
source/profile-bound input permit and explicit finite spending approval before
inference, counts inputs first and reserves a conservative complete-request cost.
Unknown charges stay reserved and bounded model failures are cached abstentions,
preventing paid order-swap retries. Credentials are read only in memory; private
output items are ignored. This never enables cloud correction in Alder. Provider
weights/dated snapshots are unavailable and are not represented as weight hashes.
Different API models from one family do not establish independent families.

`development-semantic-regressions.json` is a separate, unqueried development queue
of observed research failures. It does not alter the frozen semantic challenge
or supply independent human ratings.

`evaluate_semantics.py` reconstructs saved public judgments in both orders before
using them. Missing and abstained cases remain in the denominator; a known
harmful preference fails even when the aggregate detection rate exceeds 95%.
The report distinguishes verified public evidence from legacy numeric decisions.
This controlled component alone never qualifies a complete evaluator or product.

`calibrate.py` likewise reconstructs saved public evidence before a pairwise gate
can pass. Legacy numeric-only labels retain diagnostic agreement but cannot
qualify. The optional native `--evidence-first` profile emits brief public defect
findings before the verdict, binds exact candidate quotes and has a distinct
schema, token bound and implementation identity. It needs fresh readiness and
calibration; prior winner-first results never qualify it.

`judge_server.py --grammar-aware` selects a separately identified research rubric
that distinguishes grammatical repair from changes to established facts. It
evaluates negation scope and context rather than treating every changed number
inflection or negative word as a semantic failure. The original rubric remains
unchanged. This profile requires fresh readiness/calibration and cannot reuse
earlier verdicts or relax the semantic, agreement or coverage requirements.
The native Harmony adapter supports the same separate selection. A prepared
hosted Sol profile can bind that rubric too, but needs its own input permit,
model identity and fresh spending approval; a previous Luna allowance is not
transferable. The production correction path remains local.

`gemma_generate.py`/`gemma_worker.py` adapt only the native serialization for the
registered first-party Gemma 4 E4B QAT candidate. They pin its architecture and
publisher template, explicitly disable thinking, and reject an open private
generation channel. Default native adapters retain their previous arguments.
Production instructions, complete-service validators, spelling audit and CPU
profile remain shared. The resource probe must fit 7 GiB before a matched
development screen; model-file size alone cannot establish that fit. The separate
26B Gemma judge is developer-only, and same-family judging alone cannot promote
the E4B candidate.

`semantic_futility.py` lets a watcher stop controlled semantic trials after a
complete two-order pair when rejection is already certain: one verified
preference for a known harmful mutation, or too many non-correct outcomes to
reach 95% even with perfect remaining judgments. It verifies pair hashes and
both saved public responses, preserves the full denominator and rejects human
preference data or undersized control populations. It cannot qualify a partial
or complete trial. Use the existing stop-file mechanism with separately frozen
watcher code; do not change the calibrated server or inference identity.

`validation_futility.py` is a separate rejection-only policy for a locked human
validation fold. It verifies both public responses and exact pair identities,
then uses optimistic full-population bounds for the unchanged 80% agreement,
10% abstention and 5% order thresholds. It forbids calibration/controlled-mutation
inputs. Declare the policy before inspecting interim validation agreement;
never use it to pass a partial trial, replace confidence bounds or tune a model
on held-out verdicts. The native inference source stays frozen separately.

The optional pinned `judge_server.py --thinking-sampler qwen-precise-v1` uses a
separately identified sampled native-thinking profile. It requires the reviewed
Qwen weights and an explicit thinking allowance, and cannot be combined with
non-thinking mode or an unrelated template. Defaults retain greedy behaviour.
This adapts the publisher's precise-coding sampler to editorial comparison;
fresh readiness/calibration is mandatory and longer publisher benchmarks are
not implied. Ordered readiness prefixes can resume without regenerating earlier
pairs; all declared controls must still pass before human calibration.

`contextualize_pairs.py` adds a declared three-sentence original-essay window to
published SEEDA comparisons. It checks the pinned clean source repository,
official/raw/displayed sentence alignment, pair IDs and both published system
outputs. Physical essay boundaries are retained even when duplicate sources
belong to a union cluster. Labels, candidate texts and folds remain unchanged;
corrections and edit-validity annotations never enter context. It rejects prior
rich context rather than overwriting it. The new presentation requires fresh
calibration, and source-only ratings remain separate evidence.

`harmony_native.py` reaches a GPT-OSS final header with a bounded token-state
machine. It never decodes the private body or forces a final channel. The Harmony
judge resets request state/seed, retains native prefix IDs for the public final
completion, supports content-canonical caching and uses the responsive single-
inference loopback server. Only fixed failure codes, counts and public verdicts
are logged. Changed native protocols require fresh readiness and calibration.

The external research workspace contains pinned asset manifests, dependency
freezes, output hashes and both successful and unsuccessful experiments. Do not
remove adverse outcomes when revising a corpus or evaluator. Protocol-exposed
source groups must be excluded from subsequent held-out qualification, and any
selection change produces a new cohort manifest.

One experimental official Ministral GGUF encoded all-zero tokenizer scores as
INT32. `repair_zero_scores.py` can create a separate developer copy only after
checking the input hash, array type and every score value. It changes the four
metadata bytes specifying the array type to FLOAT32; zero bits and all tensors
remain unchanged. The original artifact is retained and the transformation has
its own manifest and output hash. This is not a modification to installed packs.

The quality plan remains incomplete until its outstanding corpus, evaluator,
pipeline/model, semantic, timing and comparator gates have measured evidence.
Protocol v2 permits a prospective 7 GiB resource ceiling (v1 remains 6 GiB),
conditional on passing the quality gates. It does not alter the pinned model,
the shipping admission estimate, the latency target or the physical 16 GiB
reference-hardware requirement.

The composite evaluator artifact must include `harmfulPreferences: 0` and
`publicEvidenceVerified: true`. A high aggregate detection rate cannot excuse
one preference for a known harmful edit; legacy numeric-only verdicts remain
diagnostic. Missing evidence fields cannot pass the final gate.

`qualify_evaluator.py --manifest <external-json> --output <external-json>`
assembles local evaluator evidence without inference. The manifest identifies
`productCorpus`, `productSource` (verified frozen archive), `modelReview`,
`cohort`, `displayMap`, `controls`, `semanticPairs`, `peerPairs`, `rankingMatrix`,
`rawMap` and the clean pinned `seeda` checkout. Each `judges` entry identifies
its inference `source` archive and stage objects `readiness`, `calibration`,
`validation`, `semantics`, `ranking`, each with `config` and `ratings` paths.
Missing later stages remain unqualified. The assembler reconstructs readiness,
human-agreement, semantic and peer-ranking reports from saved public judgments;
it verifies source/config/profile bindings across stages. Reviewed weight
identities establish families, conservatively collapsing sizes, dense/MoE and
reasoning variants of Qwen, Gemma, Mistral, Phi and Llama. Reference-assisted
profiles cannot qualify unreferenced judging. A passed evaluator artifact still
does not qualify or ship a generator. Provider-hosted profiles require a separate
identity-policy implementation; they cannot masquerade as local weight pins.

`ranking_futility.py` provides a rejection-only coverage bound for the frozen
peer matrix. It reconstructs both public decisions and counts sources with an
observed abstention once. With every unqueried comparison assumed successful,
it can stop only when 100 complete sources or 90% coverage is already impossible.
It neither estimates partial Spearman correlation nor qualifies a judge. Run
watchers separately from the calibrated inference archive and retain all adverse
and missing results.

`human_rankings.py` excludes sources without published human judgments from both
sides of a matched ranking calculation; they reduce coverage and prevent an
aligned-population pass. Model completion alone cannot count as human-matched
completion. `ranking_population.py` freezes every human-ranked source in the
existing validation documents, with no rank/outcome/length/output selection.
It retains original eligible pairs exactly and verifies the complete source-only
policy when assembling evidence. The initial 100-source diagnostic remains
separate; it contained unrated sources and allowed no abstentions under the
100-complete-source minimum. The repaired cohort has 190 sources/2,850 pairs.

`reuse_ratings.py` can resume unchanged public judgments from the exact frozen
judge implementation/configuration into that repaired cohort. It verifies old
and new input identities and both public responses, retains the known abstention,
and refuses invalidated, running or changed evidence. Per-record provenance and
an external continuation proof survive resume; the assembler rechecks them.
This is neither fresh inference nor permission to reuse judgments after changing
the model, prompt, context, numerical profile or decoder. The end-to-end test
confirms that only genuinely new pairs are queried and an old abstention is not
retried.
