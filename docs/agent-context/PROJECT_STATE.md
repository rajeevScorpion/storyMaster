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
| Development | `dxbwzcpbfacrwrauhdbk` | Where migrations get applied first |
| Production | `pddjsopcemsfiwyvhlkr` | `www.kissago.cc` / `kissago.cc` |

Migrations are applied **by hand, per environment, in the Supabase dashboard** — never by CLI. Drift between
the two is normal and expected; code must fail closed when a column or table is missing. This has already
caused one production incident (batch narration 500ing because `069_narration_accent.sql` was never applied
to prod).

Media: Cloudflare R2, staging bucket `kissago-media-staging` behind `media-stage.kissago.cc`, with Supabase
Storage as fallback. Deployment: Vercel (Hobby — which is why the reconcile cron can only run daily).

---

## Migration ledger

96 numbered migrations exist, each with a `_rollback.sql` twin. Everything up to 068 is long-applied. Below is
the last known status of everything after that — **verify against the live database before relying on it**,
using the query at the bottom of this section.

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
| 097 | `enable_rls_admin_config_tables` | RLS on six admin config tables | **PENDING on both.** Closes a live anon-key exposure — see "Security" below. |

Everything up to 068 is long-applied.

**Production (`pddjsopcemsfiwyvhlkr`) remains unverified.** The agent's Supabase MCP access is scoped to
development on purpose, so nothing above says anything about prod. Run the query below against it before
assuming parity — and note that the ledger was wrong in the *safe* direction here (features recorded as
pending were actually live), which is exactly the kind of drift that makes a prod assumption dangerous.

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

**Six admin configuration tables run with Row Level Security disabled** on dev, and almost certainly on prod
too (unverified — check it):

`model_config`, `model_config_history`, `prompt_configs`, `prompt_drafts`, `prompt_history`, `prompt_test_runs`

With RLS off, these are readable **and writable** by the `anon` and `authenticated` roles. The anon key ships
in the browser bundle by design, so this is reachable by anyone with devtools open. The consequence is worse
than a leak: `model_config` chooses the model and cost for every task, and `prompt_configs` holds the
published prompts every generated story is built from. Both are rewritable.

Migration **097** closes it by enabling RLS with no policies, matching what `feature_flags`,
`pricing_action_costs`, `operational_policies` and `image_model_registry` already do. That is safe here
because every reference to these six tables lives in `lib/ai/model-config.ts` and `lib/ai/prompt-config.ts`,
both `import 'server-only'` and both using `createAdminClient()` (service role, which bypasses RLS) — and no
view or database function reads them.

**Do not enable RLS on a table without checking its call sites first.** RLS with no policies denies everyone
except the service role; if any surface reads the table with the anon or user-session client, it silently
returns zero rows rather than erroring.

Run this against either environment to check the current state:

```sql
select c.relname,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and not c.relrowsecurity
order by c.relname;
```

---

## Dormant / gated features

Built and merged, but not live for users. Each is behind a flag that defaults to off or to a no-op mode.

| Feature | Flag | State on dev (verified 2026-08-26) |
|---|---|---|
| Reference Personalization (upload character/world refs) | `reference_personalization_enabled` | **ENABLED and in use** — 9 reference sources exist. Previously documented as dormant; it is not. |
| Reference input mode | `reference_input_mode` | `direct` (v2). `adoption` is the older v1 pipeline, kept but switchable. |
| Reference attachment on custom options / branches | `reference_custom_option_attachment_enabled` | **Off.** Phase deliberately deferred. |
| Image prompt compiler | `image_prompt_compiler_mode` | **`new`** — the compiled prompt is what actually reaches the image provider. This is no longer a shadow comparison. |
| Server-side beat bundle | `beat_bundle_enabled` | **ENABLED.** Requires `server_pipeline` image mode; toggle at `/admin/settings/media`. |
| Video export presets | `video_export_presets_json` | **ENABLED** with real preset JSON. The 60fps ultra-smooth preset stays admin-only until mobile-verified. |
| Runware image models | rows in `image_model_registry` | Migration applied, but prices remain unverified — do not enable a row before checking it in Runware's Playground. |

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
