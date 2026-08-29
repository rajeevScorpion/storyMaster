# Project State

The standing ledger of what is shipped, what is pending, and what is deliberately deferred. This is the
context that does not live in the code or in git history.

**Snapshot taken:** 2026-08-26, on `dev` at `4c34dbd`. The migration ledger and flag states below were
**verified directly against the development database** on that date, not carried over from notes.

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
| 101 | `schema_migration_ledger` | table `schema_migration_ledger`, self-recorded by every migration from here on | **Not yet applied anywhere** — new as of 2026-08-29, awaiting the owner's manual apply to dev and prod. |

Everything up to 068 is long-applied.

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

Built and merged, but not live for users. Each is behind a flag that defaults to off or to a no-op mode.

Flag state **differs between environments**, and that difference is the point — dev runs ahead. Both columns
verified 2026-08-26.

| Feature | Flag | dev | production |
|---|---|---|---|
| Reference Personalization | `reference_personalization_enabled` | **on** (9 reference sources in use) | **off** — dormant, as designed |
| Reference input mode | `reference_input_mode` | `direct` | `direct` |
| Reference attachment on custom options | `reference_custom_option_attachment_enabled` | off | off |
| Image prompt compiler | `image_prompt_compiler_mode` | **`new`** — compiled prompts are sent | **`shadow`** — legacy prompt still sent |
| Server-side beat bundle | `beat_bundle_enabled` | on | on |
| Video export presets | `video_export_presets_json` | on, real preset JSON | on, real preset JSON |
| Runware image models | rows in `image_model_registry` | seeded (unverified prices) | **absent** — 095 not applied |
| Legal consent gate | `legal_consent_gate_enabled` | **on** — migrations 099/100 applied, four documents published 2026-08-29 | **off** — migration 099 applied 2026-08-29 (seeds the flag `false`); documents not yet published on prod, do not enable until they are |

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

That build backlog is cleared: `npm run build:verify` builds into its own directory, so the dev server can no
longer block it, and a full production build now runs as part of the standard gate. Browser QA above is
still manual — though `npm run test:e2e` covers the signed-out surfaces (gallery, `/create`, the `/admin`
redirect, cross-origin isolation, the image optimizer), so those no longer need re-checking by hand.

The signed-in half is the real gap: beat generation, image upload, narration, overlay and export were
hand-verified on 2026-08-26 and pass, but nothing automated covers them.

---

## Deferred / known gaps

Deliberate decisions, not oversights. Don't "fix" them without checking why.

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
