# Media Pipeline Final Review

Implementation review of the durable server-side media pipeline
(`kissago_media_pipeline_prompt_pack/`), delivered on branch
`feature/server-media-pipeline` in phases 0–6 (commits
`chore(media): investigate…` through `feat(admin): add media pipeline settings and monitoring`).

## Requirements Met

- **Fire-and-forget generation (explicit generate/regenerate)** — `enqueueBeatImageJob`
  (`app/actions/image-jobs.ts`) creates a durable `image_generation_jobs` row (migration 071),
  writes `beats.image_status='pending'` server-side, and kicks `/api/media/jobs/run`. The worker
  (`lib/media/image-job-runner.ts`) generates, saves, and attaches images with no browser
  dependency. Story reopen calls `reconcileStoryImageJobs`; the reconcile cron is the backstop.
- **Job persists before heavy work** — the job row + reservation exist before any provider call.
- **Original saved privately to R2** — `processAndStoreImageVariants`
  (`lib/media/variant-pipeline.ts`) uploads the raw provider output to `R2_PRIVATE_BUCKET_NAME`
  under `stories/{userId}/{storyId}/media/{groupId}/original.{ext}` with a tier-stamped
  `original_expires_at`.
- **Server-side compressed variants** — display/thumbnail/share_low/share_high WebP via sharp,
  sizes/qualities admin-configurable; recorded as grouped `media_assets` rows (migration 072).
- **UI renders compressed display** — `beats.image_url` points at the display variant reference,
  signed at load through the existing `signStoryMapAssetUrls`/`signMixedUrls` machinery.
- **HQ download gated by entitlement + retention** — `createHqDownloadUrl`
  (`app/actions/media-hq.ts`) re-checks auth, ownership, `isHqEntitled`, and expiry on every call
  and mints a short-lived signed URL (TTL admin-configurable, default 300s). Never stored.
- **Free = no HQ; Plus 10d; Studio 30d (admin-configurable)** — `lib/media/retention.ts` +
  `media_pipeline_settings` (`freeRetentionHours` default 24, `plusRetentionDays` 10,
  `studioRetentionDays` 30, per-tier HQ toggles).
- **Visibility private/public/unlisted** — migration 073 on **storylines** (the entity users
  publish); unlisted uses a revocable, constant-time-compared share token; `robots: noindex`
  on tokenized links. `is_public` stays physical and trigger-synced, so all existing RLS and the
  gallery view are untouched.
- **Public/unlisted never expose originals** — readers serve display/share variants through
  signed URLs; originals live only in the private bucket behind the entitlement-checked action.
- **Quality toggle for higher tiers** — PublishDialog offers standard/high;
  `resolveValidatedPublishQuality` re-validates entitlement + share_high availability server-side
  with silent fallback + user notice. High-quality reads swap in `share_high` variants at load.
- **Admin controls** — `/admin/settings/media-pipeline`: processing mode (with confirm warning +
  canary allowlist + R2-unavailable lockout), retention/variant/cleanup/publishing/HQ settings,
  moderation gate; all live within ~60s via the feature-flag cache, no redeploy.
- **Cleanup job** — `cleanupExpiredOriginals` (reconcile cron + admin force action) deletes only
  the original object and stamps `metadata_json.expiredAt` (HQ checks fail closed); derived
  variants keep rendering.
- **Rollout safety (pack 14, non-negotiable)** — `client_legacy` is the default and the legacy
  path is byte-identical when selected; the mode is re-resolved server-side on every enqueue;
  every new job/media record stores its processing mode; the active-node unique index prevents
  duplicate jobs on double-click or mode flips; switching modes touches new work only and
  deletes nothing.

## Requirements Partially Met

- **Inline start/continue images** — per the approved plan they keep in-request generation but are
  persisted server-side (`persistInlineBeatImageAction` → variant pipeline) behind
  `serverPersistInlineImages`, removing the base64/IndexedDB dependency after generation
  completes. A tab closed *during* the generation request itself still loses that beat (text and
  image), same as today. Full job-routing of inline flows is the documented fast-follow.
- **hybrid_canary** — implemented as a user-ID allowlist (per approved plan), not
  percentage-based bucketing.
- **Reel bulk generation (`startReel`)** — images are generated before the story row exists, so
  inline server-persist does not apply there; reels keep the legacy save path (and were already
  batched/durable via the bulk flows once saved).
- **Metrics** — job/asset counts and expiring-original counts are live; storage **bytes** by
  variant were skipped (PostgREST aggregate support not enabled).

## Missing Items

- No per-storyline "share settings" panel post-publish beyond the actions
  (`setStorylineVisibility`, `rotateStorylineShareToken`, `revokeStorylineShareToken` exist and
  are UI-ready but only PublishDialog and admin actions call the surface today).
- No moderation review UI (the gate holds `pending` rows out of listings; approval currently
  means updating `moderation_status` via admin content tools/SQL).
- No dead-letter queue view beyond the failed-jobs list + requeue.
- `autoPublishStoryline` untouched: it publishes public via `is_public: true` (the 073 trigger
  derives `visibility='public'`), but does not stamp `published_at`.

## Risks

- **story_map vs worker write race** — mitigated: beats table is written first and is the source
  of truth; server-mode clients never write `imageUrl` for pending nodes; poller/reopen re-merge
  from beats. Residual: a stale full-map autosave can briefly lag beats until the next load.
- **Reservation lifecycle** — finalize/release only on status-guarded terminal transitions;
  reconcile + `expireStaleReservations` are backstops. Admin requeue retries are intentionally
  free (reservation was already released on failure).
- **Signed reference URLs on late retries** — job references stored as plain URLs (not staged
  base64) can expire before a much-later retry; the worker drops unfetchable refs gracefully
  (continuity degrades, generation still succeeds).
- **`recordMediaAsset` now writes 072 columns** — apply migration 072 before deploying this
  branch, or ledger writes fail (they are caught + logged, media itself is unaffected).
- **Unlisted token semantics** — revoking kills the link at the page/action layer. The storyline
  UUID itself is unguessable but is not rotated on revoke.

## Security Findings

- Private original keys never leave the server; the HQ endpoint returns only short-lived signed
  URLs after per-call auth + ownership + entitlement + expiry checks.
- Share tokens: crypto-random 24 bytes, URL-safe, constant-time compared, partial unique index.
- Processing mode, publish quality, and visibility are all re-validated server-side; forged
  client values are ignored.
- Worker route and reconcile cron require `Bearer CRON_SECRET` (non-production allows local dev
  without it, matching the existing batch routes).
- Object keys use internal IDs only (no emails/names).

## Performance Findings

- Worker follows the proven time-budget (`WORKER_TIME_BUDGET_MS`, default 20s) + awaited
  self-re-kick pattern; one decoded buffer feeds all variants sequentially (bounded memory).
- Variant post-processing adds ~4 sharp encodes + 5 R2 puts per image (~1–3s) — amortized in the
  background worker; on the inline path it adds that once per beat while the user already waits
  10–30s for generation.
- Poller: one lightweight owner-scoped select per 8s only while jobs are in flight.

## Recommended Follow-Up Commits

1. Route inline start/continue image generation through jobs (split text/image reservations) so
   mid-generation tab closes lose nothing.
2. Storyline settings UI for visibility changes + share-link rotate/revoke after publish.
3. Moderation review queue (approve/reject) once the gate is enabled.
4. Percentage-based canary bucketing if allowlist testing proves insufficient.
5. Byte-level storage metrics via a SQL function/RPC.
6. Optional R2 lifecycle rules on `stories/*/media/*/original.*` as the safety net behind the
   DB-driven cleanup.

---

## Rollout & Rollback Runbook (admin/developer)

**Prerequisites** — apply migrations in the Supabase dashboard, in order: `070`, `071`, `072`,
`073` (each has a `_rollback.sql`). Apply **before** deploying this branch (the media ledger
writes 072 columns).

**Rollout sequence**
1. Deploy with `media_processing_mode = client_legacy` (default) — zero behavior change.
2. Admin → Settings → Media pipeline → set mode to **Hybrid canary**, add your admin user ID.
3. Dogfood: regenerate a beat image, close the tab immediately, reopen after ~1 min — image
   should be present; check `image_generation_jobs`, `media_assets` (5 variant rows/group),
   coins finalized once.
4. Widen the allowlist → then switch mode to **Server-side durable processing**.
5. Enable `serverPersistInlineImages`, then `variantsForBulkJobs`.
6. Later phases: retention/HQ settings, visibility/publishing gates as desired.

**Rollback (no redeploy)**
1. Admin → Settings → Media pipeline → mode = **Legacy client-side processing**. New generations
   use the legacy flow immediately (~60s flag cache).
2. In-flight server jobs finish on their own; stuck ones are reclaimed by the reconcile cron or
   can be requeued/inspected in the monitoring panel. Nothing is deleted.
3. Server-generated media keeps rendering from its saved R2 variants in every mode.
4. Independently revertible flags: `serverPersistInlineImages`, `variantsForBulkJobs`,
   `cleanupEnabled`, publishing/moderation gates.

**Emergency stops** — turning off R2 (env or storage settings) hard-forces `client_legacy` for
all new work; `cleanupEnabled=false` halts retention deletion.
