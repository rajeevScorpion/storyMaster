# Project State

The standing ledger of what is shipped, what is pending, and what is deliberately deferred. This is the
context that does not live in the code or in git history.

**Snapshot taken:** 2026-08-18, on `dev` at `f8fdb33`.

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

| # | File | Introduces | Last known status |
|---|---|---|---|
| 069 | `narration_accent` | `narration_batch_jobs.accent` | **Applied on both.** Prod was missed and fixed by hand 2026-07-13 after a live 500. |
| 074 | `beat_control_pack1` | tables `timeline_rewrite_events`, `beat_revisions` | Recorded pending — but beat-control features are in use, so likely applied. Verify. |
| 075 | `character_universe_pack2` | tables `character_masters`, `episode_branches`, `story_bibles` | Recorded pending — but the character library and episodes ship in the product, so almost certainly applied. Verify. |
| 076 | `video_export_engine_presets` | flag `video_export_presets_json` | Pending. **Optional** — code defaults cover its absence. |
| 077 | `beat_bundle_flag` | flag `beat_bundle_enabled` (seeded off) | Pending. The admin toggle's `setFeatureFlag` upsert creates the row anyway if 077 never ran. |
| 078 | `reference_personalization` | tables `reference_sources`, `reference_adoptions` | **Pending.** Required before enabling references. |
| 079 | `reference_direct_input` | `reference_sources.description`, mode flag, cost row | **Pending.** Must go in with 078. |
| 080 | `beats_realtime` | `REPLICA IDENTITY FULL` + `beats` added to `supabase_realtime` | **Pending.** Without it the client falls back to polling — no breakage, just slower media delivery. |
| 081 | `image_prompt_compiler` | compiler mode flag + Gemini capability | **Applied on dev** 2026-07-19. Prod unverified. |
| 088 | `storyline_discovery_metadata` | `storylines.discovery_intro`, `discovery_intro_status` | **Applied** — confirmed indirectly 2026-08-10 by querying `discovery_intro` across 39 published storylines. |
| 089 | `storyline_audience_genre` | `storylines.age_group`, `genre` | Very likely applied (kids mode and genre filters work). Verify. |
| 090 | `storyline_progress` | table `storyline_progress` | Very likely applied (Continue Watching rail depends on it). Verify. |
| 091 | `viewer_profiles` | table `viewer_profiles` | Very likely applied. Verify. |
| 092 | `backfill_beat_is_storyboard` | backfill audit table | Unverified. Backfill only. |
| 093 | `storyline_series` | `storylines.series_id`, `episode_number`, `series_title` | **Applied** — verified directly against the live database 2026-08-10. |
| 094 | `storyline_search_trgm` | `pg_trgm` + partial GIN indexes | **Pending.** Search works without it, just on sequential scans. |
| 095 | `runware_image_provider` | Runware rows in `image_model_registry` | **Pending.** ⚠ The seeded AIR ids and prices are **unverified guesses** — check each model in Runware's own Playground before enabling any row. |
| 096 | `user_entitlement_tier_overrides` | table `user_entitlement_overrides` | **Pending.** |

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

## Dormant / gated features

Built and merged, but not live for users. Each is behind a flag that defaults to off or to a no-op mode.

| Feature | Flag | State |
|---|---|---|
| Reference Personalization (upload character/world refs) | `reference_personalization_enabled` | **Off by default** — the whole feature is dormant. Apply 078 + 079 **first**, then flip the flag. Enabling before the migrations breaks uploads. |
| Reference input mode | `reference_input_mode` | Seeded `direct` (v2). `adoption` is the older v1 pipeline, kept but switchable off. |
| Reference attachment on custom options / branches | `reference_custom_option_attachment_enabled` | Off. Phase deliberately deferred. |
| Image prompt compiler | `image_prompt_compiler_mode` | `shadow` on dev — compiles and records a comparison but still **sends the legacy prompt**. Modes: `legacy` / `shadow` / `new` / `new_with_legacy_fallback`. `npm run compare:image-prompts` reports ~48–67% prompt reduction on fixtures. |
| Server-side beat bundle | `beat_bundle_enabled` | Off. Requires `server_pipeline` image mode. Toggle at `/admin/settings/media`. |
| Video export presets | `video_export_presets_json` | Code defaults cover absence. The 60fps ultra-smooth preset is **admin-only until mobile-verified**. |
| Runware image models | rows in `image_model_registry` | Not enabled — prices unverified. |

Note on the prompt compiler: in `shadow` mode, prompt-only stories copy the **legacy** prompt; the optimized
one exists only in `image_generation_metadata.promptCompiler.compiledPreview`. Switching to `new` also makes
with-image stories send the compiled prompt — it is a global setting, not per-story. The owner chose to leave
this as-is (2026-07-19) and use shadow for comparison until ready.

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
- **Runware provider + entitlement tier promotions** — needs 095/096 applied first.
- **Video export** — VLC / native player / YouTube / `ffprobe` checklist in
  [docs/video-export-fix-report.md](../video-export-fix-report.md).
- **Beat image pending UX** — the 20s foreground ceiling and adaptive polling, plus Realtime once 080 is
  applied.
- **`@google/genai` 2.x live smoke** — confirm the legacy Interactions 400 warning is gone and stateful
  continuity actually carries via `previous_interaction_id`.

`npm run build` has repeatedly **never been run** on several of these packs, because the dev server held
`.next` (see [GOTCHAS.md](GOTCHAS.md)). A fresh machine is a good opportunity to run a clean build and clear
that backlog.

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
