# 04 — Phased Implementation Plan

Work in phases. Commit after each phase. Each phase must keep the app usable.

## Phase 0 — Investigation, feature flags, and mode toggle

Deliverables:
- Investigation report
- Confirm current legacy client-side image flow and all files/modules involved
- Feature flag for server media pipeline
- Admin-selectable media processing mode with safe defaults
- Supported modes: `client_legacy`, `server_pipeline`, and optional `hybrid_canary`
- No production behavior change yet; default should remain the existing working client flow unless admin explicitly changes it
- Clear rollback path from server mode to legacy client mode without redeploying

Commit message:
`chore(media): investigate current generation and add media pipeline flags`

## Phase 1 — Durable job records with processing mode

Deliverables:
- Generation job table/model
- Story media table/model or adapted equivalent
- Store `processing_mode` on each job/media record
- API to create job and return status
- Routing layer that sends new jobs to the selected admin mode
- UI can show `queued/processing/ready/failed`
- Old generation path remains available as `client_legacy`, not only as hidden fallback

Commit message:
`feat(media): add durable generation job records`

## Phase 2 — Background processing

Deliverables:
- Queue integration or existing worker integration
- Generation job consumer
- Retry-safe job execution
- Idempotent job processing
- Job status updates in DB

Commit message:
`feat(media): process image generation in background worker`

## Phase 3 — Cloudflare R2 original save

Deliverables:
- Server fetch/download of generated image
- Upload original to private R2 key
- Record original key, mime type, bytes, dimensions if available
- Mark job as `original_saved`
- Retry storage failures

Commit message:
`feat(media): save generated originals to Cloudflare R2`

## Phase 4 — Server-side compression and variants

Deliverables:
- Server creates display/thumbnail/share variants
- Uploads derived assets to R2
- UI uses display image for normal viewing
- Gallery uses thumbnail
- Original stays private

Commit message:
`feat(media): create server-side optimized image variants`

## Phase 5 — Entitlements and retention

Deliverables:
- Tier-based retention windows
- Original expiry timestamps
- HQ download entitlement check
- Short-lived signed URL endpoint
- Cleanup job for expired originals

Commit message:
`feat(media): add tiered high-quality retention and download access`

## Phase 6 — Publish/private/unlisted

Deliverables:
- Story visibility controls
- Private route protection
- Public route rendering
- Unlisted share token
- Public stories use safe derived assets only

Commit message:
`feat(stories): add private public and unlisted visibility`

## Phase 7 — Quality toggle for higher tiers

Deliverables:
- Low/high quality toggle before share/publish for eligible tiers
- Entitlement checks on server
- UI disabled states for expired/unavailable HQ
- Fallback to standard quality if HQ unavailable

Commit message:
`feat(stories): add tier-based share and publish quality controls`

## Phase 8 — Admin controls and observability

Deliverables:
- Admin-configurable retention values
- Admin compression settings
- Admin publishing settings
- Logs/metrics for generation, storage, compression, cleanup
- Dead-letter/retry visibility where possible

Commit message:
`feat(admin): add media pipeline settings and monitoring`

## Phase 9 — Safe rollout and migration

Deliverables:
- Keep client-side image processing as a controlled legacy mode during rollout
- Do not remove the legacy path until server-side processing has been proven stable in production
- Add admin switchback documentation
- Migrate old media records if necessary, without breaking old story rendering
- Add final test coverage for both modes

Commit message:
`refactor(media): support safe media pipeline rollout and legacy mode`

## Phase 10 — Optional retirement of legacy mode

Only do this after explicit approval.

Deliverables:
- Analyze production stability metrics
- Confirm no active dependency on client-side cloud save for generated story images
- Keep client compression only as optional helper for user uploads/reference images
- Remove or hide legacy mode only after admin/product approval

Commit message:
`refactor(media): retire legacy client processing after approval`
