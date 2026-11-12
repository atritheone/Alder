# Grammar quality execution record

Started 11 November 2026. **Plan incomplete; no Grammarly parity claim.**

## Stopped at the user's request, 13 November 2026

All running and queued grammar-evaluation Python jobs were stopped before this
checkpoint commit. The last Gemma ranking output is retained as **interrupted:
291/2,850 comparisons, two abstentions, zero transport-error records**. This is
incomplete evidence, not a passed ranking or a conclusive quality failure. The
queued E4B natural-writing screen and revised Phi-4 screen were cancelled before
inference. Their earlier completed evidence remains intact. External source
snapshots, model assets and raw results are preserved in the local
`AlderTesting/grammar-quality` workspace; no automatic continuation remains.

The task produced useful interaction/spelling improvements and narrow safety
guards, but the broader quality plan is unfinished. No evaluator is fully
qualified, no replacement generator has passed promotion, and no Grammarly
parity claim is supported. The shipping model, memory setting and package version
remain unchanged. Word/Grammarly comparison and physical 16 GiB Windows
qualification remain unverified; Mac remains unverified by agreement.

Final relevant verification: **106 sentence-revision and Gemma-adapter tests
passed**. The focused evaluation tests documented below passed during their
implementation; the entire repository test suite was not rerun. This checkpoint
preserves developer research tooling and results without installing or promoting
a research model. Both paid allowances are closed; total conservative accounted
spend is **US$0.01894650**, with no further paid inference approved.

The entries below are the chronological research record and include superseded
running/queued states. They do not authorize resuming the stopped studies.

Checkpoint, 13 November (Sydney): the user approved an additional US$0.15
grammar-aware Luna readiness/calibration check. Its first launch stopped during
credential preflight with zero requests/charges because the previously supplied
file was absent. On the user's request to retry the same path, preflight passed;
the original zero-request failure was retained and the same unused allowance was
reopened. Luna passed four controls, then returned an incorrect tie on the fifth.
The sequential controller stopped immediately, without the 80-pair calibration
or any held-out access. Its five billable requests have an accounted upper bound
of **US$0.00104925**. The additional budget is now closed; no further paid calls
are approved. The earlier allowance remains separately closed at US$0.01789725.

The user's background-Python audit verified the live Gemma server identity,
unchanged inference archive/configuration and every saved pair digest against
the intended 2,850-edge human-rated ranking population. It progressed from 213
to 220 comparisons during observation, with two model abstentions and **zero
transport-error records**. One model server is active; the other local Python
processes are low-memory progress monitors or sequential waiting controllers,
all below normal priority. The E4B natural-writing screen is queued behind this
ranking run. The earlier Qwen thinking calibration passed all ten readiness
controls but was paused after three calibration records (one abstention), because
individual comparisons consumed roughly twelve minutes. This is a runtime
decision, not a conclusive language-quality rejection. Its conditional held-out
controller cannot run unless a completed passing calibration exists.

Latest status, 12 November: **71% weekly remaining**. The Gemma 26B evaluator
passed the original held-out pairwise and full semantic components, but its
first ranking diagnostic stopped after 96 recorded pairs with one abstention.
The audit found two ranking-design defects: exactly 100 attempted sources left
no missing-data allowance under the 100-complete-source minimum, and only 27
sources had published human system-ranking labels. Neither model/human ranking
population mismatch nor missing gold may count as success. The original failed
run is retained. Pairwise calibration/validation alignment was checked separately:
all 36/51 original source identities have human labels, so those results stand.

A full, prospective eligibility repair is frozen at **190 human-ranked sources
in the same 25 validation document groups**, 2,850 pairs, with unchanged quality
gates. All eligible original pairs remain byte-identical. The entire source-only
selection is recomputed at qualification; no winner, length or output-availability
filter is used. Six eligible old judgments are retained without new inference,
including the known abstention; 90 unrated diagnostic judgments remain only in
the immutable original run. The proposed intermediate 120-source extension was
not run. No further outcome-dependent population expansion is allowed.

Eight focused human-population tests, five population-repair tests, seventeen
assembly tests and seven carry-over tests pass. The latter include an actual
CLI resume: it queried only new pairs and preserved the old abstention. A fresh
combined assessment verified every attempted new source has human rankings and
correctly remained unverified while ranking was incomplete. The analysis/carry-
over source is `1d8389e3192b266803949d4545a91a7d0381124780defe0487ac69312473b98a`;
the exact original Gemma inference source remains unchanged. Repaired ranking,
readiness, coverage watching and final evidence assembly are queued after the
current Qwen study. The separate ranking-analysis environment pins the observed
NLTK 3.10.4, NumPy 2.4.6, SciPy 1.17.1 and TrueSkill 0.4.5 versions; its package
integrity report/lock are external and `pip check` passed. Existing metric and
model runtimes were preserved.

Gemma E4B's repaired CPU screen completed all 52 attempts for both models, with
51 service successes each (one proposal withheld by the spelling audit).
Conservative complete-service peak was **6.25 GiB**, versus baseline **5.36 GiB**;
development-host warm p95 was **4.03 s**, versus **5.08 s**. IMPARA preferred
baseline/candidate/tie **5/5/42**; SURE preferred **4/6/42**. These mostly tied
diagnostics establish feasibility, not a reliable grammar-quality gain or a
16 GiB hardware qualification. No model or shipping memory setting was changed.

Latest checkpoint, 12 November: weekly usage is **72% remaining**, above the
20%-remaining stopping threshold. The approved US$0.15 Luna study is closed at
a conservative US$0.01789725 accounted upper bound; no further paid inference
is approved. Local Gemma 4 26B completed calibration at 65/80 agreement, with
no abstentions or caller-order changes, and passed ten repeated readiness
controls before the original 150-case held-out validation. It then passed the
pairwise gate at **128/150 = .8533 agreement**, document-level 95% interval
**.7671–.9281**, with zero abstentions, zero caller-order changes and all 25
validation document groups. Public evidence and calibration/document separation
were verified. This is the first resumed local profile to pass that component;
semantic detection, ranking and a second independently qualified family remain
required. Caller-order symmetry is structural and does not demonstrate intrinsic
model order robustness. The full evaluator remains unqualified.

The same Gemma profile subsequently passed the complete original **200/200
controlled semantic challenges**, spanning eight categories/construction groups,
with zero harmful preferences, zero caller-order changes and verified public
evidence throughout. A separately frozen assembler recomputed that result from
the raw responses. These authored mutations establish this component only,
not universal semantic accuracy. The fixed 1,500-comparison peer-ranking run has
now started; the independent second-family and final product gates remain open.

The first Gemma E4B complete-service probe failed before inference because its
new wrapper imported a sibling that Python's isolated launch excludes. The
adapter now loads that exact sibling by file path; ten focused adapter tests
and the real resource Python's isolated `--help` launch pass. A separate frozen
v2 source (`d1679ea98c1885b44ee07ba86dee4b470ebedaaddb25b5218b1b4d3c36401b6b`)
queues the same resource-first experiment after the current judge studies.
The old failed result remains unverified, with no memory or quality conclusion.

The composite evaluator gate now explicitly requires zero known harmful
preferences and verified public evidence, alongside its existing detection
threshold. Missing fields cannot qualify. Six focused gate/permit tests pass.
This implements the existing policy; it changes no quality target. A fresh
background Word document-control query still found zero connected sessions;
no screen or mouse control was attempted.
The read-only process inventory subsequently confirmed that Word is currently
closed. Earlier successful three-sentence document access still yielded no
actual Grammarly corrections; neither result closes the comparator gate.
The standalone semantic report also labels numeric-only, unevidenced legacy
ratings `unverified`, even when their numeric detection rate fits; nine focused
semantic-report tests pass. The active inference archives remain unchanged.

A conditional local Gemma semantic/ranking controller is queued after the other
local studies. Before loading, it reproduces the complete held-out pairwise
assessment and requires that gate to pass. It reuses the calibrated source,
runtime/profile and validation configuration, verifies the server identity and
repeats ten readiness controls. It then tests the original 200 controlled
semantic mutations, stopping normally at the frozen rejection-only futility
bound. The fixed 1,500-edge peer ranking follows only if semantic qualification
passes. No additional paid inference or generator sealed access is involved.

`qualify_evaluator.py` now assembles that evidence automatically. It checks
reviewed weight-to-family identities, verified inference archives, exact stage
configuration bindings and unchanged runtime/decoder identities. It recomputes
public readiness, calibration, validation, semantic and peer-ranking evidence;
missing stages and reference-assisted-only profiles cannot qualify. Sizes,
dense/MoE and reasoning variants are conservatively collapsed within their
families. Sixteen focused assembly tests pass. A frozen implementation
(`2f61b437449aec2fd31141b7ab56ac87c236c4173abaf943f30d07d880c4ec89`)
also recomputed the real Gemma readiness and full calibration/validation records.
Its report correctly remains unverified with **zero fully qualified families**,
despite the passed pairwise component; semantic/ranking evidence is still absent.

The Qwen published-sampler fallback passed its first two readiness controls and
paused normally after the second complete two-order comparison so that the
passed Gemma profile could reach semantic checks sooner. A continuation is
queued after those checks and the repaired E4B probe, with the same verified
source and exact configuration; it must
reproduce the first readiness decision after server restart before resuming the
preserved prefix. This is a scheduling change, not a failed quality result or a
new numerical profile. The first E4B retry stopped before any inference because
its controller required a preflight bound to the old source. A fresh CPU
vocabulary-only preflight now passes for the repaired source and both pinned
Gemma templates; no tensors or model output were generated by that check. The
next E4B controller is queued after Gemma semantics. Both earlier startup failures
remain in the evidence workspace. Gemma repeated all ten readiness controls
successfully before starting its original 200-case semantic challenge.

A separately frozen ranking-coverage watcher was declared before any peer-ranking
inference (`92651a6f827931fb224740f84adaf440355c76b1e45e147b66c14e841afe4467`).
It validates saved quotes/order decisions and assumes every unqueried comparison
will succeed. It can reject only when the original >=100 complete-source or
>=90%-coverage target is already impossible. Nine focused tests pass, including
the distinct source-count and coverage bounds and tampered-evidence rejection.
The active Gemma inference source/profile is unchanged. This avoids spending
hours on the 1,500-edge ranking matrix after an irreversible coverage failure;
it makes no partial correlation or quality-pass claim.

The assembler's ranking path also verifies the pinned, clean published SEEDA
checkout before reading human system rankings. Seven focused source-selection
checks pass, including real temporary-repository tests for wrong revisions,
modified labels and untracked additions. Frozen assembly v2
(`844440faa32ff3defa4c0150c4b5fd9ea3dc71fc4e5afa5c38aa4231e8404a0e`)
reproduced Gemma's passed pairwise/semantic components while correctly retaining
overall unverified status. A background follow-up will assemble the ranking
evidence after the owned study ends; this performs no inference or API calls.

Resumed on 12 November at the user's explicit request. A fresh, read-only query
through the installed Codex app-server reported **21% used / 79% remaining**;
the connected usage tool initially lagged at 20% used, then agreed at 21% used
on the 14:31 recheck. The stopping threshold is
**80% used / 20% remaining**. No reset or credits were consumed. No new commit or
push has been made during the resumed work. Other chats' edits in `alder.txt`,
`App.tsx` and `Editor.tsx` remain separate and untouched.
At 15:20 the user also confirmed **79% remaining** and reiterated that work stops
when **20% remains**. The current usage reading is therefore consistent with the
user's display; use percentage remaining when communicating the threshold.

The source-diagnosis development study is complete, with mixed results and no
promotion. Both candidates completed 99/100 service checks on each population;
the remaining reviewed-text case was withheld by the spelling audit. On the
community-reviewed population, displayed revisions fell from 27/100 to 3/100.
These remain ungraded preservation diagnostics, not expert clean-text labels.
On the 100 natural utterances from 92 conversations, reference precision rose
from .4098 to .5377, recall fell from .5787 to .4954, and F0.5 rose from .4352 to
.5287. The paired conversation intervals exclude zero for all three changes;
the candidate left **18 more reference errors** (95% interval: 3–33 more).
IMPARA preferred baseline/candidate/tie 45/23/32; SURE preferred 56/12/32.
Busy-host warm p95 rose from 10.45 to 19.86 seconds. These results do not justify
making source diagnosis the default. Full resource/metric artifacts are retained
in `source-diagnosis-quality-resume-v2.json` and its two assessment directories.

One delivered proposal changed “the same school that I went to” into “the same
school that I go to”. A new narrow source invariant rejects recognized pronoun
past events converted to the corresponding present-tense event, aligned using
the following words. It preserves past-tense agreement repairs and does not
claim general tense or semantic verification. Four harmful cases failed before
the fix; all **89 sentence-revision tests** passed afterward. Strict recorded-call
replays cover 400 delivered results across both populations/candidates: this one
proposal is now withheld and every other delivered result is unchanged. These
are integration replays, not fresh generation. The strengthened replay adapter
requires the original model-request configuration hash, including context,
locale and vocabulary; an unbound request invalidates the replay manifest.

Configuration 16, a task-specific DeepQuill GECToR helper, was rejected at its
six-case native CPU probe. It used 947,965,952 bytes peak RSS, suggested a useful
has/have repair, but also suggested plural narrowing and emoji deletion. No
complete-service integration, shipping dependency or memory increase followed.
Configuration 17 is a separately frozen conditional combination of existing rule
hints and diagnosis, with no extra model or generation pass. Its four authored
dialogue regressions passed and both 100-case screens/assessments completed.
It displayed two reviewed-text revisions. Natural reference P/R/F0.5 were
.5328/.6019/.5453, with 86 remaining reference errors versus the baseline's 91.
Warm natural p95 was 10.72 seconds on the development host. IMPARA preferred
baseline/candidate/tie 37/17/46, and SURE preferred 44/10/46. Independent quality
signals still disagree and the candidate remains unpromoted. Its source archive is
`cb77b14e0c678b8ec009d5653167eb700c40da62df81717e9ab7e7578b488c7d`.
The conversation-paired precision difference is +.1230 (95% interval:
.0755–.1747), recall +.0231 (−.0449–.0885), and F0.5 +.1101 (.0622–.1604).
Five fewer reference errors has an interval from 19 fewer to nine more, so neither
a reliable recall gain nor the 10% remaining-error target has been established.

The resumed Magistral protocol stopped at 16/80 calibration pairs: nine transport
abstentions already exceed the full-population 10% bound. Its serial server
blocked identity reads behind the outstanding native call. This is a failure of
that complete bounded pipeline, not proof of intrinsic model inability. The new
loopback transport keeps identity reads responsive, rejects concurrent inference
and pauses on infrastructure unavailability while retaining the current
abstention. Untouched subsequent pairs remain pending.

The longer Phi-4 profile passed all four readiness controls, then paused with
four calibration pairs (two correct, one incorrect, one abstention). Both orders
of the abstention exhausted the 6,144-token bound. Its uninterrupted prefix is
retained. Inspection of the pinned runtime also found that final completion calls
advance the model's internal seed. That sampled profile must not be resumed as
content-identical evidence without restoring its state. Future frozen profiles
explicitly reset request state/seed, set the final seed and disable the native
min-p default to match the documented sampling settings. Deterministic bounded
native failures can be cached as abstentions, with explicit cached-failure metadata.
Private generated content is never decoded or logged. A full-GPU Q8-cache
resource probe left only 909 MiB free, below its preregistered 1 GiB desktop
headroom reserve; it stopped before any judgments. No held-out human judgments,
ranking matrix or sealed generator cases were opened by these resumed trials.

The subsequent stable-seed Q4-cache Phi profile passed four readiness controls
and reproduced one public verdict after an uncached server restart. Its source-
only calibration was deliberately paused after five pairs (one correct, four
abstentions). Its input protocol still omitted the surrounding source text
available to the published human reviewers. This omission is corrected in a
new, fully source-bound context presentation; earlier failures remain evidence
about their original source-only pipelines. The new presentation retains all
230 pairs (80 calibration, 150 validation), labels, candidates and partitions.
Every pair has its original neighbouring essay sentences, verified against the
official document map and pinned published outputs; eight focused checks passed.
The three-sentence window is declared explicitly rather than claimed to match
every human window exactly. Its hash is
`08444461d058cf5300d4d0dc8915be90abf8ef8b99d02ad8949a34e247f42b9c`.
Fresh context calibration uses the unchanged stable Phi native profile; no old
human-pair responses are reused. Validation, ranking and sealed inputs remain
unqueried. A second full verification with the strengthened source-cluster checks
reproduced the same cohort hash; **10 focused context tests** passed. A read-only
audit of annotation source sections found exact published windows for all 80
calibration pairs and 139/150 validation pairs. The other 11 published validation
windows cross physical essay boundaries. Their labels remain present, with the
window difference recorded rather than injecting unrelated essay text. No
correction/validity labels were interpreted by this context audit.

The context-corrected Phi calibration stopped at **18/80** planned pairs: seven
correct, two incorrect and nine abstentions. All native failure diagnostics were
bounded private-phase exhaustion. Nine abstentions already imply an 11.25%
minimum final rate, exceeding the unchanged 10% limit even if every remaining
pair succeeds. No validation or ranking inference followed. The owned model
server shut down; minimum observed global free VRAM was 1,259 MiB. This rejects
the complete bounded profile, rather than proving intrinsic model incapability.

A concurrent Mistral CPU load crossed its six-GiB available-RAM reserve and was
stopped before any judgments. Its waiting successor was stopped before model
load to keep later large-judge runs sequential. No resource failure was counted
as an editorial verdict. The older GPT-OSS adapter now reaches native final
headers through a token-ID state machine, keeps the private body undecoded,
passes its native prefix as IDs and resets state/seed per request. It uses the
same responsive transport and optional content-canonical cache. **14 focused
checks** passed, including a mocked complete server flow and real loopback client
identity preflight. Native readiness and
fresh context calibration are queued behind the active studies. Its frozen
archive is `b37921c1d1db3fb0226ac943bea2f38d1561f05c521b4563c6b21ba7031b2a67`.
The earlier prepared queue was stopped before model load when its client template
registration was found incomplete; it produced no readiness or human verdicts.
The subsequent Mistral GPU profile is queued after the owned preceding study
processes exit, with independent RAM/VRAM reserves and fresh readiness/calibration.

The same configuration 17 is also undergoing a fresh matched 200-utterance
development extension, using the existing 92-conversation population.
Both baseline and candidate are rerun through the same frozen current backend.
This population was previously exposed during configuration 13 development;
it is neither new held-out evidence nor a new generator configuration. Resource,
reference and independent metric assessments retain failures and cannot promote
the candidate. The six-GiB system reserve protects desktop headroom separately
from the prospective seven-GiB proofreading-process budget.
The overlap audit corrected an initial selection-description error: all 100
earlier IQ3-subset cases are contained in this 200-case population, with all 92
conversation groups overlapping. Thus it adds 100 utterances, not 200 new ones,
and does not add independent conversations. A pooled 300-case report was rejected
before writing because of those overlaps. The complete fresh 200-case study is
retained, without reselection or an independent-replication claim.
Both candidates completed all 200 attempts: baseline 198 service completions and
two spelling-audit withholds; hybrid 199 completions and one withhold. No model
call failed. Expanded-set reference P/R/F0.5 changed from .4016/.5154/.4202 to
.5095/.5503/.5172. Remaining reference errors fell from 236 to 219 (7.2%), short
of the 10% target even at the point estimate. Paired conversation intervals were
precision +.0733 to +.1439, recall −.0023 to +.0720, F0.5 +.0647 to +.1302, and
remaining errors −36 to +1. IMPARA preferred baseline/candidate/tie 66/35/99;
SURE preferred 72/29/99. Busy-host warm p95 was 10.72/11.22 seconds, with about
5.48 GiB conservative component peaks for both. The first 100 cases' delivered
outputs reproduced exactly for both candidates in the fresh expanded run.
These mixed development results do not support promoting the hybrid candidate.

A separate read-only inspection of published SEEDA edit-validity annotations
preserved all original labels, quarantined complete sources with malformed or
unaligned edits, required at least two independent annotators and excluded the
two format-inspected source documents. It yielded 114 calibration cases with 88
strict positives, and 148 validation cases with 97 strict positives. Even an
oracle can approve at most 92 calibration cases at 95% precision, below the
existing 100-approval coverage requirement. No scorer was fitted, no held-out
inference was run, and no threshold or earlier TMU label policy was changed.
Edit acceptance is distinct from complete-sentence correctness and meaning.

The strict edit importer additionally quarantines every possible source when an
annotation target is ambiguous and rejects orphan closing tags. Two targeted
regressions passed; a fresh re-import preserved the same population/coverage
counts. Controlled semantic scoring now reconstructs both public responses and
rejects spliced hashes, invented quotes and inconsistent order decisions. A known
harmful preference fails even above 95% aggregate detection. Missing/abstained
ratings remain in the denominator, and legacy numeric scores remain explicitly
without public defect evidence. Nine focused checks passed. Future diagnostic
assessments also emit paired reference intervals automatically from the existing
matched reports, without repeating inference.

The next native readiness runs exposed implementation defects rather than
editorial results. GPT-OSS's new token-state parser rejected all four readiness
headers, so no human calibration followed. Its supported public format names now
include the response format explicitly declared in the developer prompt, with
more specific fixed failure codes and no private decoding. The new Mistral
profile failed in prompt preparation because a conditional local import shadowed
the formatter's helper. That helper is now bound on every request. Sixteen
focused native-flow/header checks passed, including a mocked complete formatter
request. Both failed runs remain retained. Fresh readiness repeats use source
`e9d02ae8dbd5e6f762f466a1f3c870ee229135009fe49ef216b612dd7c0f454d`;
Mistral runs first, followed by the queued GPT-OSS profile. No quality threshold
or installed component changed.

The repaired Mistral 24-layer profile passed readiness and recorded 20 human
calibration pairs (16 correct, four incorrect, no abstentions), then its supervisor
stopped it after observed free VRAM fell to 912 MiB, below the 1 GiB reserve.
Its raw prefix retains `running`; the operational ledger records the resource
interruption, so it must not be described as an active or completed calibration.
No intrinsic language-quality failure is inferred. Vocabulary-only prompt checks
found maxima of 988/1,002 input tokens for calibration/validation. A fresh compact
profile uses 22 layers, 4,096 context and 128-token batches with the complete
context preserved; its new calibration is in progress. Its source is
`b707691a414678b892c75d7da05ea11bc9edd5f32a3117269161c9a48e8c8740`.
The GPT-OSS header failure was narrowed to the channel name; fixed public header
names now recognize syntax whitespace using static token variants without
decoding generated content. Sixteen focused header/native-flow tests passed;
fresh readiness is queued after Mistral. Earlier header failures remain retained.

The separately preregistered SURE edit-validity component evaluated 25 calibration
policies. Twenty met its minimum coverage, but their maximum unanimous-edit
agreement was .8852, below .95. No validation outcome was analyzed. Its source
`0e912f30c5f00d5077ad539714595be68b4ffebd956faa15f4f80aa19379bbcb`
and failed policy remain retained. Twelve focused split/binding/policy checks
passed; this new component does not replace the old full-sentence protocol.

A separate Mistral public-label classifier is now prepared. It generates no text,
measures fresh native YES-minus-NO logits, verifies original context/target
positions and excludes human ratings/system identities from its input. Annotation
context recovery preserved all 262 labels and their partitions; no source context
was guessed or corrected. Its native vocabulary preflight confirmed single-token
YES/NO labels. Fifteen focused tests passed, including validation gating before
model access, calibration-only threshold selection, source/identity binding and
rejection of the unfilled Python logits array in the pinned runtime. Its frozen
source is `f39217811f8c62f26f11ad45f4c5860a372c19408ed9e206221b4f21964e251f`.
The native study is queued after the comparative judges, with four authored
readiness controls before published calibration and no validation model access
unless a qualifying calibration policy is saved. It remains research-only.

A later background Word discovery returned no connected session; the earlier
successful connection is retained as evidence, and no foreground control was
attempted. Plugin discovery returned no Grammarly integration. The documented
Superhuman Docs MCP describes document/table operations but did not establish
access to Grammarly correction output. No unrelated plugin was connected or
installed; actual-product comparison remains unverified. At 15:54 the live usage
tool reported **77% remaining**; the stop threshold remains **20% remaining**.

The compact Mistral context profile subsequently stopped at 68/80 calibration
pairs: 51 correct, 17 incorrect, no abstentions. GPT-OSS's static whitespace-token
header fix passed all four native readiness controls; its fresh context profile
then stopped at 49/80 pairs: 32 correct, 17 incorrect, no abstentions. For either
profile, perfect remaining ratings could reach only 63/80 agreement (78.75%),
below 80%. Both owned servers shut down. Neither profile opened validation or
ranking. Content-canonical ordering removes caller-order differences structurally;
it does not establish intrinsic order robustness or editorial accuracy.

The binary Mistral classifier passed its four authored readiness controls and is
scoring the 114 human-rated calibration examples. These controls establish basic
operation, not human qualification. The same context/state correction is now
preregistered for the existing Qwen 35B comparative weights, sequentially after
the binary study. Its earlier failures remain intact, and a non-Qwen evaluator
would still be required if it qualified.

`peer_ranking.py` prepares the prospectively declared fixed-cycle ranking matrix
on the original 100 sources/25 held-out documents: 1,500 comparisons across 15
systems. Eight focused checks passed. The real empty-evidence self-check reports
zero complete sources and remains unverified; no model ranking inference has
run. The matrix preserves the published outputs, original context and folds,
and cannot be evaluated until the grader passes calibration and held-out pairs.
At 16:33 the usage tool reported **76% remaining**. Background Word discovery
again returned no connected session; no screen, mouse or foreground action ran.

The binary classifier completed all 114 calibration cases without scoring errors.
None of its five fixed cutoffs qualified; maximum agreement at required coverage
was .8696. Its validation fold was not scored. A separately declared 25-policy
SURE/Mistral conjunction also failed: 12 policies had sufficient coverage, with
maximum agreement .8889. Labels, original source/proposal alignment and essay
folds were checked across score files. The initial stdin-only diagnostic remains
separate; a saved, hashed script reproduced the same result in
`fusion-edit-calibration-v2.json`. No validation policy or inference followed.

Calibration now reconstructs saved public judgments and exact quotes in both
orders before a pairwise gate can pass. Numeric-only legacy decisions retain
diagnostic numbers but cannot qualify. Eighteen focused calibration/semantic
checks passed. The evidence-first native Mistral profile has its own schema,
650-token final bound and source archive
`8a5d41fb4b084a2e1f15691ed6795a37bf190867873e1c79620d9547f06a0a7e`.
Three focused schema/complete-native-flow checks passed, and the pinned native
runtime compiled its authored schema without any model inference.

The corrected Qwen context run passed all four readiness controls and is running
calibration from archive
`79417a13882aceacc80b469e57f0ede65431e0cec085522e669ea92c0f02bec4`.
Configuration 18 is queued: the existing Ministral 8B developer weights get a
complete-service CPU resource probe before any fresh matched screen. Its archive
is `c3aa8186fd6537b72a4539a92db1ef566e70cd4042572ffb488497c0b5a3c97b`.
The evidence-first Mistral study follows it, then a separately frozen Magistral
context/state/transport correction. These queues run sequentially below normal
priority and preserve desktop headroom. They introduce no new download, installed
dependency, model pin, application memory increase or sealed-test access.

The peer-ranking evaluator now reconstructs the complete original matrix,
essay folds, context and fixed cycle before qualification, rather than relying
on preparation having been called correctly. Eleven focused checks passed.
The real 1,500-cell empty-evidence self-check reproduced the same frozen matrix
hash with selection verified, zero complete sources and `unverified` status.
Its source archive is
`8a9bc3f0bcceb9805e01d4f30aa43f1727b28bdee0e74bdb87aba5e34118ce9c`.

Configuration 19 separately benchmarks the previously reviewed CoEdIT-large
checkpoint for research specialization. All eight selected local assets passed
download verification, including safetensors
`c692f68bca5c6899801bc9fad626fefd3359ccd95e26dccae4dd72186fd98852`.
The CC-BY-NC-4.0 production exclusion remains; no restricted model is installed
or proposed as an unrestricted default. The adapter uses the publisher GEC task
prefix, greedy float32 CPU inference, four threads and explicit input/output
limits without truncation. It has no context, locale or creative conditioning.
Eight focused checks passed, including incomplete-output withholding and blocking
validation/sealed access before inference. Its resource-first study is frozen at
`ca44ac55c7de898bfa20c80d4cb6c1e6c9efa29a87f75f77e5ae51fec2890e4f`.
The original Magistral queue was stopped before loading or producing verdicts to
place this specialization benchmark first; an unchanged-profile successor waits
for it. The active/queued order is Qwen context → Ministral 8B resource/screen →
Mistral evidence-first → CoEdIT resource/screen → corrected Magistral. All are
developer-only. The current usage reading remains **76% remaining**.

Qwen context calibration stopped at 78/80: 61 correct, 17 incorrect and no
abstentions. Perfect remaining judgments could reach only 63/80 (78.75%). Its
server closed and no validation followed. The Ministral 8B complete-service CPU
probe completed one authored case but reached **9,902,768,128 bytes** conservative
component peak (about **9.22 GiB**, including 9,257,676,800 model bytes). This exceeds
7 GiB, so its broader development screen was skipped. The observation rejects
that resource profile, not every possible quantization or runtime of the family.

The evidence-first Mistral profile passed all four native readiness controls and
has started fresh calibration. Configuration 20 is now the final declared
task-specialization benchmark: the previously reviewed GRMR Qwen3 4B publisher
Q4 export, using its documented text/corrected protocol rather than an assumed
instruction-chat format. Both selected assets passed verification. The original
training-source audit/production exclusion remains; this benchmark is development
only. Eighteen focused task-adapter checks passed across configurations 19/20,
including exact task formatting, fixed request state, reserved delimiters,
nontruncating input limits, incomplete output and early validation/sealed blocking.
Configuration 20's archive is
`6fb9ecdd7a8868acfdeb549cb0aafc750f19651c4b7e9d78359980a011aeeaf4`.
The earlier second Magistral queue was likewise stopped before loading to put the
final specialization benchmark first; the identical-profile third queue follows.
Current order: Mistral evidence-first → CoEdIT resource/screen → GRMR resource/
screen → corrected Magistral. No generator candidate or evaluator is qualified.

The evidence-first Mistral profile stopped at 28/80 calibration pairs: 11 correct,
12 incorrect/tied and five abstentions. Even perfect remaining ratings could
reach only 63/80; no validation followed. This alternate output order did not
qualify the complete bounded evaluator.

CoEdIT's first real service probe returned an unchanged grammatical sentence,
but its apparent sub-GiB resource result exposed an instrumentation error: the
Windows virtual-environment executable is a redirector and the collector omitted
its model descendants. That resource measurement is **unverified**, not a fit.
The broad screen was paused with 30 baseline records (including the interrupted
case); its candidate screen had not started. The original raw records and an
explicit operational audit remain retained.

The developer collector now includes owned model/rules descendants and counts
the backend once, preventing both missing model children and double counting.
Unavailable lineage/peak data leaves the conservative total unverified. Four
focused checks passed, followed by an actual Windows venv child-allocation check
that found three owned processes and the expected >64 MiB allocation. No model
inference or reference-hardware qualification was claimed for that check.
The corrected source archive is
`337e935665a1d6629be20b45288efb7dee99428159e3cc22c5c1f27ad6db9854`.
A fresh CoEdIT service probe reported **4,517,793,792 bytes** (about **4.21 GiB**)
with process-tree coverage verified, then began a fresh matched 52-case screen.
GRMR's unstarted queue was likewise replaced with this corrected collector; its
static native task-format/EOS round-trip preflight passed without tensor inference.
Magistral's replacement remains the same declared native profile, queued after
the two specialization screens. No quality gate or product memory limit changed.

A calibration evidence check also confirms that the original missing-rating
allowance is retained: all recorded native decisions need public evidence, but
up to the already permitted missing fraction remains in the full denominator.
Five focused calibration checks passed. An asynchronous question asks whether an
independent cloud evaluation API is available if the remaining local judge fails;
no API key was requested in chat, no configured API credential was found in this
process's environment, and no cloud inference or spending has occurred.

The corrected CoEdIT and GRMR matched seed screens and assessments both completed.
Baseline had 51/52 service completions; CoEdIT 48/52 and GRMR 51/52, with spelling
audit withholds retained and no model-call errors. Warm p95 was 5.30/2.00 seconds
for baseline/CoEdIT and 4.89/2.00 for baseline/GRMR. Conservative complete-screen
peaks were about 5.34/4.48 GiB and 5.34/5.53 GiB respectively. Fresh derived
resource audits verified process-tree coverage for all four completed runs;
the old CoEdIT probe instead has null verified coverage/total, with its observed
partial figures retained diagnostically. Eight focused memory/auditor checks
passed. A prior selected integration run passed 79 relevant developer checks;
the complete application suite was not repeated.

CoEdIT left clear mixed-error spelling unresolved and added “new” when repairing
“a umbrella”, a fluent but unsupported detail. GRMR left “The children was”
unchanged and turned a misspelled-word construction into “misses words”. Its
“more tall” alternative also misses a literal expected string, which alone is
not an independent grammaticality verdict. IMPARA baseline/candidate/tie counts
were 14/10/28 for CoEdIT and 17/7/28 for GRMR; SURE counts were 20/4/28 and
21/3/28. These diagnostics and concrete errors do not support further natural-text
screening or replacement of the incumbent. Two separately authored development
semantic controls record unsupported attributes and spelling-to-meaning drift;
the original 200 semantic controls and all sealed cases remain unchanged.

The user confirmed OpenAI API access and an existing local credential. The
OpenAI Developers connection became available; the existing credential was read
in memory without printing, copying or changing it. No key was created. Read-only
model availability checks succeeded. The user then emphasized that only US$54
remained and it also funds daily scripting. The prepared API benchmark was
therefore reduced to **US$0.15**, approved explicitly for four readiness controls
and 80 original public calibration pairs only. Broader paid runs and model
fallbacks were excluded. Fourteen focused cloud/preflight checks passed; the
frozen source is
`5254c0e969b93aea5439fe3d4f17a3fccdc31c54b2e07b112fdce086095beb9c`.

GPT-6 Luna passed all four readiness controls, then stopped at **71/80** pairs:
54 correct and 17 incorrect/tied, with no observed model abstentions. Perfect
remaining ratings could reach only 63/80 (78.75%). The full-denominator report
counts the nine unattempted pairs as missing, not language decisions. There were
58 billable requests after canonical duplicate caching; the final **conservative
accounted upper bound is US$0.01789725**, with zero unknown-usage reservations.
The allowance was closed immediately afterward. No validation, ranking,
manuscript or sealed calls ran, and further paid API use remains paused.

The corrected native Magistral profile passed readiness. Its later rubric-diagnosis
pause is recorded below. No complete evaluator has qualified. The latest usage recheck
reported **72% weekly remaining**; the stopping threshold remains **20% remaining**.

The next diagnosis used only already-exposed public calibration judgments. The
[SEEDA paper, section 3.2](https://aclanthology.org/2024.tacl-1.47.pdf) describes
subjective overall sentence rankings with source context; it does not establish
that meaning preservation was excluded. Consequently there is no basis to waive
the semantic gates or relabel its human preferences. Of the 80 calibration rows,
57 distinct source/context/candidate comparisons remain after content-canonical
deduplication; none has contradictory preferred texts. Duplicate presentations
therefore do not explain the failed agreement, and are not independent evidence.

Saved Luna findings exposed a narrower rubric problem: the judge sometimes
penalized resolving a malformed generic count noun as changing a known participant
count, and treated removing a negative word as necessarily reversing a negative
proposition. Other disagreements involved actual grammar judgments or subjective
preferences. These observations cannot turn a failed evaluator into a pass.

A prospective **grammar-aware-v1** local Mistral profile replaces the original
blanket plural-participant warning with a distinction between grammatical form
and facts established by source/context. It retains exact public defect quotes,
preservation of explicit counts, roles, event times and obligations, uncertainty
abstention, all human-agreement gates and the original verdict-first schema.
The original rubric stays available unchanged. Its identity binds the selected
instruction, and four focused server-path tests passed. Ten authored readiness
controls (the original four plus six grammatical-repair/scope contrasts) must all
pass before its unchanged 80-pair calibration. These controls are development
checks, not new human labels. No held-out or paid calls are authorized by this
profile. It follows the paused Magistral study, with the same desktop
resource reserves, using source archive
`ed88327f5a777431f809eca58be824fbf2daeae2f7be6a23615665856aa53ed1`.

Magistral completed its in-flight pair and shut down normally. Its calibration
prefix contains nine comparisons: four correct, four incorrect/tied and one
native-reasoning-budget abstention; 71 comparisons remain unattempted. The study
is **interrupted**, not mathematically rejected or qualified. The revised Mistral
profile then loaded and began its ten-control readiness stage.
The existing non-thinking Qwen 35B profile follows afterward. It uses the same revised rubric/source archive,
ten GPU layers and the previously declared context/batch/CPU-KV bounds. Its own
ten controls must pass before calibration; no old responses, held-out calls,
new weights or application changes are involved. It cannot supply the required
independent non-Qwen judgment by itself.

The revised Mistral profile completed all ten controls: nine expected preferences
and one abstention on the contrast between “not every” and “some did not.” It
therefore **failed readiness**; no human calibration or held-out inference ran.
Its operational ledger says `controls-completed`, meaning the driver completed,
not that readiness passed. The original conditional Qwen queue was interrupted
before loading or inference and retained separately. Its v2 replacement lets
Qwen demonstrate readiness independently with exactly the same rubric, weights,
resource profile and ten controls; it does not remove the failed control or
change the all-ten-pass requirement. The source archive remains unchanged.

The same revised instruction is now available in the native Harmony adapter
without changing its default prompt or private token handling. A focused frame/
inert-document test passed. The existing GPT-OSS native profile is queued after
Qwen with its unchanged 16-layer, CPU-KV, 8,192-context, low-effort/2,048-token
bounds and desktop reserves. It must independently pass all ten readiness
controls before calibration. Its distinct source archive is
`bf737cc7b5704efcdb2d0fe5405e6e7d2002334f5e3adbbdcc81b640c80c88f6`.
These three local profiles test one diagnosed rubric change across existing
families; none adds model weights, product dependencies or paid API calls.
Qwen's v2 profile subsequently passed all ten readiness controls and started the
unchanged 80-pair human calibration. This is protocol readiness only, not a
human-agreement, semantic-challenge or evaluator-qualification pass.

It then completed calibration with **65/80 agreements (81.25%)**, zero abstentions
and zero caller-order changes. Both saved public responses were verified for all
80 rows. The 14-document calibration bootstrap interval is approximately
70.9–91.0%; this is not the held-out pairwise gate. Order symmetry remains
structural because content-canonical caching restores the caller labels. The
original-rubric prefix had 61/78 agreements before futility; both raw outcomes
remain intact, with no earlier verdict reused.

A conditional held-out controller is queued after the GPT-OSS study. It rechecks
complete calibration, the unchanged source/profile identity and all ten readiness
controls after restart before querying the original 150 validation pairs. It
retains the full denominator and official document-cluster confidence interval;
no further prompt tuning, semantic/ranking stage or generator promotion is
authorized by that controller. Calibration remains distinct from qualification.

The repaired-rubric GPT-OSS profile also passed all ten readiness controls and
started its unchanged calibration. Both local model families now have protocol
readiness; neither is a complete qualified evaluator.

A separate watcher helper can reject later public controlled-semantic trials
as soon as failure is mathematically certain under the existing gates. It
reconstructs both saved public responses and pair hashes, then requests a normal
stop after the current pair on any preference for a known harmful mutation, or
when perfect remaining results cannot reach 95%. Missing/unattempted cases stay
in the full denominator, human preference data is forbidden, and the helper
cannot issue a qualification. Nine focused tests passed. This measurement-only
watcher leaves calibrated prompts, servers, runtime identities and thresholds
unchanged; no semantic inference has run under it yet.

The revised GPT-OSS study subsequently failed calibration at **42/80**: 25
agreements, 17 disagreements and zero observed abstentions. Even perfect remaining
judgments would yield at most 63/80, so its existing futility gate stopped the
run. Its 38 unattempted pairs are missing, not model abstentions. No held-out
GPT-OSS inference ran. Qwen then passed all ten controls again after restart and
began its original 150-pair held-out validation. No held-out content or provisional
agreement result has been used to tune either profile.

Primary-source review identified an additional independent family with official
Apache-2.0, ungated QAT exports: Google Gemma 4. Its 26B A4B model is registered
as a local developer judge; E4B is generator configuration **21**, resource-first.
Both text-weight files passed their published byte-count/SHA-256 checks; no
vision/audio projector or application pack was installed. Their embedded Jinja
templates exactly match the pinned first-party instruction templates. A native
vocabulary-only preflight verified architecture, 262,144-token vocabulary, static
control-token round trips and the explicit non-thinking boundaries for both.
This loaded no tensors for generation and produced no model verdicts. The
vocabulary-only training-context warnings are retained, not reported as inference
failures. Ten focused formatter/compatibility tests passed.

This review also exposed a concrete document-safety gap: ordinary revisions could
mutate or delete literal Gemma turn/channel and BOS/EOS markers in source text.
Six regression cases failed before extending the existing ordered-literal guard.
All twelve relevant old/new marker tests now pass, including a legitimate grammar
correction around unchanged markers. This narrow backend v11 change is separate
from the still-unpromoted Gemma model. Current Qwen validation retains its original
frozen judge source and is unaffected.

The Gemma judge is queued after Qwen validation, then the E4B resource probe and
conditional matched 52-case screen follow sequentially. The same 6 GiB desktop
RAM/1 GiB VRAM reserves and prospective 7 GiB application ceiling remain in force.
Their frozen source is
`ead3d7c4044e7eb43c04a6be0ce36a97f1df5782506ac5a3f520fec09f21e15b`.
No extra paid API request, default-model selection or installed memory-limit
change has occurred.

A static v10/v11 compatibility audit found identical control-literal lists on
**23,072 available recorded text fields across 5,290 earlier correction records**.
It binds the source implementations and result-file hashes and includes raw
model/pipeline traces where available. This is string-level compatibility, not
fresh inference, a full-request replay or editorial qualification.

Before inspecting any provisional held-out agreement, a separate rejection-only
validation watcher was frozen. It reconstructs both public responses, verifies
the locked pair/model identities and assumes every unqueried case succeeds for
its optimistic bound. It may request a normal stop only if the original
agreement, abstention or order gate is already impossible; it cannot qualify
anything or replace the document-cluster confidence interval. Ten focused tests
passed. The calibrated server/source remains unchanged. Watcher source:
`10e9c05518b96afddc775cc60939fd65053d415d5cb3c5951d0a062879fbe481`.

Qwen completed all **150/150 held-out pairs**, with **122 agreements (81.33%)**,
zero abstentions/order changes and verified saved public evidence. The official
25-document bootstrap interval is **70.39–91.14%**. Because its lower bound does
not exceed the frozen 75% requirement, **pairwise qualification failed**, despite
the passing point estimate. Calibration/validation document overlap is zero.
The rejection watcher correctly did not stop it: its limited point/coverage/
order bounds never became impossible, and cannot replace the final confidence
interval. No semantic or ranking inference followed this failure.

A separate Qwen thinking fallback was prepared before inspecting this final
qualification result. The earlier 1,536-token readiness failure used greedy
native reasoning, whereas the pinned publisher card offers sampled profiles.
The new bounded adaptation uses its precise-coding settings (.6/.95/20,
min-p 0, repeat 1, zero frequency/presence penalties), grammar-aware-v1, 6,144
native thinking tokens and 8,192 context. It keeps the old weights, ten GPU layers,
CPU KV, batch 128, four threads and desktop reserves; no forced closure or
private decoding/logging is allowed. Eleven focused dispatch/pin/prefix-resume
tests passed. The new fixed readiness prefix stops on its first failure and
requires all ten controls before the original 80-pair calibration. This remains
the same Qwen family and is not a new independent vote. Its source is
`57317678e83f71658712fc85f237044e185ee68573b6dbf7d6401bbda4cef45d`.
It is queued after the Gemma E4B study, conditional on a conclusive failure of the
existing non-thinking qualification. No new paid API request has run.

An offline Sol fallback proposal is prepared, **not approved or running**. It
would use `gpt-6.1-sol`, low reasoning, the same revised rubric, 2,048 input/output
bounds and only ten public controls plus the 80 exposed calibration pairs (67
unique payloads). Its separate US$0.50 ledger has `approved:false`; the closed
Luna allowance cannot authorize it. Two focused identity/approval-boundary tests
passed with mock transport and no network. The prepared controller closes its
allowance when the bounded study ends. It excludes validation, ranking, sealed
and manuscript inputs. No new API request ran, and no fresh spending approval
has been requested while the local profiles remain in progress. Source archive:
`b8299fd4d1709d41b6735e18a3bbe73551a052a13d40488ff05d39e8e8c84244`.

A fresh background Word document-session query again returned no executors.
No screen, focus, mouse, COM or other desktop workaround was attempted.

## Historical stopping checkpoint

Stopped on 12 November after incorrectly interpreting the budget threshold as
20% used. The user clarified that the threshold is **20% remaining (80% used)**.
The usage API subsequently reported 20% consumed, conflicting with the user's
reported 80% consumed. Work remained stopped until the user explicitly authorized
continuation later on 12 November, retaining the 20%-remaining threshold. The
API discrepancy remains unresolved; its latest reported value is 20% used.
This describes that historical checkpoint; the resumed read-only checks and the
user's later confirmation above resolved the remaining-versus-used discrepancy.
The exact frozen evaluations are being resumed from their saved checkpoints. The
implementation checkpoint was committed and pushed to main as `3cf9e61`.
All owned inference work was stopped and partial evidence retained. The larger source-
diagnosis screen has 20/100 incumbent reviewed-text cases, with candidate and
natural phases unstarted. The control-passed Magistral evaluator has seven of
80 calibration pairs recorded; its process was stopped during the next request,
so its raw ledger still says running and must not be treated as completed. A
separate operational checkpoint records the budget interruption. No candidate
was promoted and no installation, package version, model pin or memory limit was
changed. The stopping-point run passed **167 relevant tests** (81 sentence/service,
86 evaluation-tool cases); the complete application suite was not repeated.

The user authorized work until completion or weekly usage reaches **80% used
(20% remaining)**, with commits and pushes only to main at either stopping point.
Development evidence and research
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
2. Finish final-output natural-text/reference measurements and document/genre/
   dialect qualification. Corpus construction and partition inventory already
   passed: 2,698 cases include 1,398 natural cases, 186 declared source groups and
   837 sealed cases, with retained rights records. Conversation/construction
   grouping does not establish independent authors. Controlled expansion must
   not substitute for independent natural examples or final-output measurement.
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
