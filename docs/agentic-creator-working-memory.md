# Agentic Creator — Working Memory

Short and current. Read this first at the start of every session, before touching code.
Longer-lived material lives in the sibling docs: `-architecture.md`, `-decisions.md`,
`-implementation-log.md`, `-test-status.md`.

---

## Session handoff — 2026-09-09 late (9c and 9e-i landed; 9e-ii was in flight at the stop)

**Read this section first; the one below it is the previous stop and is still accurate for 9a/9b/9d.**

### What landed this session

| SHA | What |
|---|---|
| `f7379f1` | **D15**, the plan's 9e correction, and the handoff's stale "apply 111" step |
| `8994004` | Unit 9c — the review queue at `/admin/authors` |
| `143d315` | Unit 9e-i — reviewer decisions (approve / reject / request-rewrite) + migration 112 |
| `b0ed9c6` | **Review fix** — a decision on a run that already left review is refused |
| `3cc028e` | PROJECT_STATE: 111 and 112 recorded as applied on dev |

Gate re-run independently at `b0ed9c6`, not taken on report: **tsc 0, lint clean, 100 files / 932
tests** (from 99 / 916 at the last stop). `build:verify` green at `8994004`. **`test:e2e` NOT run this
session** — again.

### THE NEXT STEP

1. **`9e-ii` (reviewer publish) was still running when this session stopped.** Check `git log` before
   assuming anything about it. If it committed, **review the diff, do not trust the report** — every
   unit this phase has come back with at least one defect the suite passed over, including 9e-i's.
   Its brief is reproduced in substance by D15 plus the traps listed below.
2. **Everything else in Phase 9 is written and gated. Nothing has been run live.** This has now been
   true at three consecutive stops. Every real defect in Phases 6, 7 and 8 was found by running the
   thing; the 932-test suite has never once found one.
3. **To run it, flip `agentic_reviewer_workflow_enabled`** — it is `false` on dev, so `/admin/authors`
   renders only its "switched off" notice. It is a toggle on the Agents Overview page, not a
   migration. (`feature_flags.flag_key`, not `key`, if querying by hand.)
4. **Then insert an `agent_reviewers` row.** The table is applied and **empty**, so the only account
   passing `requireReviewer()` today is `ADMIN_USER_ID`, via the implicit short-circuit that never
   reads the table. Nothing exercises `can_publish` / `can_trigger_media` until a row exists — which
   means 9e-ii's publish gate is currently unprovable.

### Dev database, queried this session

Migrations **102-108, 110, 111, 112** applied; **there is no 109**; production has **none** of them.
5 `agent_runs` at `awaiting_review`, 5 stories with `agent_persona_id`, 3 `agent_evaluations`,
**0 `agent_reviewers`**, 0 `agent_review_decisions`.

**Migration 112 was applied by the owner mid-session, while the file was still uncommitted in the
working tree.** The applied schema was verified against the file and they match (9 columns, the
four-value `decision` CHECK, 4 FKs, RLS on with 0 policies, 2 indexes). **112 is now immutable** — any
change to it ships as 113, never as an edit, or the file and the database diverge permanently.

### The corrections this session made to the record

The pattern holds: five of the six findings were the *record* asserting something untrue, not the code.

1. **The handoff's "next step 1" was already done.** 111 was applied at 16:20:41+00.
2. **The plan's 9e said "reusing `publishStoryline`".** It cannot be reused: it takes
   `beats`/`choices`/`nodePath` from the client-side Zustand session and its only caller is
   `PublishDialog.tsx:195`. `autoPublishStoryline` (`persistence.ts:1217`) is the server-side path —
   it walks `parent_node_id` to the root itself via `walkPathToRoot` (`:1195`).
3. **Both publish paths stamp the CALLER as the storyline's owner and author** (`:2244`/`:2266` and
   `:1468`/`:1484`). A reviewer publish would put a staff account's name on agent fiction in the public
   gallery — D13's defect one layer up. **D15** resolves it.
4. **`media_pending` has no consumer.** No worker, no cron drains it; the only non-test references are
   the type union, `STAGE_SEQUENCE`, a doc comment and an exclusion at `orchestrator.ts:683`. An
   approve routed through it would look like progress and dead-end. 9e-i therefore moves the stage only
   on terminal outcomes.
5. **`agent_tasks.status` already permitted `approved`, `published`, `rejected`** (migration 106) and
   nothing wrote them. They were reserved for exactly this unit.
6. **`RunMonitor`'s four "reusable" helpers were all module-local and unexported.** Reuse required the
   extraction into `components/admin/agentic/run-presentation.tsx` that 9c performs.

### The defect review caught in 9e-i, and why it matters for 9e-ii

`recordReviewDecision` fetched the run and never checked its stage. Two reviewers hold the queue open;
A rejects (run → `cancelled`, task → `rejected`); B's page is stale, still lists the row, B clicks
approve; `agent_tasks.status` becomes `approved` for a draft that was rejected and whose run is dead.
The queue's optimistic client-side row removal is not a gate — **a server action is directly
invocable**. Fixed in `b0ed9c6` as the tested pure predicate `canRecordDecisionForStage`.

The delegated reasoning for omitting it was that decisions must stay re-recordable
(rewrite-requested, then later approved). That does not follow: both of those return `run: null` and
leave the stage at `awaiting_review`, so the guard preserves the sequence exactly. **9e-ii's publish
must go through the same guard.**

### Sharp edges still live

- **`requireReviewer()` is load-bearing security** (D14). Reviewer writes run service-role and bypass
  RLS entirely; the helper is the whole boundary.
- **`can_trigger_media` gates reviewers only.** An ordinary user narrating their own story has no
  reviewer row, and `canTriggerMedia(null)` is false. Checking the capability before the ownership
  branch silently breaks narration for every human on the site.
- **The 2×2 storyboard grid must never reach a viewer.** A published storyline's cover is
  viewer-facing, which makes this 9e-ii's sharpest trap.
- **`retryRun` cannot re-brief**, so `rewrite_requested` deliberately changes no state and triggers
  nothing. The redo is a separate commission.

---

## Session handoff — 2026-09-09 evening (Phase 9 started; two documented facts were wrong)

**Phase 9 is underway.** Full plan, self-contained, in `docs/agentic-creator-phase9-plan.md`. Read it
before touching this area — it carries the migration SQL, the per-unit edits and the verified facts.
Decisions **D13** and **D14** are the new authority.

### Two things the record asserted that were not true

Both would have shipped invisibly. This is the third phase running where the defects were in the
*record*, not the code.

1. **Unit 8d's specified derivation could never fire.** The handoff below says to derive `actorKind`
   inside `processNarrationJob` from `job.user_id === AGENTIC_SYSTEM_USER_ID`.
   `submitStoryNarrationBatch` (`narration-batch.ts:141`) stamps the job with `user.id` — **the
   caller**. A reviewer pressing narrate writes their own id, so the condition is always false. The
   unit would have compiled, passed all 877 tests, billed the reviewer exactly as before, and looked
   done. Resolved by **D13**: stamp the job with the story owner, so the payer of record is the system
   user and the bypass fires.
2. **The reviewer-write blocker is not RLS.** `PROJECT_STATE.md` frames it as "a reviewer RLS policy
   or an admin-client path". Every write path hardcodes its own ownership filter in application code,
   and the narration/image guards already run on the **service-role client** where RLS is bypassed
   anyway. A migration widening only RLS would have changed nothing observable. Resolved by **D14**.

Two smaller corrections, both in the plan's §1: `beats.UPDATE` is `generated_by = auth.uid()`, not
story ownership — a second predicate no doc records; and the architecture doc's claim that images need
the *system user's* tier promoted is wrong, because both image submits gate and bill **the caller**.

### The fact that shaped the design

`runMeteredNarrationOperation` (`narration.ts:108-140`) **already handles a `bypassed` authorization
correctly**, because its finalize and release branches are both guarded on `status === 'allowed' &&
reservationId` and only `denied` throws. So Unit 9d threads one optional field and reuses the entire
reserve→finalize/release cycle. The tempting alternative — mirroring `story-assembly.ts:386`'s direct
`authorizeBillableAction` call — is rejected in the plan's §2: it would be a second billing path for
narration, which is the shape D12 already paid for.

### Landed this session

| SHA | What |
|---|---|
| `b886780` | WORKING_AGREEMENTS: Opus plans and reviews, Sonnet executes — plus the delegation rules |
| `15f1431` | The Phase 9 plan |
| `c99f54e` | D13 and D14 |
| `54b4d14` | Unit 9a — `agent_reviewers`, migration 111, `requireReviewer` / `assertCanEditStory` |
| `b394c52` | **Review fix** — type-predicate narrowing; guards choose their own columns |
| `b7041b2` | Unit 9b — the four ownership guards delegate to `assertCanEditStory` |
| `8189bb4` | GOTCHAS: `saveBeat` is shared branching's path, not an owner-only one |
| `57b516b` | Unit 9d — agent narration bills the system user, not the reviewer |
| `cff8b76` | **Review fix** — D13 asserted a metadata column that does not exist |

Gate re-run independently: **tsc 0, lint clean, 99 files / 916 tests** (from 95 / 877),
`build:verify` green. `test:e2e` NOT run this session.

**9b reviewed by diff and found clean** — the first unit this phase with nothing to fix. Its one
deviation was a genuine catch the brief had missed: `saveBeat` is also shared branching's persistence
path, so gating it would have broken every non-owner continuing any story. Written up in GOTCHAS.

### THE NEXT STEP

1. ~~**Apply `111_agent_reviewers.sql` on dev.**~~ **DONE — the owner applied it.** Ledger row 111,
   `2026-09-09 16:20:41+00`. Queried 2026-09-09, not taken on report. Dev now carries 102-108, 110 and
   111 (there is no 109). **Production still has none of them.**

   Dev state as queried the same day, which is what 9c and 9e actually have to render:

   | | count |
   |---|---|
   | `agent_reviewers` rows | **0** |
   | `agent_runs` | 8, of which **5 at `awaiting_review`** |
   | stories with `agent_persona_id` | 5 |
   | `agent_evaluations` | 3 |

   Two consequences. **`agent_reviewers` is empty**, so today only `ADMIN_USER_ID` passes
   `requireReviewer()` — through the implicit-admin short-circuit, which never touches the table. That
   is enough to build and prove 9c; a second reviewer is only needed to prove the capability columns
   actually gate anything:

```sql
insert into public.agent_reviewers (user_id, status, can_publish, can_trigger_media, display_name)
values ('<a real auth.users id>', 'active', true, true, 'Test reviewer');
```

   And **`agentic_reviewer_workflow_enabled` is `false`** on dev (queried; `feature_flags.flag_key`, not
   `key`). 9c fails closed behind it per D8, so the queue renders nothing until it is switched on from
   the Agents Overview page. No migration — it is a toggle.

2. **9a, 9b and 9d are done and gated. 9c and 9e are not started.** 9c is the review queue at
   `/admin/authors` — the plan's §4 pins its nav definition, the `RunMonitor` pieces to reuse and the
   flag. 9e is reviewer decisions (approve / reject / publish), the least constrained unit.
3. **Nothing in Phase 9 has been exercised against a live database.** The whole gate is static. Every
   real defect in Phases 6, 7 and 8 was found by running the thing — treat this as required. The proof
   run is now possible without 9c: apply 111, insert a reviewer row, open an agent draft at
   `/story/[id]` as that reviewer, press narrate, then check **real TTS spend with zero coin
   movement**:

```sql
select action_key, status from public.beat_spend_reservations
 where related_story_id = '<agent story>';                 -- expect zero rows
select sum(beats_remaining) from public.beat_grants
 where user_id = '616af55e-8dfa-4a3e-bb0f-802462ef3333';   -- expect still 5.00
select task_key, phase, cost_usd from public.ai_cost_events
 where related_story_id = '<agent story>' order by created_at desc;   -- expect real spend
select user_id, status from public.narration_batch_jobs
 where story_id = '<agent story>';   -- user_id should be the SYSTEM user, not the reviewer
```

   Also check the reviewer's own wallet is untouched. The last query is the one that proves D13
   landed.
4. **The capability check in 9b is the sharp edge.** `can_trigger_media` gates reviewers only — an
   ordinary user narrating their own story has no reviewer row, and `canTriggerMedia(null)` is false.
   Checking the capability before the ownership branch silently breaks narration for every human on
   the site.
5. **`requireReviewer()` is load-bearing security now** (D14). Reviewer writes run on the service-role
   client and bypass RLS entirely; the helper is the whole boundary.

---

## Session handoff — 2026-09-09 (Phase 8 landed, but it is NOT the phase that was planned)

**Read this before anything else: Phase 8 did not build narration into the pipeline, and never will.**
The previous handoff's "PHASE 8 — narration — starts here" section below is superseded. Its billing
note was right and survives as the one unbuilt unit; its premise — that narration needs a paid,
long-running run stage — was wrong and was abandoned before any code was written. Decisions **D10**
and **D11** in `docs/agentic-creator-decisions.md` are the authority now.

### What Phase 8 actually turned out to be

The owner pushed back on the original plan as over-engineering, and was right. Batch narration
already exists, a reviewer is already in the loop at `awaiting_review`, and the persona already
carries a voice. So the question stopped being "how does the pipeline narrate" and became "why
doesn't the persona's voice work" — and the answer was that it never had.

**The defect this phase actually fixed.** `agent_personas.preferred_voice` has held a real value for
all 15 seed personas since migration 104, and **nothing in the codebase read it**. Traced end to end:
`stories.narrator_voice` was NULL on every agent story, so `resolveNarrationVoiceServer` resolved the
mode to `legacy_auto`, `resolveNarrationVoiceDecision` (`lib/ai/narration-voice-resolver.ts:37-54`)
returned `shouldUseLegacySelector: true`, and `selectLegacyNarratorVoiceServer` fired **a Gemini
call** picking from all 30 provider voices by genre and tone. The persona's voice was decorative.
Worse, `narrator_voice` locks on first use, so that model-chosen voice would have become permanent
for the story *and every episode extended from it*.

### Commits this session, all reviewed by diff rather than by report

| SHA | What |
|---|---|
| `e561049` | Unit 8a — `lib/agentic/persona-voice.shared.ts` + 21 tests, migration 110 + rollback |
| `4ef4553` | **Review fix** — two false claims in migration 110's header |
| `e199666` | D10 + D11, and the doc conflicts they resolve |
| `250d493` | Unit 8b — the persona editor's voice dropdown; `approved_voice_pool` retired from the UI |
| `57074dd` | **Review fix** — the dropdown ignored 8a's case-insensitive resolve |
| `c3ee223` | Unit 8c — the voice locks into the draft at `draft_created` |
| `5668c2f` | **Review fix** — the timeline reported the lock before the save that performs it |

Gate, re-run independently rather than taken on report: **tsc 0, lint clean, 95 files / 854 tests
(+1 file, +21 from the 94 / 833 baseline), `build:verify` green, `test:e2e` 15 passed / 0 skipped.**

### What reading the diff caught that the tests did not

Four defects across three delegations, none reachable by the 854-test suite. Note the pattern — as in
Phase 7, most are *the record asserting something untrue*, which is exactly what a later reader
trusts:

1. **Migration 110's header pointed at a file that will never exist.** It said the migration was
   meaningless on prod "until 102-109 land first, in numeric order". There is no 109 — see below —
   and "numeric order" contradicts the ledger being the only source of truth for what has run.
2. **The same header called the persona editor "not-yet-built".** It has always existed and has
   always exposed this field, which undercut the very paragraph it sat in: that paragraph's point was
   that the migration's re-run guard will not stomp an operator's edit *made from that editor*.
3. **The voice dropdown ignored 8a's case-insensitive resolve.** For a row storing `"leda"`,
   `buildPersonaVoiceOptions` emits no out-of-list option (the value resolved fine, so there is
   nothing unrecognised to append) while the dropdown's value stayed the raw `"leda"`, matching no
   option's `"Leda"`. The control rendered as though nothing were selected **on a persona with a
   perfectly good voice** — and an admin "fixing" the apparently-empty field would have silently
   changed a voice that was never wrong. Both halves now go through `resolvePersonaVoice`.
4. **The run timeline claimed the voice was locked before the save that locks it.** Reported
   immediately after resolving, ahead of `saveStoryForUser`; a save that threw would leave a timeline
   asserting a lock that never happened, on a draft that does not exist. Moved beside the existing
   "Draft story saved" event.

A fifth was caught by a subagent and is worth keeping: `PersonaCatalogue`'s `personas` state is
**replaced by a filtered subset** on every filter change, so building the voice-usage map from it
would have hidden a filtered-out persona from the sharer hints. It now tracks an unfiltered roster
alongside. Archive is the only other mutation path and goes through `upsertPersona`, which syncs
both; there is no delete path, so the parallel state cannot drift.

### Novelty work — four more commits, and the second live run

The second Test Lab run (`e4c7d1e7`, same persona) was **terminally blocked** by the novelty check at
100% title similarity, 0 of 8 beats, all 3 attempts spent. Investigating it found a real defect and
two design gaps. Full reasoning in decision **D12**.

| SHA | What |
|---|---|
| `280a372` | `formatPersonaMemoryForBrief` — token-bounded memory block + 13 tests |
| `dd0b514` | `loadPersonaMemory`, and the block wired into the brief prompt |
| `38759b4` | Novelty reasons now name the prior they collided with |
| `81f16f8` | A block clears the brief + cached verdict and re-briefs on the next attempt |

Gate, re-run independently: **tsc 0, lint clean, 95 files / 877 tests (from 854), `build:verify`
green.**

- **The block was correct, not a false positive.** `agent_story_memory` genuinely held `कट-ऑफ` from
  the run 40 minutes earlier. Checked for the failure mode this codebase keeps hitting — Devanagari
  normalising to an empty string, the way JS `\b` and `detectDominantScript` have — and that was
  **not** what happened. The scorer was right.
- **`agent_persona_memory` was written and read by nothing**, exactly like `preferred_voice` before
  D11. That is now twice in one phase; when you find a table this system maintains, check that
  something consumes it.
- **The Test Lab's task brief is identical boilerplate** for a given persona ("Persona Test Lab run
  for X. Speciality: … Preferred genres: …"), so leaving **Theme** blank makes two runs of the same
  persona near-deterministic. That is why the titles matched. Leaving Theme blank is now the sharpest
  way to *test* the memory fix — it should no longer collide.
- **The supervisor is not implicated.** Verified by querying its commissions: both runs were
  `origin: 'test_lab'`. For real commissions it writes a concrete per-gap brief.

### Things that will bite you in this area

- **`advanceRun` never regresses `stage`, so a brief can only be regenerated inside
  `runNoveltyStage`.** The obvious implementation — delete `brief_ready` from the checkpoint and
  expect `advanceRun` to re-dispatch to `runBriefStage` — **does not work**, and this was gotten wrong
  once during planning. `advanceRun` computes `target = nextStage(run.stage)` from the persisted
  column, and `handleStageFailure`'s retry branch touches `status` and the error columns only. A run
  sits at `brief_ready` for its whole life, so every attempt after the first dispatches to
  `novelty_checked` again, never back to `runBriefStage`. `runNoveltyStage` is therefore the only
  place a brief is ever regenerated, and it says so in a header comment.
- **Both brief paths share `generateStoryBrief`, and that is load-bearing for billing.** A regenerated
  brief is real spend — `authorizeAgenticSpend('preview_seed_plan', …)` — with the idempotency key
  carrying `:rebrief:${run.attemptCount}` so each attempt takes its own reservation rather than
  colliding with the first. A parallel re-brief implementation would have been an unbilled paid call
  or a duplicate-key conflict. It also means the re-brief inherits the persona memory block for free.
- **The retry budget is the only bound on re-briefing, deliberately.** `max_attempts = 3` yields at
  most two re-briefs. There is no separate counter, and adding one would be a second thing to get
  wrong.
- **Injection caps are not the storage caps.** Storage keeps 50 per field; the prompt gets 5 titles,
  3 premises truncated to 120 chars, 10 names, 5 settings, 5 themes, under a 1500-char ceiling. If you
  raise these, re-run the stuffed-memory test — it exists to prove the block cannot grow with a
  persona's history.
- **`appendCapped` prepends, so index 0 is the NEWEST entry.** `takeMostRecent` slices the head.
  Slicing the tail would feed a persona its oldest history, return the same *count*, and be invisible
  to any test that only checks length — which is why there is a test asserting *which* entries
  survive.
- **The admin Retry button cannot re-brief.** `retryRun` never touches `checkpoint`, so it replays the
  cached block. Recorded in PROJECT_STATE's deferred list.

### THE NEXT STEP

1. **Run the Test Lab against Kabir Sinha again, with Theme left blank.** That is the exact condition
   that produced the collision, so it is the honest test. Expect a different title, and either no
   block or a block that visibly re-briefs. Watch for:

```sql
select stage, level, message from public.agent_run_events
 where run_id = '<new run>' order by created_at;
-- a block should now read "... (\"<prior title>\") ..." and be followed by
-- "Brief regenerated after a prior collision (… avoiding N prior title(s))."
select recent_titles, story_count from public.agent_persona_memory m
  join public.agent_personas p on p.id = m.persona_id where p.slug = 'kabir-sinha';
```

2. ~~None of the four commits above has been exercised against a live database.~~ **Done
   2026-09-09** — run `2accd281`, story `568fb4bd`, same persona, blank Theme (the exact condition
   that collided before). Novelty returned **`clear` on the first attempt**: title `रफ़ कट` (vs
   `कट-ऑफ`) and an entirely fresh cast (आदि, वरुण, नीलिमा — no reuse of समर/ईशान/प्रिया). 8 beats,
   `awaiting_review`, voice locked to Charon. Zero word-cap failures, where the previous run lost 2 of
   3 attempts to the cap. Production data also confirms the recency direction independently of the
   unit test: `recent_titles` reads `["रफ़ कट","कट-ऑफ"]`, newest first.

   The run's one retry was **unrelated** — `Gemini timeout after 60s (seeded_beat_materialization)` —
   and is filed under `story_generated`, which is `d1b6d12` working live; before it, that line would
   have been attributed to `novelty_checked`. The run then resumed and finished all 8 beats, so the
   checkpoint contract held through a mid-loop provider failure without re-paying.

   **STILL UNPROVEN: the re-brief path itself (`81f16f8`).** Novelty came back clear, so the
   clear-checkpoint / accumulate-avoid-list / regenerate branch has never executed. It is the only
   part of this work with no live evidence, and exercising it means deliberately making a persona
   collide — e.g. running the same persona repeatedly with a blank Theme until it repeats itself.
3. **A succeeded run still carries a stale `error_category`.** `handleStageFailure` writes it and
   nothing clears it on success, so `2accd281` shows `succeeded` alongside `error_category:
   'unknown'` and an "Attempts 2/3" pill. Not false — it did fail once — but it reads as a warning on
   a healthy run, and `unknown` is an unhelpful category for a provider timeout. Small; unclaimed. Every real defect in Phases 6, 7 and 8 was found by running the thing, including the two
   this session's runs found. Treat step 1 as required, not optional.
4. **Unit 8d (agentic narration billing) is still unbuilt**, and still belongs with Phase 9's
   reviewer-authorization work — see the earlier handoff section below for its full shape.

---

### After the first live run — five more commits

The proof run (`8fa3a959`, persona Kabir Sinha, 8 beats) confirmed every Phase 8 claim: the story
carries `Charon` / `user_selected` / `male` / `hi-IN`, `story_config.narrationVoice` agrees, and the
timeline reads `Draft story saved (8 beats).` **then** `Narration voice locked from persona: Charon.`
— the right order. The persona has `allow_narration = false` and the voice locked anyway, as decided.

It also surfaced two things that were not Phase 8, and a third fell out of fixing them:

| SHA | What |
|---|---|
| `d1b6d12` | Stage-failure events were filed under the stage the run sat on, not the one that failed |
| `57bcf99` | Agent personas exempted from the 500-word seed source cap |
| `382fa6e` | Human seed source cap 500 → 800 |
| `2dcd095` | The prompt cap becomes a hardcoded 800 constant; its admin setting removed |
| `cbf759f` | **Review fix** — a dead 500 constant, and the shipped admin manual |

- **The stage-attribution bug was the deferral bug's twin.** `fe9406f` fixed it for deferrals in
  Phase 6; the failure path had the identical defect and was never fixed. Evidence was two
  `Seed source response exceeds the 500-word cap` warnings — unmistakably `story_generated` work —
  filed under `novelty_checked`. `handleStageFailure` now takes an explicit `failedStage`. The outer
  safety-net catches in `executeRunNow`/`drainAgentRuns` still pass `run.stage`, deliberately: they
  wrap the whole `advanceRun` call and have no single target stage in scope.
- **The word cap was a prompt contradiction, not a flaky model.** `buildSeedSourcePrompt` asked for
  N scenes *and* "under 500 words" — for 8 beats that is ~62 words/scene, while an adults persona at
  beat-length level 4 targets ~150. The run burned 2 of 3 attempts on it, each a paid call thrown
  away, and succeeded with **zero retries left**. There were **two** enforcement points and missing
  either leaves the cap in force: the throw in `story-assembly.ts`, and `generateSeedPlanPreview`
  re-validating the same cap. The latter now takes `enforceSourceWordCap`, defaulting to `true` so
  the human path is byte-for-byte unchanged.
- **Removing the cap cannot leak into grading.** `evaluation.shared.ts` skips the beat-length check
  entirely under `sourceFidelity === 'strictly_follow'`, which the pipeline always uses. Verified
  before the change, not assumed.
- **Both human caps are now hardcoded at 800 and there is no admin control for either.** They are
  separate constants on purpose: `STORY_PROMPT_WORD_CAP` bounds the typed prompt,
  `SEED_SOURCE_WORD_CAP` the pasted story. The `story_authoring_word_cap` flag row still exists on
  both environments and **is read by nothing** — editing it has no effect. Do not "fix" a cap there.

### Things that will bite you if you do not know them

- **There is no migration 109, and there will not be one.** The gap is deliberate. An
  `agentic_narration_enabled` flag was planned to mirror `agentic_image_generation_enabled`, and was
  dropped when narration became a reviewer action: with a human pressing the button, the human is the
  kill switch. Do not go looking for the file, and do not treat 110 as blocked on it.
- **Migration 110 is applied on dev (2026-09-08), and nowhere else.** It is data-only: it moves
  `riya-sen` from `Leda` to `Callirrhoe`. That is the one *real* voice collision among the seeds — 15 personas share 12
  voices and four voices are doubled, but three of those pairs write in different languages and never
  reach a listener side by side. `madhurima-bose` and `riya-sen` are both Bangla. Callirrhoe was
  already inside riya-sen's own seeded `approved_voice_pool`. Verified on dev against the data rather
  than the ledger alone: zero personas now share a voice within a language, and all 15 voices sit
  inside the exposed 12. **Production has none of 102-110.**
- **Uniqueness is deliberately not enforced, and must not be added.** 15 personas into 12 voices is
  arithmetically impossible; enforcing it would make three personas unsavable. The dropdown *informs*
  — it names every other persona on a voice and distinguishes the same-language case — and never
  blocks.
- **`approved_voice_pool` is vestigial, not removed.** The column and its seeded data stay; the
  editor no longer shows it and nothing reads it. `mapInputToRow` only writes a column when its key
  is present on the patch, so the editor *omitting* the key is what preserves existing values —
  sending an empty array would erase them. Treat a value in that column as history, not configuration.
- **The voice locks regardless of `persona.allow_narration`.** That flag gates producing audio, not
  declaring which voice audio would use. A locked voice generates nothing; a null one is exactly what
  triggers the legacy Gemini selector. This will look like a missing permission check — it is not,
  and there is a comment at the site saying so.
- **`narration_voice_mode: 'user_selected'` is load-bearing, not cosmetic.**
  `resolveNarrationVoiceDecision` takes its user-selected branch whenever the *persisted* mode reads
  `user_selected`, without re-checking the global `narration_user_led_voice_selection_enabled` flag.
  Writing that mode is what makes the lock survive an operator turning that flag off later. Writing
  the gender bucket matters too: without it the resolver measures a male voice against the female
  list and warns.

### THE NEXT STEP

1. ~~Apply `110_riya_sen_narration_voice.sql` on dev.~~ **Done 2026-09-08**, verified against the
   data: ledger row present, `riya-sen` on `Callirrhoe`, and this returning no rows, which is the
   property that actually matters rather than the single value changing:

```sql
select preferred_voice, language, array_agg(slug order by slug), count(*)
  from public.agent_personas where preferred_voice is not null
 group by preferred_voice, language having count(*) > 1;   -- expect zero rows
```

2. **Run a fresh Test Lab run, promote it, and verify the lock actually took.** Nothing in this phase
   has been exercised against a live database — the whole gate is static. This is the step that found
   Phase 6's three defects and Phase 7's two, and it has not been done here:

```sql
select id, narrator_voice, narration_voice_mode, narration_voice_gender_bucket, narration_language_code
  from public.stories where agent_persona_id is not null order by created_at desc limit 3;
select stage, level, message from public.agent_run_events
 where message ilike '%narration voice%' order by created_at desc;
```

   Expect the persona's own voice, `user_selected`, a real bucket, and a language code matching the
   persona's language. The three existing agent stories on dev were saved before this change and will
   still read NULL — correct, not a regression.

3. **Unit 8d is the one unbuilt unit, and it is not optional before anyone narrates an agent story.**
   `authorizeCoinOperationForUser` (`lib/pricing/coin-economy.ts:69`) never accepts or forwards
   `actorKind`, so the agentic bypass in `authorizeBillableAction` (`lib/pricing/enforcement.ts:283`)
   is unreachable from every narration path. Cost is 0.50 beats per beat for
   `generate_story_narration` plus 0.30 for `align_story_text_overlay` riding inside the same call
   (both verified against `pricing_action_costs` on dev) — 0.80/beat against a system user holding
   **5.00 beats**, so an 8-beat story runs out partway, after real Gemini spend on the beats that
   succeeded. The shape: thread `serverAuth: { userId, actorKind? }` — the existing parameter, one
   new optional field, no new argument at any hop — from `processNarrationJob` down through
   `generateAndPersistStoryNarrationWithOverlay` → `generateAndPersistNarration` →
   `runMeteredNarrationOperation` → `authorizeCoinOperationForUser`, plus
   `buildMeteredStoryOverlayTiming` for the alignment meter. **Derive `actorKind` inside
   `processNarrationJob`** from `job.user_id === process.env.AGENTIC_SYSTEM_USER_ID`, not at submit
   time: `reconcileStoryNarration` and `reconcileActiveNarrationJobs` both re-enter there with no
   agentic context, so submit-time stamping loses the bypass on every recovery path. The claim is not
   trusted — `authorizeBillableAction` independently re-checks the id and the flag before bypassing.

4. **8d and Phase 9's reviewer-authorization fix are two halves of one thing.** Neither is observable
   alone: `submitStoryNarrationBatch` (`app/actions/narration-batch.ts:132`) throws `Forbidden.` on a
   story the caller does not own, and agent drafts are owned by `AGENTIC_SYSTEM_USER_ID`, so a
   reviewer cannot press the button 8d makes billable. Strongly consider doing them together in Phase
   9 rather than shipping 8d into a surface nobody can reach. **The same is true of images** — the
   architecture doc's known limits record the two things images need that narration did not.

---

## Session handoff — 2026-09-08 (Phase 7 core landed; the evaluator has NOT yet run)

**PHASE 7 IS COMPLETE AND PROVEN LIVE.** All four units (7a-7d) are written, gated and reviewed by
diff. The `evaluated` stage is no longer a free advance: it computes a real grade, records it,
surfaces it to an admin, and hands the run to a human. Migration 108 is applied on dev. The Test Lab
now previews the deterministic verdict before you press Create draft.

**Next: Phase 8 (narration).** `narration_pending` and `narration_complete` are still free advances
in `storyAssemblyExecutor`, logging "not implemented yet (Phase 8)". Phase 9 is the reviewer queue,
Phase 10 is media/publish.

### The proof run — 2026-09-08, run `73283a43`, story `57f01e35`, persona Arjun Rao

A Test Lab run of 8 beats, promoted to a draft, drained through to `awaiting_review`. All four
checks pass:

| Check | Result |
|---|---|
| `agent_evaluations` row | exactly one, `trigger_source = 'pipeline'` |
| verdict / readiness | `concerns` / `ready_for_review` |
| model | `applied`, `gemini-3.5-flash`, all six scores present |
| `evaluated` run event | `Evaluation verdict: concerns (ready_for_review), model applied, 1 warning(s).` |
| `ai_cost_events` | one row, `task_key = agent_story_evaluation`, phase `evaluated`, $0.0025 |
| coin movement | **zero** — 0 `beat_usage_events`, 0 `beat_spend_reservations` (D9 holds) |

**D9 was proven by this run, not merely asserted.** The model returned
`{coherence 5, ageFit 5, pacing 5, personaFidelity 5, safety 5, learningValue 4}` — near-perfect,
and certainly not a story it wanted flagged. The deterministic layer found every beat under the
word floor and returned `concerns`. **The final verdict was `concerns`.** The model's optimism did
not soften it, which is the entire point of the decision.

Be precise about what that does and does not prove, though. The **mechanism** is demonstrated: a
deterministic finding survived a model that disagreed with it, exactly as designed. But the finding
itself turned out to be a false positive (defect 2 below), so after `799bcad` this same run grades
`pass`. D9 holds as a design — the model never got to overrule the layer that decides — while the
concrete verdict produced that day was wrong for an unrelated reason. Both are true, and conflating
them would misread the evidence in either direction.

### The decision this phase turned on — read before touching the evaluator

**An evaluation never stops a run.** The `evaluated` stage has no failure path at all. Not a
missing persona, not a missing checkpoint, not a model timeout, not an unapplied migration 108 —
every one becomes an `agent_run_events` warn line plus an advance. The only non-advance exit is
`deferred` (master flag off, or the run's budget already gone), which loses no work.

Why: by the time `evaluated` runs, `draft_created` has already saved a real row to `stories`.
`advanceRun` routes a thrown or `failed` executor outcome into `handleStageFailure`, and every
reviewer surface keys on runs at `awaiting_review`. Failing here strands a finished story —
invisible to review, still in the database, all the generation already paid for.

**And the model gets no vote on `verdict` or `review_readiness`, in either direction.** This
extends `32f2c65` rather than contradicting it. There, a model could *soften* a deterministic
verdict because a `block` was terminal and a too-harsh threshold would kill a good story — a rescue
valve with a real cost if absent. Here nothing is terminal, so there is nothing to rescue from, and
a softening vote would let an unauditable call talk a story past objective facts (wrong script,
restricted theme present, beats missing). Same principle, different stakes: **a model call may
never be the sole cause of an automatic consequence.** Full reasoning in decision **D9**.

### Commits this session, all reviewed by diff rather than by report

| SHA | What |
|---|---|
| `c0d33dc` | `evaluation.shared.ts` + tests, and migration 108 with its rollback twin |
| `464dbac` | **Review fix** — three corrections to the pure evaluator (below) |
| `59bf800` | `evaluation.ts` (server half) + the two `story-assembly.ts` wiring changes |
| `09be807` | **Review fix** — two holes in the stage that cannot fail (below) |
| `ddf6047` | Unit 7c — `AgentRunDetail`, and the run monitor's Evaluation panel |
| `1cff69f` | **Review fix** — a verdict footnote that rendered where no verdict was |

Gate, re-run independently rather than taken on report: **tsc 0, lint clean, 94 files / 821 tests
(+1 file, +69 from the 752 baseline), `build:verify` green, `test:e2e` 15 passed / 0 skipped.**

### What reading the diff caught that the tests did not

Six real defects, none of which the 821-test suite could have found — two are unreachable without
a live database, four are accuracy of the record. Note how few of these are logic errors: most are
a comment, a doc, or a piece of rendered copy asserting something that is not true. Tests do not
check those, and they are exactly what a later reader will trust.

1. **A thrown read could still fail the stage.** `runEvaluatedStage` awaited
   `getPipelineEvaluationForRun` bare. That function only swallows the schema-missing cases it
   latches on and rethrows everything else, and a thrown executor goes straight to
   `handleStageFailure`. One transient Postgres error would have stranded a saved draft — the exact
   outcome the whole stage exists to prevent. The "no failure path" rule was true of every branch
   that returned and false of the one line that threw.
2. **The time-budget guard was dead code.** It measured from `Date.now()` at the top of
   `runEvaluatedStage` and then checked after a flag read and three short queries — ~200ms against a
   20s budget, so it could never fire. Now measured from `run.claimed_at`, the meaningful origin: if
   `draft_created` already burned the pass's budget, this stage starts over it.
3. A comment claimed every JSON parser in the codebase strips markdown fences. It is false, and the
   subagent that wrote it had already verified it was false. Fence-stripping here is a deliberate
   *departure* from `parseStoryBrief`, and the comment now says why.
4. `detectDominantScript` counted **U+FEFF as an Arabic character** — it is the last code point of
   Arabic Presentation Forms-B but is the BOM, not a letter. The range now stops at U+FEFC.
5. The restricted-theme check's real coverage was overstated — see the known limit below.
6. **Unit 7c's Evaluation panel told the reader something untrue.** Its footnote — "the verdict
   above is decided by the deterministic layer alone" — sat outside the three-state ternary, so it
   rendered under "Not evaluated yet" too, pointing at a verdict that was not on screen. The panel
   exists to make the deterministic/model split legible; a note that appears where nothing was
   decided undermines exactly that.

### TWO DEFECTS the proof run exposed — both now FIXED

**1. `retryRun` silently marked a permanently-failed run as SUCCEEDED.** Fixed in `045eea4`;
`b7ac6093` is now safe to retry and will resume at `novelty_checked`. The mechanism, worth
remembering because the shape recurs:
`handleStageFailure` sets `stage = 'failed'`. `retryRun` (orchestrator.ts:1265) then resets
`status`, `attempt_count` and `error_detail` — **but not `stage`**. The next drain claims the run,
`nextStage('failed')` returns `undefined` because `'failed'` is in `TERMINAL_STAGES`, and
`advanceRun` (orchestrator.ts:779) falls into its defensive branch and writes
`status = 'succeeded'`. Net effect: no work is done, the failure reason is erased, and the run
shows a green Succeeded pill. That branch's own comment says "a claimed 'pending' run should never
already sit on a terminal stage" — but `retryRun` is a first-party path that produces exactly that
state, so the assumption was false and is corrected in the same commit. It never fired in
production: `b7ac6093` was the only failed run and nobody pressed Retry on it.

**The fix** is `resumeStageFromCheckpoint(checkpoint)` in `orchestrator.shared.ts` — the last
`STAGE_SEQUENCE` member present in the checkpoint, `queued` if none. It walks `STAGE_SEQUENCE` and
tests membership; it must **never** iterate the checkpoint's own keys, because
`story_generated_progress` (`STORY_PROGRESS_CHECKPOINT_KEY`) is an intra-stage progress
side-channel written into that same object and is not a stage. A "last key in the object" approach
would pick it. `retryRun` applies this only when the current stage is terminal.

**2. ~~Agentic beats come out short.~~ WRONG — it was the evaluator's own false positive.** Both
defects here are now **FIXED** (`799bcad`, `045eea4`, `fcd55cd`); this entry is kept because the
first reading of the evidence was wrong in an instructive way.

The first diagnosis here said the beats were a generation defect: story `57f01e35` is
`ageGroup: adults`, `beatLength.level: 4` → target **150 words/beat**, floor 72, and the eight
beats were **41, 61, 54, 45, 41, 53, 49, 44**. All true, and all irrelevant. The agentic pipeline
always generates at `sourceFidelity: 'strictly_follow'`, and in that mode `seed-authoring.ts`
splices the source prose into `storyText` **verbatim** (`:176`) and its own `validatePlan`
**deliberately skips this exact word-count check** (`:146`) — because the words are the author's,
not a model's, to fit a band. The evaluator was re-litigating a decision another layer had already
made, and would have done so on essentially every agentic story, making `concerns` the permanent
verdict and draining the grade of meaning.

The lesson worth keeping: **a deterministic check that fires on 100% of real cases is evidence
about the check, not about the content.** The instinct to trust it because it is deterministic is
exactly backwards — deterministic only means it will be consistently right or consistently wrong.

### Things that will bite you if you do not know them

- **The two Phase 6 drafts can never be evaluated.** Both older `awaiting_review` runs on dev
  (`e9cd7325`, `ca2bb41b`) already have `evaluated` in their `checkpoint`, banked by the Phase 6
  placeholder that advanced the stage for free. `isCheckpointed` is therefore true and `advanceRun`
  applies the stage without calling the executor — forever. They will sit in the Evaluation panel's
  third state ("passed Evaluated, stored no grade") permanently, which is what that state is for.
- **Migration 108 is applied on dev (2026-09-08), and on nothing else.** Verified against the
  schema itself, not just the ledger row: 12 columns, RLS on, `anon` and `authenticated` both
  denied SELECT, 0 rows, and `idx_agent_evaluations_pipeline_run` confirmed UNIQUE *and* partial
  (`WHERE trigger_source = 'pipeline'`) — which is the guarantee `getPipelineEvaluationForRun`
  leans on. **Production still has none of 102-108.** Where it is unapplied the code fails closed:
  the evaluation is still computed and still written into `agent_run_events`, only the persist is
  skipped, so a run produces a grade in the timeline and no `agent_evaluations` row.
- **The restricted-theme check is effectively English-only against beat text.** Verified by query,
  not assumed: all 15 seeded personas store `restricted_themes` as English phrases, including the 12
  writing in Hindi, Bangla, Gujarati or Marathi. JS `\b` is defined over `[A-Za-z0-9_]` and never
  holds beside a Devanagari/Bengali/Gujarati/Arabic character. The `briefThemes` half works for
  every persona, because `buildStoryBriefPrompt` asks for themes *in English* while the prose goes
  in the target language. It fails **open** — a missed restriction, never a false one — and the
  model's `safety` dimension covers the same ground advisorily.
- **`evaluation.ts` has no unit tests, deliberately.** It is `server-only`, like `memory.ts` and
  `story-assembly.ts`, so vitest cannot import it. Everything decidable without a database lives in
  `evaluation.shared.ts` and is tested there. Do not add a mock-Supabase harness for it; that is not
  how this codebase is organised.
- **`getPipelineEvaluationForRun` is load-bearing, not defensive.**
  `idx_agent_evaluations_pipeline_run` is a *partial* unique index on `(run_id) WHERE
  trigger_source = 'pipeline'`, so a second pipeline insert is a constraint violation. Without the
  read-first check, a crash between the insert landing and the orchestrator's checkpoint write would
  make every retry pay for a fresh model call and then fail to record it at all.
- **`app/actions/gemini-proxy.ts` needed widening.** `AgenticJsonCallParams.task` never listed
  `agent_story_evaluation`, even though that TaskKey was pre-registered in `model-config.shared.ts`.
  Additive one-literal fix in `59bf800`. If Phase 8 adds a narration-side agentic call, expect the
  same gap.

### THE NEXT STEP

1. ~~Apply `108_agent_evaluations.sql` on dev.~~ **Done 2026-09-08**, schema verified (above).
2. ~~Start a fresh run and verify it end to end.~~ **Done 2026-09-08** — run `73283a43`, all four
   checks green. See "The proof run" at the top of this handoff. The verification queries, if you
   need them again (note `ai_cost_events` has no `action_key`/`phase` columns — it is `task_key`
   and `metadata->>'phase'`):

```sql
select verdict, review_readiness, model_status, model_id,
       jsonb_array_length(warnings) as warning_count, scores
  from public.agent_evaluations;
select w->>'code', w->>'severity', w->>'source', w->>'message'
  from public.agent_evaluations, jsonb_array_elements(warnings) w;
select stage, level, message from public.agent_run_events
 where stage = 'evaluated' order by created_at;
select task_key, model_id, estimated_cost_usd, metadata->>'phase' from public.ai_cost_events
 where activity_key = 'agentic_creator' and metadata->>'phase' = 'evaluated';
```
3. ~~Then Unit 7c.~~ **Done 2026-09-08** (`ddf6047` + review fix `1cff69f`). `getRunAction` now
   returns `AgentRunDetail` — the run, its timeline, and every `agent_evaluations` row — and the
   detail row grew a third panel spanning both columns. Two things in it are load-bearing:
   - **The evaluation fetch fails open, separately from the run fetch.** `listEvaluationsForRun`
     rethrows anything it does not recognize as "108 missing", and the panel is supplementary to
     the timeline. One transient Postgres error must not blank the detail row. Same defect class
     as the Unit 7b `getPipelineEvaluationForRun` hole — this is now the second time this exact
     shape has appeared in Phase 7, so assume the third is coming.
   - **The panel has three states, not two.** Evaluations present; empty and `evaluated` not in
     `run.checkpoint`; empty and `evaluated` *is* in it. The third is not hypothetical —
     `e9cd7325` and `ca2bb41b` bank `evaluated` for free from the Phase 6 placeholder and will
     sit there permanently. Collapsing it into "not evaluated yet" would state a falsehood about
     a run that was, in fact, evaluated.
4. ~~Then Unit 7d.~~ **Done 2026-09-08** (`4eb5c8b` + hardening `88e4118`). The Test Lab's
   "Evaluation (preview)" section runs `runDeterministicEvaluation` on the parked beats — no model
   call, no write, recomputed inline on every view (deliberately **not** cached the way its
   `postNoveltyPreview` neighbour is, because nothing here is paid or written). Two properties
   make it worth trusting, and one bounds that trust:
   - `toEvaluatedBeats` in `evaluation.shared.ts` is now the **single** `StoryBeat[] →
     EvaluatedBeat[]` mapping, used by both the preview and the real `runEvaluatedStage`. Two
     copies could have drifted, and a preview that disagrees with the grade is worse than none.
   - `sourceFidelity` is read from `AGENTIC_SOURCE_FIDELITY`, not from the Test Lab's own
     `storyConfig`. That field is never set there — it only arrives as `normalizeStoryConfig`'s
     `DEFAULT_AUTHORING` fallback, so the two agreed only because a default matched a constant.
     Now the preview asks the same question the pipeline will.
   - **The bound:** `noveltyVerdict` is `null` in the preview, because `draft_created` (which
     carries the post-generation verdict) has not run. So the preview's verdict equals the real
     one *except* that a novelty-driven warning can still appear later. The panel says exactly
     this, in both directions — an operator who thinks it merely indicative will ignore it, and
     one who thinks it final will be surprised.

### PHASE 8 — narration — starts here

`narration_pending` and `narration_complete` are still free advances in `storyAssemblyExecutor`
(`story-assembly.ts`, the block above the flag read), logging "Narration is not implemented yet
(Phase 8); advancing without it." Before designing it, note two things this phase already learned:
- `app/actions/gemini-proxy.ts`'s `AgenticJsonCallParams.task` union needed widening for
  `agent_story_evaluation` even though the TaskKey was pre-registered. **A narration-side agentic
  call will hit the same gap.**
- Narration is a paid, long-running, externally-triggered job — much closer to
  `narration-batch.ts` and the media workers than to the evaluator. It will need the
  reserve→finalize/release billing cycle, not the telemetry-only shortcut D9 chose for evaluation,
  because unlike a grade it produces an artifact a user can keep.

---

## Session handoff — 2026-09-07 (Phase 6c complete; THE PIPELINE HAS RUN)

**The Agentic Creator has generated stories.** Two complete five-beat drafts exist on dev, owned by
the system user, sitting at `awaiting_review`. Every claim below was measured, not argued.

| Proof | Result |
|---|---|
| Full pipeline, brief → 5 beats → draft | `awaiting_review` / `succeeded`, stories `6e627a39`, `be0080f7` |
| Canonical chain | beat 1 root; 2-4 linked by `parentId` + a real `selectedOptionId`; beat 5 ending with 0 options |
| Normal Kissago story | 5 normalized `beats` rows, 5 `story_map` nodes, root node present, provenance stamped |
| `agent_story_memory` before promotion | **0 rows** — the Test Lab safety property holds |
| Gallery | **0 storylines** — no autonomous publish |
| `image_generation_jobs` | **0** — `prompt_only` genuinely prevents image spend |
| `ai_cost_events` @ `activity_key='agentic_creator'` | 26+ real rows |
| System user beat balance | **5.00, unchanged** — the billing bypass works |
| Deferral/resume | 5 passes, `attempts 0/3` — every attempt returned, as designed |
| Novelty vs a real catalogue | story 2 flagged for reusing the character "Kabir" from story 1 |
| `e2e/agentic-admin.spec.ts` | **15 passed, 0 skipped** — all six agentic routes render for an admin |

**Running it immediately found three defects that review had not** (all fixed in `fe9406f`): the
headless session never set `currentBeat`, so no story could exceed one beat; the post-generation
novelty check ran *after* `recordStoryMemory`, comparing every story against itself and returning
`block` always; and deferral events were filed under the previous stage. A fourth was in the test
harness — `playwright.config.ts` never loaded `.env.local`, so the admin e2e spec had never run from
its own documented setup.

### Resolved 2026-09-08 — a `block` is decided once, by the tested layer (`32f2c65`)

The first live runs showed a `block` was neither stable nor auditable: it failed the stage, the
retry re-ran the whole check, and the adjudicator returned block, block, warn, block on identical
input -- so a block meant "blocked unless one of up to three coin flips disagrees". Worse, the
deterministic layer had never said block (2 reused names against `CHARACTER_REUSE_BLOCK_COUNT` 4);
the model alone escalated a warn into a terminal failure.

Both halves are fixed. `applyAdjudication` (pure, tested) lets the model soften a verdict but never
harden one, and an attempted escalation is still recorded in `reasons`. The verdict is cached under
its own checkpoint key -- **not** the `novelty_checked` stage key, which would make `isCheckpointed`
true and let advanceRun skip the stage entirely, sailing a blocked run straight past its block.

---

## Earlier in this session (code delivery)

**Phase 6 is code-complete, including the Test Lab (6c).** The pipeline is wired end to end:
a commissioned `agent_task` becomes an `agent_run`, `drainAgentRuns` advances it with the real
`storyAssemblyExecutor`, and `/admin/agents/test-lab` drives the whole thing on demand against a
persona of your choosing.

**It has now executed end to end** — see the proof table at the top. `agentic_creator_enabled` and
`agentic_billing_bypass_enabled` are **on** on dev as of this session.

### Commits this session (all on `feat/agentic-creator`, all reviewed by diff, not by report)

| SHA | What |
|---|---|
| `5e14249` | `storyAssemblyExecutor` is `drainAgentRuns`'s default, via a lazy dynamic import |
| `52b46e8` | Commissioned tasks become runs; task lifecycle follows; test runs excluded from the cron |
| `aa950db` | **Review fix** — the enqueue read must never latch migration 107 |
| `1b3f424` | **Review fix** — the Agents overview stopped listing shipped phases as missing |
| `9d96cd5` | Persona Test Lab server half, parked one stage before draft creation |
| `3455430` | **Review fix** — guarded the test lab's checkpoint write; netted `executeRunNow` |
| `f1ce8e9` | Persona Test Lab admin surface |

Gate at handoff, re-run independently rather than taken on report:
**93 files / 747 tests passing, `npx tsc --noEmit` exit 0, `npm run lint` clean,
`npm run build:verify` green (`/admin/agents/test-lab` present as a dynamic route), and
`npm run test:e2e` 14 passed / 1 skipped.** The skip is `e2e/agentic-admin.spec.ts` — see below.

### THE NEXT STEP — run it

Everything below is blocked on flags only. In order:

1. **Turn on `agentic_creator_enabled`** on dev, from `/admin/agents`.
2. **Turn on `agentic_billing_bypass_enabled` too — this is not optional in practice.**
   Every paid call in this pipeline costs **0.50 beats** (`preview_seed_plan`,
   `start_story_initial_beat_prompt_only`, `continue_story_new_beat_prompt_only` — verified
   against `pricing_action_costs` on dev). A run costs `1.5 + N` beats for an N-beat story;
   persona `beat_count_min` ranges 4-8, so **5.5 to 9.5 beats per run**. The system user has
   **one grant with 5.00 beats remaining**. Without the bypass (or a top-up to ~20 beats)
   every run dies on `insufficient_balance` near the end, after real Gemini spend on the calls
   that already succeeded. Recoverable — the completed beats are checkpointed, so a top-up and
   retry resumes rather than re-paying — but it presents as a pipeline bug and is not one.
3. **Run `/admin/agents/test-lab`** against a persona. Then verify against the database:

```sql
select id, stage, status, attempt_count, jsonb_object_keys(checkpoint) from public.agent_runs;
select stage, level, message, created_at from public.agent_run_events order by created_at;
select action_key, activity_key, phase from public.ai_cost_events where activity_key = 'agentic_creator';
select count(*) from public.agent_story_memory;   -- MUST still be 0 before promotion
select count(*) from public.image_generation_jobs where created_at > now() - interval '1 hour';  -- expect 0
```

4. **Then press "Create draft"** and re-check: `agent_story_memory` gains exactly one row,
   `agent_runs.story_id` is stamped, and the task moves to `awaiting_review`.

### Things that will bite you if you do not know them

- **An admin can read an agent draft but cannot edit or continue it.** `stories` RLS on dev:
  SELECT is permissive (`is_archived = false AND auth.uid() IS NOT NULL`), UPDATE is owner-only
  (`auth.uid() = user_id`). Agent drafts are owned by `AGENTIC_SYSTEM_USER_ID`, so `/story/[id]`
  renders for an admin and then refuses every write. **The plan's Phase 6 acceptance criterion —
  "it renders, is editable, continues normally" — is therefore only half reachable.**
  This lands squarely on **Phase 9**, which plans to "reuse the existing story editor at
  `/story/[id]`" for reviewers: reviewers will not own agent stories either, so Phase 9 needs a
  reviewer RLS policy or an admin-client server-action path. `persistence.ts`'s existing
  `serverAuth` escape hatch does **not** solve this — it is scoped to worker media-state patches.
- **The two schema-missing classifiers are code-identical.** `isMissingRunSchemaError` (107) and
  `isMissingTaskSchemaError` (106) both accept `42P01`, `42703`, `PGRST200`, `PGRST204`. They are
  told apart **only by which table the failing query touched** — never by the error itself.
  Classify by the query, not by trying both. `aa950db` fixed exactly this: an `agent_tasks`-only
  read was latching the 107 latch, which would have killed the whole run pipeline and blanked
  `/admin/agents/runs` behind a false "migration 107 is not applied" message.
- **The task-status writes are load-bearing, not bookkeeping.** `idx_agent_runs_active_task` only
  blocks a *second live* run per task. Leave a task `commissioned`/`assigned` after its run stops
  being live and the next drain commissions another one — forever, each pass a paid model call.
  Flipping the task to `running` the moment a run exists is what makes enqueue one-shot.
- **The double-charging guard is still load-bearing and fragile.** Unchanged from the last
  session: `story_generated` persists progress after every beat AND mutates `run.checkpoint` in
  place, because `advanceRun` reads that field after the executor returns. Hoisting that read
  above the executor call silently restores double-charging. See `lib/agentic/orchestrator.ts`.
  A new instance of the same hazard was found and fixed this session in `3455430`: the Test Lab's
  novelty-preview cache did a blind read-modify-write of the whole `checkpoint` object from a path
  that does not own the run's claim. It now re-reads immediately before merging and writes only
  under `.eq('status','pending').eq('stage','story_generated')`.
- **`saveStory` cannot be called headlessly** and `saveStoryForUser` must never be exported from a
  `'use server'` file. Unchanged; see `lib/story/save-story.ts`.
- **`AGENTIC_SYSTEM_USER_ID` is dev-only.** Verified this session: it resolves to a real
  `auth.users` row owning zero stories.

### Verified by query this session, so nobody re-derives it

- `idx_agent_runs_active_task` on dev is
  `UNIQUE (task_id) WHERE status = ANY (ARRAY['pending','processing'])` — unique *and* partial,
  so both halves of the no-double-run guarantee hold. **This closes the old open item asking for
  `docs/snippets/107-verify-run-dedup.sql` to be run by hand**; the index definition proves what
  that script would demonstrate. `idx_agent_tasks_queue` is `(status, created_at) WHERE
  is_test = false`, which is exactly the shape `enqueueCommissionedTasks` queries on.
- All five agentic `TaskKey`s have real `DEFAULT_MODELS` entries, so model resolution will not be
  the first thing to fail.
- `agent_personas.status` allows `draft/testing/active/paused/archived`. The Test Lab accepts
  everything but `archived` (so it is usable today, when all 15 seeds are `draft`); the cron
  enqueue requires `active`. A paused persona can be tested but never auto-scheduled — deliberate.
- Dev state at handoff: 15 personas (all `draft`), 0 tasks, 0 runs, 0 story-memory rows,
  0 novelty checks, all six agentic flags `false`.

### Known limits accepted this session, not defects

- **`e2e/agentic-admin.spec.ts` skips on this machine.** `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`
  are **not** in `.env.local`, so the admin-authenticated spec never runs — including the
  `/admin/agents/test-lab` route just added to it. The previous session's handoff reported this
  spec green; it must have supplied the credentials transiently. The spec is designed to skip
  rather than fail, so this is silent. **The Test Lab has never been opened in a browser.**
- The Test Lab's post-generation novelty check is a *preview*. Promotion runs the check again
  inside `draft_created`, so the economy-tier adjudicator can be paid for twice in the ambiguous
  band. Deliberate: cheap, and showing both verdicts before promotion is the point of the tool.
- Agent spend still reuses existing `PricingActionKey`s, so it is indistinguishable from human
  spend *by action key*; `activity_key = 'agentic_creator'` is what separates it. Revisit in
  Phase 12.
- Checkpoints store full `StoryBeat` objects. Safe while this stage emits only text prompts.
  **If a future phase moves portrait generation here, beats must be trimmed first.**
- `agent_schedules` (migration 107) is still unused. Enqueue ignores cadence entirely and simply
  drains whatever is commissioned. Wiring schedules to enqueue is unclaimed work.

### Still open, none blocking

- Run the memory backfill on staging (`runStoryMemoryBackfillBatch()`, needs
  `agentic_creator_enabled` on) so the first agent story is checked against a real catalogue
  rather than an empty table.
- Production: see the promotion checklist in `docs/agent-context/PROJECT_STATE.md`. It needs its
  **own** `AGENTIC_SYSTEM_USER_ID` (a different UUID from dev's). `CRON_SECRET` needs no action.

---

## Where we are

- **Phase:** Phases 1-6 shipped in full, and the pipeline has produced two real drafts.
  **Phase 7 is core-complete but unproven:** the pure evaluator (7a) and its server half wired into
  a no-failure `evaluated` stage (7b) are landed and gated; the Run monitor surface (7c) and the
  Test Lab deterministic preview (7d) are designed and agreed but not written. **The evaluator has
  never executed** — migration 108 is applied on dev now, but both existing `awaiting_review` runs
  already banked `evaluated` from the Phase 6 placeholder, so proving it needs a brand-new run.
- **Branch:** `feat/agentic-creator`, cut from `dev` at `1d93dea`
- **Plan of record:** `C:\Users\User\.claude\plans\kisago-agentic-creator-prompt-pack-imple-refactored-dragon.md`
- **Source pack:** `prompt-packs/Kisago_Agentic_Creator_Prompt_Pack/` (17 files, read in full during planning)

## What works right now

**Migrations 102-107 are all applied on the dev/staging database** (102-105 on 2026-09-06, 106-107 on
2026-09-07), re-verified against `schema_migration_ledger` on 2026-09-07. Verified by query, not assumed:

- Six `agentic_*` flags exist, **all still `false`**. `lib/agentic/flags.ts` is the single read path,
  always with `fallback = false`.
- **15 seed personas, and 15 `agent_persona_memory` rows** — the memory rows were created by the
  migration-103 AFTER INSERT trigger, so the pack's "every persona automatically receives memory"
  requirement is verified live rather than assumed.
- All 15 personas are image-off, narration-off, `status = 'draft'`, `schedule_eligible = false`, with
  `default_story_config.imageGenerationMode = 'prompt_only'`. Zero exceptions on any of those.
- `agent_story_memory` and `agent_novelty_checks` exist and are empty.
- `/admin/agents` renders an Overview page: an off-state explainer, the master kill switch, and five
  subordinate toggles disabled while the master switch is off.
- `/admin/agents/personas` renders a filterable catalogue with create, edit, clone and status actions.
- `lib/agentic/personas.shared.ts` turns a persona into a real `StoryConfig`, forcing
  `imageGenerationMode: 'prompt_only'` for any image-off persona as its last, unconditional step.
- `lib/agentic/memory.shared.ts` scores novelty deterministically; `lib/agentic/memory.ts` fetches
  priors, calls the economy-tier adjudicator only inside the ambiguous band, and records every verdict.
  `trigramSimilarity` is **verified exactly equal** to Postgres `pg_trgm.similarity()` on five pairs
  measured against staging, and those values are pinned as a test.
- `lib/agentic/supervisor.shared.ts` computes catalogue coverage and ranks gaps **deterministically**
  (stable ordering is a tested property — an unauditable supervisor is worse than none), and validates
  model-written commission proposals as hostile input. `supervisor.ts` skips the model call entirely when
  there are no gaps or no active personas.
- `/admin/agents/tasks` renders the coverage report, the task pool, and a two-step commissioning flow
  where proposals are shown for human sight-check before any row is written. Rejected proposals and their
  reasons are shown too, never hidden.
- **Nothing generates anything yet.** No jobs, no runs, no story writing. `runNoveltyCheck` has never
  executed end to end, `proposeCommissions` has never made a model call, and `commissionTasks` has never
  written a row. The pure halves are well covered; every server half is unproven at runtime.

**Today's real state is the one to design against:** all 15 personas are `status = 'draft'` (so zero are
commissionable) and migration 106 is unapplied (so every task query returns empty). Both are handled
explicitly rather than incidentally — that is why the three empty states are distinguished in the UI.

## Next step

**Start one fresh run to prove the evaluator, then build units 7c and 7d.** Migration 108 is
applied on dev as of 2026-09-08. The exact SQL to verify each claim, and the specs for both
remaining units, are in the session handoff at the top of this file. 7c and 7d need code; the
proof run does not.

### Superseded: Phase 5b (complete, landed at `78e8aaa`)

**Phase 5b — worker route, reconcile integration, runs admin page.** Migration 107 and its
schema, the pure state machine, routing, and the orchestrator itself are done (5a, below). Still
needed: a `CRON_SECRET`-guarded `app/api/agentic/run/route.ts` that calls `drainAgentRuns()`; an
`agentic_scheduler_enabled`-guarded call from the existing daily `/api/batch/reconcile` tick —
**wrapped so an agentic failure can never break the narration and image reconcile work that
already runs there**; and `/admin/agents/runs` (list + `agent_run_events` timeline, using
`app/actions/agentic-runs.ts`, already written). `kickAgenticWorker()` (the admin "Run now"
button's server action) belongs here too, once the worker route it calls exists.

### What Phase 6a shipped (commit `e89f9ef`)

Groundwork only, **zero behaviour change** — verified by re-running the gate independently
(tsc 0, lint 0, 91 files / 715 tests, exactly baseline) and by diffing the moved bodies line by line.

- `lib/ai/seed-authoring.ts` — `generateSeedPlanPreview` and `materializeSeededBeat` moved out of the
  `'use client'` `app/actions/story-runtime.ts` into a directive-free dual-context module, mirroring
  `lib/ai/beat-orchestration.ts`. `story-runtime.ts` re-exports them, so `story-store.ts`,
  `LandingScreen.tsx` and `ContinueAsEpisodeDialog.tsx` are untouched — confirmed by `git show --stat`.
- `lib/story/save-story.ts` (`server-only`) — `saveStoryForUser(supabase, userId, session, storyMap, options?)`.
  **`saveStory` could not be called headlessly**: it resolves the user from a cookie session and throws
  `'Not authenticated'`, which a cron worker always would. `saveStory` is now a thin cookie-bound wrapper
  over it. The move was larger than planned (656 lines) because the row-shaping helpers are shared with
  `saveBeat`/`loadStory` and a `'use server'` file can only export async functions; they moved too and are
  imported back. Verified no invented logic: every added line is an import, an `export` prefix, a
  `user.id` -> `userId` swap, or the two optional provenance keys.
  **`saveStoryForUser` must never be exported from a `'use server'` file** — it takes a caller-supplied
  `userId`, so as a server action it would let any browser save a story as another user.
- `lib/pricing/enforcement.ts` — an `agentic_system` bypass branch ahead of `admin_bypass`, requiring all
  three of `actorKind === 'agentic_system'`, the `agentic_billing_bypass_enabled` flag, and
  `userId === AGENTIC_SYSTEM_USER_ID`. `actorKind` is checked first so the human path does no extra I/O.
- `AGENTIC_SYSTEM_USER_ID` added to `.env.example` and `docs/onboarding-new-machine.md`. **Created on dev
  and set in `.env.local` on 2026-09-07.**

Corrections to the plan found while verifying 6a, for whoever picks up 6b:

- `CostActivityKey` (`lib/ai/cost-telemetry.shared.ts:10`) is a **closed union** with no `agentic_creator`
  member — the plan assumed the key just works. It must be added. There is **no CHECK constraint** on
  `ai_cost_events.activity_key` (verified against dev), so this is a TypeScript change with no migration.
- `app/admin/cost/page.tsx:59` holds a label map keyed by activity key; a new key needs a label there or
  the dashboard renders the raw string.

### What Phase 5a actually shipped

- `supabase/migrations/107_agent_runs.sql` + rollback — `agent_runs`, `agent_run_events`,
  `agent_schedules`. Written, **not applied anywhere yet**.
- `lib/agentic/orchestrator.shared.ts` (pure, tested): the stage machine (`STAGE_SEQUENCE`,
  `nextStage`), the checkpoint contract (`isCheckpointed`/`recordCheckpoint` — the idempotency
  guarantee that stops a retry from paying twice), retry/backoff, stale-run detection, and
  `classifyRunError`/`isMissingRunSchemaError` (its own dedicated latch classifier for 107).
- `lib/agentic/routing.shared.ts` (pure, tested): `AGENT_TASK_ROLES` and `resolveAgentModel()`,
  precedence persona override → model_config row → `DEFAULT_MODELS`.
- `lib/agentic/orchestrator.ts` (`server-only`): `reclaimStaleAgentRuns`, `createRunForTask`,
  `appendRunEvent`, `drainAgentRuns(budgetMs, executor?)`, plus `listRuns`/`getRun`/`cancelRun`/
  `retryRun` for the admin surface. Fails closed on migration 107 (its own latch, never reused)
  and on the master flag (`drainAgentRuns` returns 0 without touching `agent_runs` when
  `agentic_creator_enabled` is off).
- **Story generation does not exist yet — that's Phase 6, deliberately.** `drainAgentRuns` takes a
  `StageExecutor` and defaults to `defaultAgentRunExecutor`, which defers on the very first
  content-generation stage (records an `agent_run_events` entry, returns the run to `pending`
  without consuming an attempt) rather than inventing generation or failing the run. This is the
  one seam Phase 6 plugs a real executor into.
- `app/actions/agentic-runs.ts` (`'use server'`): `listRunsAction`, `getRunAction`,
  `cancelRunAction`, `retryRunAction`. No `kickAgenticWorker` — see Phase 5b above.
- Three new TaskKeys (`agent_story_brief`, `agent_seed_story_writing`, `agent_story_evaluation`) in
  `lib/ai/model-config.shared.ts`, all added to the `PromptTaskKey` exclusion list in
  `lib/ai/prompt-config.shared.ts` alongside the existing two agentic keys.
- Gate: `npx tsc --noEmit` clean, `npm run lint` warning-free, `npm test` 91 files / 714 tests
  passing (baseline 89/675 + 39 new), `npm run build:verify` green.

Still worth doing, neither blocking:

- **Run the memory backfill on staging.** `runStoryMemoryBackfillBatch()` seeds `agent_story_memory` from
  published storylines so the first agent story is checked against the real catalogue instead of an empty
  table. Requires `agentic_creator_enabled` on. Call repeatedly until `done`; resumable and idempotent.
- **Browser-verify the admin surfaces** — see Blockers.

## Blockers

None blocking work. Three open items:

- **Production has none of 102-108, and needs two more things besides the migrations.** See the
  "Promoting the agentic system to production" checklist in `docs/agent-context/PROJECT_STATE.md`:
  prod needs its own `AGENTIC_SYSTEM_USER_ID` auth user (a *different* UUID from dev's, set as a Vercel
  env var), while `CRON_SECRET` needs no action. Nothing on prod changes until then, by design.
- **`e2e/agentic-admin.spec.ts` currently skips**, because `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`
  are not set in `.env.local`. It is the vehicle for browser proof of every agentic admin surface,
  including the newly added `/admin/agents/test-lab`, so until those are set the Test Lab has never
  been opened in a browser. Setting them turns the proof back on with no code change.
- **The evaluator has never executed.** The pipeline itself has — two drafts exist on dev — but the
  `evaluated` stage was still a free advance when those ran, and both banked it in their checkpoint.
  A brand-new run is the only way to exercise Phase 7. See the handoff at the top.

## Active flags

All six exist in migration 102 and default to `false`. Read them **only** through
`lib/agentic/flags.ts` — never call `getFeatureFlag` with these keys directly, or the fail-closed
guarantee stops being a guarantee.

| Flag | Purpose |
|---|---|
| `agentic_creator_enabled` | Master kill switch — off means no route, no worker, no generation |
| `agentic_scheduler_enabled` | Lets the daily reconcile cron drain the agent queue |
| `agentic_supervisor_enabled` | Lets the Editorial Supervisor commission tasks |
| `agentic_reviewer_workflow_enabled` | Turns on `/admin/authors` and the review queue |
| `agentic_billing_bypass_enabled` | Lets the system user skip the coin reserve (telemetry still recorded) |
| `agentic_image_generation_enabled` | Global gate above each persona's own image permission |

## Migrations

| # | File | Phase | dev | prod |
|---|---|---|---|---|
| 102 | `102_agentic_creator_flags.sql` | 1 | **APPLIED** 2026-09-06 | not applied |
| 103 | `103_agent_personas.sql` | 2a | **APPLIED** 2026-09-06 | not applied |
| 104 | `104_seed_agent_personas.sql` | 2b | **APPLIED** 2026-09-06 — 15 personas, 15 memory rows | not applied |
| 105 | `105_agent_story_memory.sql` | 3 | **APPLIED** 2026-09-06 | not applied |
| 106 | `106_agent_tasks.sql` | 4 | **APPLIED** 2026-09-07 | not applied |
| 107 | `107_agent_runs.sql` | 5 | **APPLIED** 2026-09-07 | not applied |
| 108 | `108_agent_evaluations.sql` | 7 | **APPLIED** 2026-09-08 — schema verified, 0 rows | not applied |
| 109–110 | reviewers / labels | 9, 11 | not written | not written |

Migrations are applied **by hand by the owner** in the Supabase dashboard, per environment.
Never run the Supabase CLI. Verify with
`select * from public.schema_migration_ledger where migration_number between 102 and 110;`

## Files that matter most

| Path | Why |
|---|---|
| `lib/ai/seed-authoring.ts` | Phase 6 creates it by **moving** two functions out of `app/actions/story-runtime.ts` |
| `app/actions/story-runtime.ts` | `'use client'`; keeps re-exporting the moved functions so no consumer changes |
| `lib/ai/beat-orchestration.ts` | The precedent for a directive-free dual-context module — copy its header rationale |
| `lib/media/image-job-runner.ts` | The claim / reclaim / re-kick pattern `lib/agentic/orchestrator.ts` copies (re-kick itself is Phase 5b, in the worker route) |
| `lib/agentic/orchestrator.shared.ts` | The stage machine + checkpoint contract Phase 6 must respect: `isCheckpointed`/`recordCheckpoint` is what stops a retry from double-billing a model call |
| `lib/agentic/orchestrator.ts` | `drainAgentRuns`'s `StageExecutor` parameter is Phase 6's plug-in point — see `defaultAgentRunExecutor` |
| `lib/ai/character-novelty.shared.ts` | Existing similarity helpers the novelty check reuses instead of rewriting |
| `lib/ai/model-config.shared.ts` | Add agentic `TaskKey`s here and the admin model editor picks them up free |
| `lib/pricing/enforcement.ts` | `authorizeBillableAction` L212; the `admin_bypass` branch at L279 is the model for the agentic bypass |
| `lib/admin/nav.ts` | Single source of truth for admin navigation |

## Test state

See `agentic-creator-test-status.md`. Pre-existing failures recorded there are **the baseline** and
must never be attributed to this work.
