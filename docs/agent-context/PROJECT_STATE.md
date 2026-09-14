# Project State

The standing ledger of what is shipped, what is pending, and what is deliberately deferred. This is the
context that does not live in the code or in git history.

**Snapshot taken:** 2026-08-26, on `dev` at `4c34dbd`. The migration ledger and flag states below were
**verified directly against the development database** on that date, not carried over from notes.

**Partially re-verified 2026-09-06** against both dev and prod via the read-only MCP connections, while
planning the Agentic Creator System. Three corrections landed: migration 101 is applied on both (the row said
"not yet applied anywhere"); Runware rows exist on prod and are disabled rather than absent; and the agentic
migrations 102–108 are recorded, with 102–108 applied on dev and none on prod. Everything not named here still carries its
2026-08-26 verification date.

Keep this file current. When you finish a pack, move it out of "pending"; when you defer something, add it to
"deferred".

---

## Environments

| | Supabase project | Notes |
|---|---|---|
| Development | `dxbwzcpbfacrwrauhdbk` | Named **kissagoStage**, ap-southeast-1. Where migrations get applied first. |
| Production | `pddjsopcemsfiwyvhlkr` | Named **kissago**, ap-northeast-1. `www.kissago.cc` / `kissago.cc` |

An agent working here has **read-only** database visibility on both, via two separately named Supabase MCP
servers: `supabase` (dev) and `supabase-prod`. The names are distinct so touching production is always a
deliberate choice. Read-only is not a courtesy — it is what enforces the rule below that migrations are
applied by hand. An agent cannot apply one even if asked; it can only produce the file and verify the result
afterwards. Config is machine-local (`~/.claude.json`, `local` scope), so a new machine sets this up itself.
Prod holds real user data: query it for schema, migration state and config, not to browse user content.

Migrations are applied **by hand, per environment, in the Supabase dashboard** — never by CLI. Drift between
the two is normal and expected; code must fail closed when a column or table is missing. This has already
caused one production incident (batch narration 500ing because `069_narration_accent.sql` was never applied
to prod).

Media: Cloudflare R2, staging bucket `kissago-media-staging` behind `media-stage.kissago.cc`, with Supabase
Storage as fallback. Deployment: Vercel (Hobby — which is why the reconcile cron can only run daily).

---

## Migration ledger

101 numbered migrations exist, each with a `_rollback.sql` twin. Everything up to 068 is long-applied. Below is
the last known status of everything after that — **verify against the live database before relying on it**.

**As of migration 101, there is a real per-environment source of truth for this**: `public.schema_migration_ledger`.
Every migration from 102 onward inserts its own row as its last statement; 001–100 were backfilled after being
verified applied on both dev and prod on 2026-08-29. Query it directly instead of inferring from column/table
existence or trusting this table:

```sql
select exists (select 1 from public.schema_migration_ledger where migration_number = 99) as applied;
```

| # | File | Introduces | Status on **dev** (verified 2026-08-26) |
|---|---|---|---|
| 069 | `narration_accent` | `narration_batch_jobs.accent` | **Applied.** Prod was missed once and fixed by hand 2026-07-13 after a live 500. |
| 074 | `beat_control_pack1` | tables `timeline_rewrite_events`, `beat_revisions` | **Applied.** |
| 075 | `character_universe_pack2` | tables `character_masters`, `episode_branches`, `story_bibles` | **Applied.** |
| 076 | `video_export_engine_presets` | flag `video_export_presets_json` | **Applied** — the flag is enabled and carries real preset JSON. |
| 077 | `beat_bundle_flag` | flag `beat_bundle_enabled` | **Applied**, and the flag is **on**. |
| 078 | `reference_personalization` | tables `reference_sources`, `reference_adoptions` | **Applied**, and in real use (9 reference sources, 2 adoptions). |
| 079 | `reference_direct_input` | `reference_sources.description`, mode flag, cost row | **Applied.** |
| 080 | `beats_realtime` | `REPLICA IDENTITY FULL` + `beats` in `supabase_realtime` | **Applied** — `beats` is in the publication, so Realtime is live and the client is not polling. |
| 081 | `image_prompt_compiler` | compiler mode flag + Gemini capability | **Applied.** Mode is `new`, not `shadow` — see below. |
| 088 | `storyline_discovery_metadata` | `storylines.discovery_intro`, `discovery_intro_status` | **Applied.** |
| 089 | `storyline_audience_genre` | `storylines.age_group`, `genre` | **Applied.** |
| 090 | `storyline_progress` | table `storyline_progress` | **Applied** (4 rows). |
| 091 | `viewer_profiles` | table `viewer_profiles` | **Applied** (0 rows). |
| 092 | `backfill_beat_is_storyboard` | backfill audit table | **Applied.** |
| 093 | `storyline_series` | `storylines.series_id`, `episode_number`, `series_title` | **Applied.** |
| 094 | `storyline_search_trgm` | `pg_trgm` + partial GIN indexes | **Applied** — the extension is installed, so search is index-backed. |
| 095 | `runware_image_provider` | Runware rows in `image_model_registry` | **Applied.** ⚠ The seeded AIR ids and prices are still **unverified guesses** — check each model in Runware's own Playground before enabling any row. |
| 096 | `user_entitlement_tier_overrides` | table `user_entitlement_overrides` | **Applied** (0 rows — nobody promoted yet). |
| 097 | `enable_rls_admin_config_tables` | RLS on six admin config tables | **Applied on both** 2026-08-26. |
| 098 | `harden_function_privileges` | `search_path` pinned; EXECUTE revoked from PUBLIC/anon/authenticated on 17 functions | **Applied on both** 2026-08-26. |
| 099 | `managed_page_versioning` | `managed_pages` versioning columns, table `managed_page_versions`, flag `legal_consent_gate_enabled` | **Applied on both** 2026-08-29, verified by query. |
| 100 | `legal_acceptances` | table `legal_acceptances` | **Applied on both** 2026-08-29, verified by query. |
| 101 | `schema_migration_ledger` | table `schema_migration_ledger`, self-recorded by every migration from here on | **Applied on both**, verified by querying the ledger 2026-09-06. (This row previously said "not yet applied anywhere", contradicting the paragraph below it — the ledger is the authority and it says applied.) |

Everything up to 068 is long-applied.

### Agentic Creator System (merged into `dev` 2026-09-14, `--no-ff`; **not** on `main`)

**102-108 and 110-118 are all applied to dev; production still has none of them.** 102-107
verified against `schema_migration_ledger` on 2026-09-07; **108 applied 2026-09-08** and verified against
the schema itself rather than only its ledger row — 12 columns, RLS on, `anon`/`authenticated` denied
SELECT, 0 rows, and `idx_agent_evaluations_pipeline_run` confirmed UNIQUE *and* partial. **111 and 112
applied 2026-09-09**, **113 applied 2026-09-10**, and **114 applied 2026-09-10** (this file previously said
114 was "written and committed but deliberately unapplied" here, contradicting its own row in the table
below, which has carried the correct applied timestamp since 2026-09-11 — the table was right, this
paragraph was stale; see that row for the verification detail). **115 (`115_beats_owner_only_writes.sql`,
D23 — narrows `beats` INSERT/UPDATE RLS to also require the story owner) is written and committed but
deliberately unapplied** — per WORKING_AGREEMENTS, the agent producing it never applies a migration; the
owner runs it by hand, dev first, and only once the Phase 10 Round 1 application-level gates it backstops
are confirmed live (see the migration table row and "Shared branching" below). **Production has none of
them** — the prod ledger returns zero rows for `migration_number >= 103`, so the entire agentic schema is
dev-only and prod will need 103-onward applied in order whenever it is promoted.

**There is no migration 109, and there will not be one.** Phase 8 planned an
`agentic_narration_enabled` flag to sit above each persona's `allow_narration`, mirroring
`agentic_image_generation_enabled`. It was dropped when narration became a reviewer action rather
than a pipeline stage (D10): with a human pressing the button, the human is the kill switch. The gap
in the numbering is deliberate — do not go looking for the file, and do not treat 110 as blocked on
it. Numeric order is convention here anyway; `schema_migration_ledger` is the only source of truth
for what has actually run.

| # | File | Introduces | dev | production |
|---|---|---|---|---|
| 102 | `agentic_creator_flags` | six `agentic_*` rows in `feature_flags`, all `false` | **Applied.** All six present. **`agentic_creator_enabled` and `agentic_billing_bypass_enabled` are ON** (both since 2026-09-07, to run the pipeline); the other four remain off | Not applied |
| 103 | `agent_personas` | tables `agent_personas`, `agent_persona_memory` + AFTER INSERT trigger; `stories.agent_persona_id` | **Applied.** | Not applied |
| 104 | `seed_agent_personas` | the 15 seed creator personas | **Applied.** 15 personas, and 15 `agent_persona_memory` rows created by 103's trigger | Not applied |
| 105 | `agent_story_memory` | tables `agent_story_memory`, `agent_novelty_checks` + `pg_trgm` GIN indexes | **Applied**, both tables empty | Not applied |
| 106 | `agent_tasks` | table `agent_tasks`; `stories.agent_task_id` | **Applied** 2026-09-07, 0 rows | Not applied |
| 107 | `agent_runs` | tables `agent_runs`, `agent_run_events`, `agent_schedules` + the partial unique dedup index | **Applied** 2026-09-07, all three empty | Not applied |
| 108 | `agent_evaluations` | table `agent_evaluations` + a PARTIAL unique index on `(run_id) WHERE trigger_source = 'pipeline'` | **Applied** 2026-09-08. Schema verified directly, not just the ledger row: 12 columns, RLS on, `anon`/`authenticated` denied SELECT, 0 rows, and the index confirmed UNIQUE *and* partial | Not applied |
| 110 | `riya_sen_narration_voice` | data-only: moves `riya-sen`'s `preferred_voice` from `Leda` to `Callirrhoe`, resolving the one same-language voice collision among the seeds (both it and `madhurima-bose` are Bangla) | **Applied** 2026-09-08. Verified against the data, not only the ledger: `riya-sen` now holds `Callirrhoe`, and a group-by over `(preferred_voice, language)` returns **zero** personas sharing a voice within a language, with all 15 voices inside the exposed 12 | Not applied (depends on 103 + 104, not on a contiguous run below it) |
| 111 | `agent_reviewers` | table `agent_reviewers` — Phase 9's reviewer authorization, read only through `requireReviewer()` (D6, D14) | **Applied** 2026-09-09 16:20:41+00. **0 rows**, and that matters: with the table empty, the only account that passes `requireReviewer()` is `ADMIN_USER_ID`, through the implicit short-circuit that never touches the table. Insert a row to exercise reviewer capability at all. **Superseded in part by 113**, which dropped `can_publish` / `can_trigger_media` in favour of a single `role` column | Not applied |
| 112 | `agent_review_decisions` | table `agent_review_decisions` — Phase 9's append-only reviewer decision trail (Unit 9e) | **Applied** 2026-09-09 17:53:20+00. Schema verified directly, not just the ledger row: 9 columns, the `decision` CHECK carrying all four values (`approved`/`rejected`/`rewrite_requested`/`published`), 4 FKs (`run_id` CASCADE; `story_id`, `reviewer_id`, `storyline_id` SET NULL), RLS on with **0 policies**, 2 indexes. `reviewer_id` is nullable by design, with `reviewer_label` snapshotting the name at decision time so the trail survives an account deletion | Not applied |
| 113 | `agent_reviewer_roles` | `agent_reviewers` gains `role` (`reviewer`\|`editor`, CHECK-constrained), the `age_groups`/`languages`/`genres` coverage arrays, and `updated_by`; **drops `can_publish` and `can_trigger_media`** — Phase 9b's D17, capability derived from role by pure functions rather than stored twice | **Applied** 2026-09-10 03:07:27+00. Schema verified directly, not just the ledger row: 12 columns, `role` NOT NULL DEFAULT `'reviewer'` with CHECK `('reviewer','editor')`, the three arrays NOT NULL DEFAULT `'{}'`, `updated_by` FK SET NULL, both booleans confirmed **gone**, **0 rows**. Dropping the booleans was only safe because the table was empty and prod has no agentic schema at all | Not applied |
| 114 | `agent_review_assignments` | table `agent_review_assignments` — Phase 9b's D18, TASK-level manual reviewer assignment (Unit 9i). `source` (`manual`\|`auto`) and `status` (`active`\|`released`\|`superseded`) CHECK-constrained, a partial UNIQUE index enforcing at most one `active` row per task, `reviewer_id`/`assigned_by` both `ON DELETE SET NULL` | **Applied** 2026-09-10 08:07:22+00 (this row said "Not applied" until 2026-09-11 — the ledger and the live schema both disagreed with it). Verified directly, not just the ledger row: `agent_review_assignments_one_active_idx` is UNIQUE and partial (`WHERE status = 'active'`), which is the load-bearing part — it is what makes Unit 9J's auto-assignment idempotent | Not applied |
| 115 | `beats_owner_only_writes` | narrows `beats` INSERT/UPDATE RLS from `003_normalize_beats.sql` by ANDing `s.user_id = auth.uid()` onto both policies — the database half of D23, shared branching going dormant. Must be applied only *after* the Phase 10 Round 1 application-level gates (doorway removed, `/story/[id]` + `/explore/[id]` layouts, pre-authorize refusal — plan section 3.2) are confirmed live, never before: applying it first alone would let a non-owner's continuation be charged and generated before the write is refused at the database — the charge-and-write-nothing defect class this phase keeps finding. Until applied, the original 003 policies still govern, and the four application-level layers (see "Shared branching" below) are what actually stop an explorer's write. Reviewer writes are unaffected either way — they run on the admin client and bypass RLS entirely | **Applied** 2026-09-12 16:59:55+00, after the Round 1 application-level gates were confirmed live. | **Not applied.** |
| 116 | `narrow_anonymous_stories_read` | narrows 003's anon `stories` SELECT policy — which had no auth predicate and no `TO` clause — to rows backing a **public** storyline, scoped `TO anon` so the separate authenticated policy is untouched | **Applied** 2026-09-13 18:23:20+00. The check that matters is loading `/` **signed out** and confirming the gallery rails populate: `gallery.ts` joins `stories!inner(...)` on the anon client, so over-narrowing renders an empty gallery rather than erroring | Not applied |
| 117 | `agent_review_decisions_reviewer_index` | additive index `idx_agent_review_decisions_reviewer` on `(reviewer_id, created_at DESC)` — 112 indexed only `run_id`, so "this reviewer's own history" full-scanned | **Applied** 2026-09-14 03:13:50+00 | Not applied |
| 118 | `rename_agentic_pipeline_image_flag` | renames flag `agentic_image_generation_enabled` → `agentic_pipeline_image_generation_enabled`, so the name says what it gates (the autonomous pipeline only, never a reviewer's interactive regenerate) | **Applied** 2026-09-14 03:14:10+00. **Order-independent** — it UPDATEs the row if 102 already ran, or INSERTs it off if it lands first. ⚠ The flag is enforced **nowhere in code**; see "Deferred" | Not applied |

### Text Model Gateway (branch `feature/text-model-gateway`; not yet merged into `dev`)

| # | File | Introduces | dev | production |
|---|---|---|---|---|
| 119 | `text_model_registry` | table `text_model_registry`, one row per text model. `model_config.model_id` and persona `model_overrides[*].modelId` now name a `model_key` here. Touch trigger, RLS with no policies, 12 seed rows: 8 Gemini enabled, 4 OpenAI/OpenRouter disabled | **Applied** 2026-09-14 05:27:43+00. Verified against the schema, not only the ledger: 18 columns, every CHECK, the trigger, RLS with 0 policies, 12 seed rows with the right enabled flags. **Frozen** — changes ship as 120 | **Not applied.** First run `select task_key, model_id from public.model_config order by task_key;` — a text `model_id` with no seeded row runs on its task default once 119 lands. A server that is already running needs a redeploy afterwards (see GOTCHAS "Text models") |
| 120 | `text_model_thinking` | column `model_config.reasoning_level` (CHECK on the level vocabulary); `capabilities.reasoningLevels` on every remaining registry row; Gemini rows stop accepting a task temperature; row `gemini-3.8-flash`. Moves text tasks and persona overrides off seven removed Gemini text models (the three economy tasks at Low thinking), records the move in `model_config_history`, then deletes those rows | **Applied** 2026-09-14 17:45:48+00. Verified against the schema: column and CHECK, 6 registry rows with levels, `graphic_style_extraction` and `voice_selection` moved to 3.8 Flash at Low with history rows, `agent_novelty_assessment` row inserted at Low, image and TTS rows untouched. **Frozen** — changes ship as 121 | **Not applied.** Needs 119 first. Run the read-only pre-apply check in `docs/text-model-thinking-plan.md` section 3 to see which tasks will move. Redeploy afterwards |

#### Promoting the agentic system to production — checklist

**The executable version of this is [../production-promotion-runbook.md](../production-promotion-runbook.md)** —
step-by-step, with all 16 migrations in order, the two that must not be applied early, and the
post-deploy checks. The summary below is kept for context; the runbook is what to work through.

Migrations are only one of three things prod needs. All three, in this order:

1. **Apply migrations 102-118 by hand, in numeric order** (there is no 109 — see above). 103 must precede 104, 105 and 106.
2. **Create a separate `AGENTIC_SYSTEM_USER_ID` auth user in the production Supabase project**, and set
   its UUID as a Vercel environment variable. It is a *different* UUID from dev's — copying dev's value
   across is wrong. This user owns every agent-generated story.
   *Failure mode if this is missed or stale:* the billing bypass in `lib/pricing/enforcement.ts` compares
   `input.userId === process.env.AGENTIC_SYSTEM_USER_ID`. A mismatch means the bypass silently stops
   matching and agent runs are **denied** rather than billed. That fails closed, which is the safe
   direction, but it presents as "agent runs mysteriously fail", not as a configuration error.
3. **`CRON_SECRET` needs no action** — it is already set on Vercel and has been since the narration and
   image workers shipped. The agentic worker route reuses it rather than minting a second secret, and
   piggybacks the existing daily `/api/batch/reconcile` cron rather than adding a `vercel.json` entry
   (the Hobby plan allows only one).

Flags stay `false` after promotion. Turning the system on is a deliberate, separate act.

**Apply in numeric order.** 103 must precede 104 (which inserts into its table), 105 and 106 (whose
`persona_id` foreign keys point at `agent_personas`). Applying 102 and 103 changes nothing observable: every flag is
`false` and the persona table lands empty.

Post-apply verification on dev, all passing: 15 personas / 15 memory rows; 0 with
`allow_image_generation`; 0 with `allow_narration`; 0 with `status <> 'draft'`; 0 whose
`default_story_config.imageGenerationMode` is anything but `prompt_only`; 6 agentic flags, 0 enabled.

All application code fails closed while these are unapplied — `lib/agentic/flags.ts` reads every flag with
`fallback = false`, and the persona actions catch the missing-relation error and return an empty list rather
than throwing. An un-migrated database therefore behaves exactly as it does today, which is the whole design.

A caveat on the older rows worth knowing: ledger entries 001–101 all carry an identical `applied_at` per
environment, because they were backfilled in one statement when 101 landed rather than recorded as each
migration ran. For that historical range the ledger reflects what was *declared* applied, not independently
observed. From 102 onward each migration records itself at execution time, so those rows are real evidence.

**The legal/auth UX pack (Phases 0-7) merged into `dev` 2026-08-29** (`--no-ff`, commit `b2092ea`). On dev: the
four legal documents (`terms`, `privacy_policy`, `ai_disclosure`, `content_usage_policy`) are published at
`doc_version 1.0.0`, and **`legal_consent_gate_enabled` is ON** — signed-in sessions without a current
acceptance are redirected to `/auth/accept-terms`. See `docs/legal-consent-model.md` for the schema and gate
logic, and `lib/legal/business-config.ts` for the entity/address/contact facts the documents are built from.

Migrations 099, 100 and 101 are now applied on both dev and production. **Before promoting to production:**
prod's `managed_pages` rows still need the same publish steps run against them as were run on dev, before
enabling `legal_consent_gate_enabled` there — do not assume enabling the flag on prod can happen in the same
step as the code promotion; verify prod's documents are actually published first, exactly as was done on dev.

**Phase 8 landed 2026-08-29**: `docs/legal-content-architecture.md` and `docs/auth-legal-release-checklist.md`
were written, the two remaining unit-test gaps (acceptance-state classification, missing-schema error
classifier — both required extracting a pure `lib/legal/consent.shared.ts` since `consent.ts` starts with
`import 'server-only'` and can't be imported into a vitest test) were closed, and two new e2e specs
(`e2e/legal-pages.spec.ts`, `e2e/navigation-progress.spec.ts`) were added. **A full WCAG 2.2 AA audit was
deliberately skipped — the owner reviewed the interface directly and made the call that it's acceptable
as-is**; see the release checklist for exactly what accessibility work *is* and isn't covered. Owner-run
manual QA (Google OAuth first-time gate, re-consent flow, suspended-account access) is still outstanding —
see the checklist's manual QA section.

**How the four documents were published on dev**, for reference if this needs repeating on prod:
1. In `/admin/settings/pages`, open each of the four pages and use **Reset to seed** to pull in the current
   text from `lib/managed-pages/registry.ts`.
2. Set `Document version` = `1.0.0` and `Effective date` = `2026-08-29` on all four.
3. Set `Acceptance kind` = `accepted` on `terms`, `acknowledged` on the other three; `Requires acceptance` = on
   for `terms` and `privacy_policy` only — `ai_disclosure` and `content_usage_policy` stay notices, matching
   what `AcceptTermsGate` actually gates on.
4. **Publish (material)** on each of the four (first real content, following every starter draft).
5. Only then flip `legal_consent_gate_enabled`.

**Deliberately not built in this change:** the pack's "Future Viewer Subscription" section asks for
entitlement architecture flexible enough to add paid viewer plans later without a rewrite. Kissago already has
exactly that separation on the *creator* side (`lib/pricing/entitlement-tier.shared.ts`'s `PlanKey` /
`resolveEffectiveEntitlementTier`, decoupled from billing truth in `snapshot.planKey`). A viewer-subscription
dimension is a genuinely new product feature, not a documentation gap, and was not built speculatively here —
the Terms (`terms`, §7) already use non-hardcoded language ("usage limits communicated within the Service")
precisely so that feature can land later without a Terms rewrite. Design the viewer entitlement as a parallel
dimension to `PlanKey` (not a repurposing of it) when that feature is actually scoped.

### Production (`pddjsopcemsfiwyvhlkr`)

**At parity with dev as of 2026-08-26**, verified directly: every migration in the table above is applied on
both environments, including 095 (9 Runware rows, all disabled), 096, 097 and 098.

Getting there closed a real gap. Prod had been missing 095 and 096 — harmless while that code sat unmerged on
`dev`, and an outage the moment it promoted, since the entitlement resolver would have deployed against a
database with no `user_entitlement_overrides` table. That is the same shape as the incident on record (batch
narration 500ing because 069 never reached prod).

**The rule this establishes: migrations go to production *before* the code that needs them, not with it.**
Schema parity is a precondition of promotion, not a step inside it.

095 was applied twice by accident with no consequence — it ends `ON CONFLICT (task_key, model_key) DO UPDATE`,
so the second run rewrote the same nine rows with the same values. Worth knowing that seed migrations here are
upserts, but worth checking rather than assuming for any given migration.

### Verifying what is actually applied

Paste this into the Supabase SQL editor for either project:

```sql
select
  to_regclass('public.timeline_rewrite_events')  is not null as m074_beat_control,
  to_regclass('public.character_masters')        is not null as m075_character_universe,
  to_regclass('public.reference_sources')        is not null as m078_references,
  to_regclass('public.storyline_progress')       is not null as m090_progress,
  to_regclass('public.viewer_profiles')          is not null as m091_viewer_profiles,
  to_regclass('public.user_entitlement_overrides') is not null as m096_entitlement_overrides,
  exists (select 1 from information_schema.columns
          where table_name='reference_sources' and column_name='description')      as m079_ref_description,
  exists (select 1 from information_schema.columns
          where table_name='storylines' and column_name='discovery_intro')         as m088_discovery,
  exists (select 1 from information_schema.columns
          where table_name='storylines' and column_name='age_group')               as m089_audience,
  exists (select 1 from information_schema.columns
          where table_name='storylines' and column_name='series_id')               as m093_series,
  exists (select 1 from information_schema.columns
          where table_name='narration_batch_jobs' and column_name='accent')        as m069_accent,
  exists (select 1 from pg_extension where extname='pg_trgm')                      as m094_trgm,
  exists (select 1 from pg_publication_tables
          where pubname='supabase_realtime' and tablename='beats')                 as m080_realtime;
```

Flag-only migrations (076, 077, 081, 095) are not covered above — check them with
`select key, value from public.feature_flags order by key;`.

---

## Security

**Both environments are clean as of 2026-08-26**, verified by query after migrations 097 and 098 were applied
to each:

| check | dev | prod |
|---|---|---|
| Tables without RLS | 0 | 0 |
| `SECURITY DEFINER` functions callable by `anon` | 0 | 0 |
| Our functions with mutable `search_path` | 0 | 0 |

What 097 and 098 closed, and why each was real rather than lint noise:

- **097** — six admin config tables ran without RLS on dev (five of the six were already protected on prod).
  The anon key ships in the browser bundle, so `model_config` (which picks the model and cost for every task)
  and `prompt_configs` (the published generation prompts) were rewritable by anyone with devtools open.
- **098** — `prune_orphaned_beat_images` and `prune_orphaned_character_sheets` delete media, are driven by
  pg_cron with no application callers, and were invocable over `/rest/v1/rpc/` by any signed-out visitor. A
  feature flag was the only thing in the way. Also pinned `search_path` on 15 functions, three of them
  `SECURITY DEFINER`, where a mutable path is a privilege-escalation vector.

Two things learned doing it, both worth not rediscovering:

1. **A revoke must name `PUBLIC`.** Supabase grants EXECUTE to PUBLIC *and* explicitly to anon/authenticated
   (`=X/postgres` is the PUBLIC grant). Revoking from anon and authenticated alone changes nothing.
2. **Revoking EXECUTE does not stop a trigger firing.** Trigger execution does not check the invoking user's
   EXECUTE privilege — confirmed empirically after 098: stored `like_count` / `view_count` still match actual
   row counts.

The pattern for admin-only tables is **RLS enabled with no policies** — anon and authenticated match nothing,
service role bypasses RLS. Around 40 tables do this. Supabase's linter reports each as `rls_enabled_no_policy`
at INFO; that is the intended end state, not a defect.

**Do not enable RLS on a table without checking its call sites first.** With no policies it denies everyone but
the service role, and a surface reading through the anon or user-session client then gets **zero rows instead
of an error** — silent, and invisible to tests.

Deliberately left alone: pg_trgm's 31 extension-owned functions (altering them can be undone by an extension
upgrade, and revoking EXECUTE would break trigram search — Supabase's own advisor excludes them), and moving
pg_trgm out of the `public` schema, which would invalidate 094's GIN indexes and needs its own migration.

Still open: **leaked-password protection is disabled** in Supabase Auth on both environments. It is a dashboard
toggle, not SQL — Authentication -> Policies.

Audit either environment with:

```sql
select c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
order by c.relname;
```

---

## Dormant / gated features

Not live for users. Most rows are built and merged, gated behind a flag that defaults to off or to a no-op
mode; the "Shared branching" row is the deliberate exception — no flag (D23), and its code sits on the
unmerged `feat/agentic-creator` branch rather than on `dev`.

Flag state **differs between environments**, and that difference is the point — dev runs ahead. Most rows
below were verified 2026-08-26; the Runware and Agentic rows were re-verified against both live databases on
2026-09-06.

| Feature | Flag | dev | production |
|---|---|---|---|
| Reference Personalization | `reference_personalization_enabled` | **on** (9 reference sources in use) | **off** — dormant, as designed |
| Reference input mode | `reference_input_mode` | `direct` | `direct` |
| Reference attachment on custom options | `reference_custom_option_attachment_enabled` | off | off |
| Image prompt compiler | `image_prompt_compiler_mode` | **`new`** — compiled prompts are sent | **`shadow`** — legacy prompt still sent |
| Server-side beat bundle | `beat_bundle_enabled` | on | on |
| Video export presets | `video_export_presets_json` | on, real preset JSON | on, real preset JSON |
| Runware image models | rows in `image_model_registry` | seeded, **all 9 disabled** (unverified prices) | seeded, **all 9 disabled** (unverified prices) |
| Legal consent gate | `legal_consent_gate_enabled` | **on** — migrations 099/100 applied, four documents published 2026-08-29 | **off** — migration 099 applied 2026-08-29 (seeds the flag `false`); documents not yet published on prod, do not enable until they are |
| Agentic Creator System | six `agentic_*` flags | present; **`agentic_creator_enabled` + `agentic_billing_bypass_enabled` ON** since 2026-09-07, other four off. 102–108 all applied (105 on 2026-09-06, 106/107 on 2026-09-07, 108 on 2026-09-08), 15 personas seeded (all `draft`), **two real drafts generated** and sitting at `awaiting_review` | **absent** — 102–108 not applied |
| Shared branching (continuing / forking someone else's story) | **none, deliberately (D23)** — the enforcement point is `beats` RLS, and a Postgres policy can't cheaply read `feature_flags`, so a flag here would gate the button while the database kept accepting the write | **dormant, application-level only** — Phase 10 Round 1's gates are code-complete on `feat/agentic-creator` (doorway removed, `/story/[id]` + `/explore/[id]` gated owner-or-reviewer, `continueStory` refuses a non-owner/non-reviewer before `authorize`); the database backstop, **migration 115, is written but not applied** | **still fully live** — none of Round 1 has reached production; the "Explore full story tree" doorway and the original, broader migration-003 `beats` RLS both still work there today |

**Reversing D23 — what re-enabling shared branching needs**, so this is one lookup rather than an
excavation: `115_beats_owner_only_writes_rollback.sql` applied (restores the two original
`003_normalize_beats.sql` policies byte-for-byte); the "Explore full story tree" link restored in
`components/story/StorylinePlayer.tsx`; and the owner-or-reviewer gate removed or relaxed in
`app/story/[id]/layout.tsx` and `app/explore/[id]/layout.tsx` — plus reverting the pre-authorize checks in
`lib/store/story-store.ts`, `app/actions/pricing-enforcement.ts`'s `authorizeCurrentUserStoryContinuation`,
and `app/actions/beat-bundle.ts`'s `generateBeatCore`. Nothing here is scheduled; it is recorded because D23
asked for it to be.

The Runware row previously read "**absent** — 095 not applied" for production. That was wrong on both counts:
the ledger records 095 applied on prod, and prod holds all 9 Runware rows. They are `is_enabled = false` on
both environments, which is why nothing surfaced — dormant by row state, not by absence. The prices are still
the unverified guesses noted against migration 095; check each model in Runware's Playground before enabling
any row on either environment.

Earlier revisions of this file described the reference feature and the compiler as dormant. That was an
accurate description of **production** filed under a heading that read as though it covered dev. When
recording a flag here, say which environment it refers to.

Note on the prompt compiler: it is in **`new`** mode, so both prompt-only and with-image stories send the
compiled prompt. The earlier `shadow` behaviour — compile, record a comparison, but still send the legacy
prompt — is no longer what is running, so any difference in image quality or adherence is live behaviour and
not a dormant experiment. `npm run compare:image-prompts` still reports the fixture-level size delta
(~48–67% reduction). It is a global setting, not per-story.

---

## Framework

**Next 16.3.3 since 2026-08-25** (from 15.5.24), React 19.2.8. Turbopack is the default bundler for both dev
and build. What the upgrade touched, and what it did not:

- `middleware.ts` is now `proxy.ts` with the export renamed to `proxy`. The runtime is nodejs and is not
  configurable — `edge` is only available under the old `middleware` name. The Supabase session refresh and the
  moderation gate ride on this file, and the e2e suite covers it (a signed-out visitor is still redirected away
  from `/admin`).
- `experimental.middlewareClientMaxBodySize` is now `experimental.proxyClientMaxBodySize` (20mb, for uploads).
- The `eslint` config option was **removed** from Next; `next build` no longer lints. `npm run lint` is the
  only linting path, and it is unchanged.
- The custom `webpack` function was deleted. It existed only for `DISABLE_HMR`, an AI Studio env var referenced
  nowhere else in the repo, and a custom webpack config makes a Turbopack build **fail outright**.
- Not affected, though the upgrade notes flag them: no `revalidateTag` calls (the new second argument is
  mandatory), no parallel routes (each slot would now need `default.js`), no `serverRuntimeConfig` /
  `publicRuntimeConfig`, no AMP, no `next/legacy/image`, no `unstable_` cache APIs, no sync `params` access,
  and `scroll-behavior: smooth` is scoped to `.custom-scrollbar` rather than `html`.
- `images.qualities` now defaults to `[75]` only. Nothing in the app passes a `quality` prop, so nothing is
  coerced — but adding one now needs the value allowlisted in `next.config.ts`.
- `images.minimumCacheTTL` defaults to 4h in Next 16; this project overrides it to 30 days regardless.

**Deployment shape changed with the upgrade:** `output` is now
`process.env.VERCEL ? undefined : 'standalone'`. On Next 16.3.x, standalone breaks Vercel's post-build
packaging (`ENOENT ... next-server.js.nft.json`) even though the build succeeds — see
[GOTCHAS.md](GOTCHAS.md). Because `VERCEL` is set on preview **and** production, the same behaviour carries
to production automatically when `dev` is promoted; there is no separate production step to remember. If the
upstream bug is fixed later, this can go back to an unconditional `'standalone'` — verify a Vercel deploy
before doing so.

**Still on Next 15 semantics elsewhere:** nothing. Vercel must be building on Node 20.9+ (Next 16's floor);
local dev is on 22.17. The Node version is a **project-level** Vercel setting applying to all future builds,
preview and production alike — existing deployments are immutable and keep their build-time version. To pin
it per branch instead, use `engines.node` in `package.json`, which overrides the dashboard setting and travels
with the branch.

## Pending verification

Work that is built and merged but has **not** been QA'd in a browser. The owner does this manually.

- **Gallery OTT pack** (rails, hero billboard, kids mode, viewer profiles) — browser QA never done.
- **Expanding rail cards + series/episodes** — hover-expand, touch-tap, series collapse, next-episode
  countdown. Note: only one published storyline currently has a `series_id`, so the Series rail correctly
  stays hidden until a second episode is published. That is not a bug.
- **Search as a gallery mode** — mobile expand/collapse, Back exits search, scroll restoration, deep-linked
  `?q=`.
- **Gallery as landing / `/create`** — the composer move and the bounce-back guard.
- **My Stories drawer** — ⋮ overflow menu, paging at 30 rows, localStorage cache hydration.
- **Character library UX** — session bootstrap, thumbnail self-repair, sheet-first modal.
- **Runware provider + entitlement tier promotions** — 095/096 are applied, so this is now testable. Runware
  model prices are still unverified; check each in Runware's Playground before enabling a row.
- **Video export** — VLC / native player / YouTube / `ffprobe` checklist in
  [docs/video-export-fix-report.md](../video-export-fix-report.md).
- **Beat image pending UX** — the 20s foreground ceiling and adaptive polling. 080 is applied and `beats` is
  in the `supabase_realtime` publication, so the Realtime path is live rather than pending: verify media
  actually arrives over Realtime and not by polling fallback.
- **`@google/genai` 2.x live smoke** — confirm the legacy Interactions 400 warning is gone and stateful
  continuity actually carries via `previous_interaction_id`.
- **The Agentic Creator pipeline has now executed end to end on dev** (branch `feat/agentic-creator`).
  Two complete five-beat drafts exist, owned by the system user at `awaiting_review`. Verified by query:
  `agent_story_memory` stayed at 0 before promotion, 0 storylines were published, 0 image jobs were
  created (`prompt_only` holds), `ai_cost_events` carries real `agentic_creator` rows, and the system
  user's beat balance was unchanged (the billing bypass works). `agentic_creator_enabled` and
  `agentic_billing_bypass_enabled` are **on** on dev; the other four agentic flags remain off.
  Running it found three defects review had missed — see `fe9406f`.
- **Agentic admin surfaces are browser-verified.** `e2e/agentic-admin.spec.ts` now runs (15 passed, 0
  skipped) and covers all six agentic routes including `/admin/agents/test-lab`. It had never run from
  its documented setup: `playwright.config.ts` did not load `.env.local` and `dotenv` is not a
  dependency, so the spec read `process.env`, found nothing and skipped silently. Fixed in `fe9406f`.

That build backlog is cleared: `npm run build:verify` builds into its own directory, so the dev server can no
longer block it, and a full production build now runs as part of the standard gate. Browser QA above is
still manual — though `npm run test:e2e` covers the signed-out surfaces (gallery, `/create`, the `/admin`
redirect, cross-origin isolation, the image optimizer), so those no longer need re-checking by hand.

The signed-in half is the real gap: beat generation, image upload, narration, overlay and export were
hand-verified on 2026-08-26 and pass, but nothing automated covers them.

---

## Deferred / known gaps

Deliberate decisions, not oversights. Don't "fix" them without checking why.

**Agentic Creator (branch `feat/agentic-creator`)**

- **DEFERRED BY THE OWNER, 2026-09-14 — assignment notifications.** When a draft is auto- or
  manually assigned to a reviewer, nothing tells them. There is **no notification infrastructure in
  this codebase at all** — no email sender, no in-app inbox, no table, no digest job — so this is a
  from-scratch design job (delivery channel, opt-out, digest vs. per-event), not a feature to bolt on.
  The owner's explicit call while promoting Phases 1-11 to `dev`: ship the promotion, design this
  later. Do not start implementing it as part of unrelated work.
- **DEFERRED BY THE OWNER, 2026-09-14 — role-change audit history.** `agent_reviewers` records only
  `updated_by` (a "last editor" field), so promoting, demoting or suspending a reviewer overwrites
  the previous value and the history is gone. Reconstructing who changed a role, when, and from what
  is impossible after the fact. Needs a design decision plus a new append-only table and migration —
  the shape `agent_review_decisions` (112) already models. Deferred alongside notifications, same call.
- **The pipeline image-generation flag is enforced NOWHERE.** `agentic_pipeline_image_generation_enabled`
  (renamed by 118) is read by the admin toggle and referenced in doc comments, and by nothing else —
  no pipeline stage checks it, and nothing combines it with a persona's own `allow_image_generation`
  despite a comment claiming it does. **An admin can switch it on or off and behaviour does not
  change.** Pre-existing, surfaced by the 118 rename and deliberately left alone: wiring it up is a
  behaviour change, not a cleanup. Decide what it should actually gate — pipeline-only kill switch,
  or ANDed with the persona permission — before implementing.
- **A reviewer who triggers narration on an agent draft is not recorded on the job row.** Unit 9d (D13)
  re-stamps `narration_batch_jobs.user_id` with the story owner so the agentic billing bypass can fire,
  which is correct — but the table has no metadata column (migrations 068 and 069 are its whole schema),
  so the human who actually pressed the button survives only as a `console.info` line. That is an audit
  gap on *paid platform spend*, which is exactly the thing worth attributing. The fix is one additive
  column — `submitted_by_user_id uuid references auth.users(id)` — and a migration, deliberately not
  invented inside 9d. Belongs with Unit 9c, which is the surface that would display it.
- **`retryRun` cannot re-brief, so the admin Retry button is weaker than the automatic path.** A
  novelty block now clears `brief_ready` and the cached verdict so the next *automatic* attempt
  regenerates a brief (D12). `retryRun` resets `status`, `attempt_count` and `error_detail` but never
  touches `checkpoint`, so pressing Retry on a novelty-failed run replays the cached block and burns
  three more attempts achieving nothing. Not a regression — it behaved this way before D12 — but
  newly conspicuous now that the automatic path self-corrects. The fix is small (clear the same two
  keys `clearBriefForRebrief` clears) and belongs with whoever next touches `retryRun`.
- **RESOLVED — agent-owned narration now bills the agent, on both paths.** This entry used to say Unit
  8d was written up but not built. `57b516b` (Unit 9d) did the **batch** path: `actorKind` is forwarded and
  `narration_batch_jobs.user_id` carries the story owner, so the bypass in `authorizeBillableAction` is
  reachable. `04e739b` (Unit 9M) did the **interactive single-beat** path, which nobody had noticed was
  separate: it resolves no agentic payer at all, so a reviewer pressing "generate narration" was charged
  for both the narration and the overlay alignment — and, because the same missing identity also decided
  which Supabase client wrote the beat, the audio it paid for was never persisted. Measured on dev before
  and after; see phase9c-plan section 11.4. The image twin of that second half is still open — see the
  entry below.
- **Nothing in Phase 8 has been exercised against a live database.** The gate is entirely static
  (tsc, lint, 854 unit tests, build:verify, e2e). Every prior agentic phase found real defects only
  once a run touched Postgres. The verification queries are in the same handoff.
- **RESOLVED 2026-09-11 — a reviewer can now edit an agent draft.** The RLS facts below are unchanged and
  no policy was added: `stories` still allows any signed-in user to SELECT a non-archived story and still
  restricts UPDATE to `auth.uid() = user_id`. What changed is the route in. Unit 9b (`b7041b2`) made four
  write paths reviewer-aware through `assertCanEditStory` — `saveBeat`, beat editing, the narration batch
  and the image batch — and Unit 9M (`3347ffb`) closed the fifth and worst, `saveStory`, which did not throw
  `Forbidden.` as this entry predicted but reported success and wrote nothing (owner-only UPDATE matching
  zero rows is not an error in PostgREST). All five run on the admin client with `assertCanEditStory` as the
  entire boundary (D14) — the "admin-client server-action path" option this entry named, not the RLS one.
  Still true and still worth knowing: `persistence.ts`'s `serverAuth` escape hatch does NOT cover any of
  this; it remains scoped to worker media-state patches.
- **The evaluator's restricted-theme check is effectively English-only against beat text.** All 15 seeded
  personas store `restricted_themes` as ENGLISH phrases ("graphic violence", "self-harm"), including the 12
  that write in Hindi, Bangla, Gujarati or Marathi — verified by query, not assumed. JS `` is defined over
  `[A-Za-z0-9_]` and never holds beside a Devanagari/Bengali/Gujarati/Arabic character, and the English
  phrase would not appear in that prose anyway. The `briefThemes` half works for every persona, because
  `buildStoryBriefPrompt` asks for themes "in English" while the prose goes in the target language. It fails
  OPEN — a missed restriction, never a false one — and the model's `safety` dimension covers the same ground
  advisorily. Closing it properly needs script-aware boundaries plus translated restriction vocabularies.
- **A standalone `/admin/agents/evaluations` page was deliberately not built.** The pack lists it as a
  possible section; Phase 7 surfaces evaluations inside the Run monitor detail instead, because Phase 9's
  reviewer queue is about to build that surface properly and two of them would diverge.
- **Evaluation model calls are not billed through the coin economy.** Like the novelty adjudicator, the
  `agent_story_evaluation` call writes a real `ai_cost_events` row (`activity_key = 'agentic_creator'`) but
  takes no coin reservation. `PRICING_ACTION_KEYS` has no key that fits a platform-internal quality check no
  user ever triggers, and inventing one would need a migration and an admin pricing entry for a cost nobody
  chose to spend. `/admin/cost` still shows the true spend.
- **`agent_schedules` (migration 107) is unused.** `enqueueCommissionedTasks` ignores cadence entirely and
  drains whatever is commissioned. Wiring schedules into enqueue is unclaimed work, not an oversight.
- **Agent spend is indistinguishable from human spend by action key.** It reuses `preview_seed_plan` and the
  `*_prompt_only` beat keys; only `activity_key = 'agentic_creator'` separates it. Revisit in Phase 11
  (renumbered from 12 — Phase 11 was never written; see docs/agentic-creator-phase10-plan.md section 0.7).
- **A novelty `block` is now decided once, and only by the deterministic layer.** RESOLVED
  2026-09-08 (`32f2c65`). The adjudicator may downgrade a verdict but never escalate one
  (`applyAdjudication`, pure and tested), and the verdict is cached per run so a retry inherits it
  rather than re-adjudicating. Kept here because the reasoning matters: four adjudications of
  identical input returned block, block, warn, block, and the deterministic layer had never said
  block at all -- 2 reused names against a threshold of 4. An unauditable model call was the sole
  cause of a terminal run failure.
- **`findSimilarStories` has no self-exclusion.** `runDraftCreatedStage` now runs its post-generation
  check before writing to `agent_story_memory`, which avoids the problem at the only current call site.
  The general fix — an `excludeStoryId` threaded through `runNoveltyCheck` — is deferred; any future
  caller comparing an already-recorded story will hit the same self-match.
- **The interactive per-beat image regeneration still bills the reviewer, not the agent.** Found
  2026-09-11 by the Unit 9M browser run, alongside its narration twin, which WAS fixed (`04e739b`).
  `regenerateImageForNode` bills through `authorizeCurrentUserImageModelBillableAction`, which resolves
  the payer as `getCurrentUserId()`. This is **not** the "Create all visuals" batch — `a5e9bff` fixed
  that, and it is fine. Left for a designed change rather than patched: narration's
  authorize/run/finalize all sit inside one server action, so one resolved identity covered the whole
  operation, whereas the interactive image path has the CLIENT call `authorize`, `finalize` and
  `release` as three separately-invocable server actions, each deriving the payer from the session on
  its own. Paying from the agent account means all three accepting a story-derived payer and each
  re-running `assertCanEditStory` — a client-supplied `storyId` deciding who pays, on three endpoints.
  Measure it the way the narration one was measured (a real press, then read
  `beat_spend_reservations`), do not reason about it. Detail in phase9c-plan section 11.5.
- **`/review` (Unit 9h) redirects a signed-out visitor to `/`, not to sign-in with a return URL.**
  `app/review/layout.tsx`'s `requireReviewer()` gate mirrors `app/admin/layout.tsx`'s
  `redirect('/')`-on-throw exactly, matching existing admin behaviour rather than inventing a nicer
  flow for this one route. A sign-in redirect carrying `?next=/review` would be friendlier and is
  deferred, not forgotten — plan section 4.4.
- **Unit 9i (manual assignment) is code-complete; migration 114 is now applied on dev (2026-09-10, see the
  migration table above) but the feature is still unproven live.** `ReviewQueueListFilters.assignment`
  (`'mine' | 'unassigned' | 'all'`) is wired for real in `listReviewQueueAction`, and `ReviewQueue.tsx` has
  an assignee pill plus Assign-to-.../Reassign.../Release-assignment row actions gated on `canAssignWork`
  (editor role, D17). Before 114 was applied, every read degraded to "everyone unassigned" and every write
  threw a clear "migration 114 is not applied yet" error rather than a raw Postgres one; with 114 applied
  that fail-closed path is no longer exercised, but nobody has yet confirmed a real assignment row against
  the live schema. **The reviewer-picker gap** (plan section 5.3 does not
  say where the "Assign to..." dropdown's reviewer list comes from): `listReviewersAction` returns the
  full admin roster row (including `notes`, admin-only commentary, and un-filtered by status), so a new
  `listAssignableReviewersAction` was added instead — gated on `requireReviewer()` + `canAssignWork()`
  (not `verifyAdmin()`), filtered to `status = 'active'`, and projected to just `userId`/`displayName`/
  the three coverage arrays. The assignee pill itself resolves a display name through a separate,
  un-gated join inside `listReviewQueueAction` (against `agent_reviewers` directly, not through that
  action) so a plain reviewer — who cannot call the editor-gated picker — can still see who a draft is
  assigned to, including a since-suspended reviewer's name.
- **RESOLVED, partially — the `beats` INSERT policy no longer lets any signed-in user write into someone
  else's story, at the application layer.** Previously filed as "pre-existing, unrelated to reviewers"
  (`docs/agentic-creator-phase9d-handoff.md` lines 167-168). Phase 10 Round 1 (2026-09-12) closed the entry
  points: `67fad24` removed the one non-owner doorway (`StorylinePlayer.tsx`'s "Explore full story tree"),
  `e25d065`/`cc7ba14` gated `/story/[id]` and `/explore/[id]` to owner-or-reviewer (D24), and `d20ecb3`
  refused a non-owner continuation before `authorize` on both the legacy and bundle paths. **Not fully
  closed** — the RLS half is migration 115, which is written but not applied anywhere (see the migration
  table and "Shared branching" above). Until it's applied, a direct `saveBeat` invocation bypassing the now
  gated UI is still permitted by the database itself; the three application-level changes are what actually
  stop it today, not RLS.
- **RESOLVED — `autoPublishStoryline` now honours the public-publishing switch.** Previously filed as
  "pre-existing" (`docs/agentic-creator-phase9c-plan.md` line 281: "`autoPublishStoryline` never checks
  `publicPublishingEnabled` or `moderationRequiredForPublic`, so the auto-publish-on-ending path can publish
  publicly while the admin switch is off"). Fixed in `08cd0c1` (Phase 10 Round 1, item 6): it now calls
  `getMediaPipelineSettings()` and sets `visibility` / `published_at` / `moderation_status` explicitly in
  both write branches, mirroring `publishStoryline`.
- **Also closed in Round 1, not previously recorded as a gap here:** `publishStoryline` had no ownership
  check on the source story at all (`storylines` INSERT RLS only constrains the storyline row being
  inserted, nothing about which story it's built from) — fixed in `168f6c8` with a plain ownership check,
  deliberately not `assertCanEditStory` (that would let a reviewer publish an agent draft under their own
  name, reopening what `assertNotAnotherUsersAgentDraft` exists to prevent). And the bundle path's
  `processBeatVisuals` compared `story.user_id` to the caller directly instead of going through
  `assertCanEditStory`, so a reviewer continuing an agent draft through the bundle path (`beat_bundle_enabled`
  is on in dev) was charged and the beat generated before being refused at that last check — fixed in
  `2c7156e`.
- **New, found by the Round 1 audit and deliberately not bundled into migration 115 (plan section 3.4) —
  "Round 1b":**
  - `stories` carries an anonymous SELECT policy with no auth predicate at all — `USING (is_archived =
    false)` (`003_normalize_beats.sql` lines 219-222). Any anonymous caller can read any non-archived story
    row, including unpublished drafts; the comment says "for gallery metadata" but the policy covers the
    whole table. Not narrowed yet — it needs one targeted question answered first: what actually reads
    `stories` anonymously, and does the gallery depend on it or does it read `storylines` instead?
  - `storage.objects` lets any authenticated user read the `story-assets` bucket — comment says "needed for
    exploration of other users' story trees" (`003_normalize_beats.sql` lines 228-234). With exploration now
    gated to owner-or-reviewer (D24), that justification has expired, but the policy itself is untouched.
    Same treatment: check what actually serves images today before narrowing.
  - `storylines` has no UPDATE policy in any of the migration files. This is **fail-closed, a note rather
    than a hole** — every storyline update must already be going through the service-role client. Recorded
    so nobody adds a session-client update expecting it to work, and is baffled when it silently writes
    nothing instead of erroring.
- **Production consideration owed before migration 115 is ever applied there (plan section 3.6).** Dev has
  no real shared-branching data; production does. A beat whose `generated_by` differs from its story's
  `user_id` satisfies neither of 115's new policies through the session client — the explorer fails
  `s.user_id = auth.uid()`, the owner fails `generated_by = auth.uid()` — so such rows become immutable via
  the session client once 115 lands there. Narrow rather than alarming: batch narration/images run on the
  admin client (unaffected), and the interactive single-beat path already refuses someone else's beat today
  (`BEAT_ROW_NOT_FOUND`). Still owed before promoting 115 to production: count the affected rows and decide
  deliberately whether to leave them, reassign `generated_by` to the story owner, or accept them read-only —
  `select count(*) from beats b join stories s on s.id = b.story_id where b.generated_by <> s.user_id;` This
  session's Supabase access to production is read-only and this wasn't run; the owner runs it before 115
  reaches prod.

**Text models**
- **Evaluate → writer-repair loop deferred** (owner, 2026-09-14). A cheap evaluator whose verdict triggers an
  automatic writer repair conflicts with D9 ("a model call may never be the sole cause of an automatic
  consequence"). Amend or scope around D9 before building it. Existing bounded behaviour is unchanged: beat and
  seed generation get one code-validated repair retry; agent evaluation stays advisory.
- **The text generation server actions are open RPCs.** The four wrappers in `app/actions/text-model-proxy.ts`
  are `'use server'` exports any caller can invoke, exactly as the Gemini proxy was before. The gateway now
  limits them to enabled registry models, but nothing limits who calls them or how often. Pre-existing; a fix
  means moving the story path server-side or adding auth and rate limits.
- **Three text calls record no cost event:** options regeneration, story bible and discovery metadata. No
  activity key fits them, so `/admin/cost` undercounts those tokens.
- **Gemini `finishReason` / `promptFeedback.blockReason` are not mapped** to gateway error categories. A
  blocked Gemini response still surfaces as empty or invalid output, as it did before.
- **Slow reasoning models vs function duration.** Luna's row allows 120s. Only the API routes and the test lab
  set `maxDuration = 300`; page server actions, including beat generation, run under the project default.
  Check the Vercel plan's default before pointing a reader-facing task at Luna.
- **`app/actions/playground.ts` is dead code** (nothing imports it) and was deliberately not migrated.
- **"Used by" on Text Models counts task assignments only**, not agent persona overrides.
- **Gemini 3.8 Flash's introductory price ends 2026-12-31.** From 2027-01-01 it is $1.50 / $7.50 per 1M
  (cached $0.15). Update its entry in `lib/ai/pricing.ts` then, or Gemini cost rows understate by half.
- **Thinking level is not settable in the Story Playground or on agent persona overrides.** The playground
  tests a model at its own default level; a persona override runs at the model's default, never the task's
  level (by design — the task level belongs to the task's assigned model).
- **Admin Story Playground shows a masked error in production when a test fails.** `runPlaygroundTest` throws
  instead of returning the failure, so Next hides the detail. Pre-existing; return `errorDetail(error)` instead.
- **Thinking levels for Qwen 3.7 Flash and DeepSeek V4 Flash were seeded from OpenRouter's general docs**, not
  per-model confirmation. DeepSeek has had no live call at any level.
- **Qwen 3.7 Flash on OpenRouter returned HTTP 429 under back-to-back calls** in the live smoke, then passed on
  its own. The gateway reports `rate_limited` and never retries. Fine for advisory evaluation, which already
  tolerates a failed model call; not yet suitable for anything a reader waits on. A second run the same day,
  with 3s between OpenRouter calls, saw no 429.
- **Economy tasks may be cheaper on 3.5 Flash at Minimal than 3.8 Flash at Low.** 3.8 Flash's floor is Low; in
  the live smoke a one-word answer cost $0.000169 on 3.8 Low against $0.000077 on 3.5 Minimal. Migration 120 put
  graphic style extraction, voice selection and novelty assessment on 3.8 Low — compare on real calls.

**Billing and cost**
- The Story Bible LLM call is **unbilled** — it consumes tokens without a coin charge.
- The full `ImageModelSnapshot` — including both `providerCost*Usd` fields — still reaches the client inside
  `beat.imageGenerationMetadata.imageModelSnapshot`. The picker leak was fixed by splitting
  `ImageModelOption` / `ImageModelInternalOption`; this second path needs the same split and ripples into
  persistence and telemetry.

**Reliability**
- No durable per-beat attempt cap for narration — a beat repeatedly killed mid-generation never terminally
  fails. Needs a schema migration.
- The reconcile cron runs **daily at 03:00** only; more frequent runs need Vercel Pro.

**References**
- World canonical **image** routing on the client generation path is unimplemented — the text anchor works
  everywhere, but the image needs a server-side reference-resolution channel, since `config.references` JSONB
  is not re-signed on load.
- Reference sheets are exposed to non-owner explorers via `loadStoryTree` / `signStoryMapAssetUrls`. Accepted
  by the owner; only **raw uploads** are guaranteed private. The privacy contract is that a raw source `r2://`
  key must never land in `Character.referenceSheetUrl` / `portraitUrl` — it travels only in
  `StoryConfig.references`.

**Admin**
- `app/actions/admin.ts` (~line 144) fetches `profiles` after stories without checking the query error, so a
  failure silently yields null author names. Worth fixing if the content page shows missing authors.
- Deferred from the admin overhaul: per-section settings fetch scoping, splitting the `GlobalSettings`
  component, and a redirect for the orphaned `/admin/playground`.

**Content**
- `discovery_intro` was NULL on all published storylines as of 2026-08-10, so intro search and expanded-card
  blurbs have nothing to show until intros are generated.
- Published `story_generation` prompts need a **republish** to pick up series rules.
- Auto-build stories reject character mixing.
- `/blog` (`page_key: blog_news`) is unlinked from the whole app since the Help & Legal rework (2026-08-28) —
  the legal/auth UX pack is explicit that News does not belong in a legal destination, and there is no
  About/Updates surface to relocate it to yet. The route and content are untouched; only navigation was
  removed. Build one before re-linking it, rather than putting it back in Help & Legal.
- **Age assurance and verifiable parental consent are explicitly deferred**, not an oversight. The
  legal/auth UX pack's audit (`docs/legal-auth-audit.md`) confirmed a minor can create a Kissago account with
  no restriction at any layer (dialog, `AuthProvider`, `proxy.ts`, or the DB). The pack's adopted default is
  adult-held accounts with children supervised under a parent/guardian/educator's account — a policy and
  copy change, not an age-verification system. Real age assurance (DPDP-style verifiable parental consent,
  COPPA if the US is ever targeted) is a materially larger build and stays out of this pack's scope.

**Duplication to keep in sync**
- Portrait/reference helpers are copied into `lib/ai/portraits-server.ts`, and
  `mergeCharacterVisualReferences` / `withGeneratedOrigin` exist in both `beat-orchestration.ts` and
  `story-store.ts`. The legacy path was left untouched by design when the bundle path was added.

**Resolved since last recorded** (don't re-report these): the duplicate `StoryModelOverrides` interface now
has a single definition in `lib/ai/beat-orchestration.ts`, and `playground.ts`'s prompt imports are genuinely
used. `app/actions/story.ts` was a dead orphan and has been deleted.

---

## Roadmap notes

- **Text Model Gateway — code-complete on `feature/text-model-gateway`** (2026-09-14), **not yet merged into
  `dev`**. Registry-backed text models across Gemini, OpenAI and OpenRouter, an admin Text Models page with task
  assignments, and a live smoke test on all three providers. Nothing routes off Gemini until an admin enables a
  row and assigns it. Verification, routing and follow-ups:
  [../text-model-gateway-report.md](../text-model-gateway-report.md); handoff:
  [../text-model-gateway-working-memory.md](../text-model-gateway-working-memory.md).
- **Model Playground phase 2** — multi-provider support. Phase 1 (Gemini-only per-task model/cost testing) is
  live at `/admin/playground`. Phase 2 was scoped as either a single gateway (Vercel AI Gateway / OpenRouter)
  or independent providers per task. Much of this has since been overtaken by the real multi-provider image
  router (`lib/ai/image-providers/`) and ElevenLabs narration.
- **Runware is scoped to open-weight models only, on purpose.** It has no stateful continuity for any model
  (it is a stateless task API; "multi-turn" is client-maintained context), and it cannot undercut closed
  models — it resells Gemini/GPT-Image/Grok at negotiated fixed rates plus a proxy hop, so cost is flat and
  latency is worse. Savings come from switching **model families** (FLUX.2 / Seedream / Qwen), not from
  switching transport.
- **Narration is two independent layers**: Language (the language of the story text and audio) and Accent
  (how *English* is pronounced). Both shipped. Enabled languages: English, Hindi, Bangla, Gujarati, Marathi;
  Urdu ships disabled. Adding a genuinely new language still needs code — a locale in
  `SUPPORTED_NARRATION_VOICE_LANGUAGES` — before it can appear in the admin catalog. Real-world Gemini quality
  (story text *and* TTS) still needs verification per newer language.
