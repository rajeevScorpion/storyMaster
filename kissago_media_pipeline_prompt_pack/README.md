# Kissago Durable Media Pipeline Prompt Pack

Purpose: implement a server-owned, fire-and-forget story image generation and storage system for Kissago using Cloudflare R2.

Core product goal:
- User can start story/image generation and close the browser.
- Server continues generation, saves images safely, compresses variants, and updates status.
- Next load fetches finished story images normally.
- Normal viewing uses compressed images.
- High-resolution original/export remains private, tier-retained, and entitlement-gated.
- Users can keep stories private, publish publicly, or share unlisted.
- Higher-tier users can choose low/high quality before sharing or publishing.

Recommended execution order:
1. `00_STARTER_PROMPT.md`
2. `01_INVESTIGATE_FIRST.md`
3. `02_TARGET_ARCHITECTURE.md`
4. `03_DATABASE_SCHEMA.md`
5. `04_PHASED_IMPLEMENTATION.md`
6. `05_API_CONTRACTS.md`
7. `06_WORKER_QUEUE_AND_RETRY.md`
8. `07_R2_STORAGE_AND_MEDIA_VARIANTS.md`
9. `08_RETENTION_AND_ENTITLEMENTS.md`
10. `09_PUBLISH_PRIVATE_SHARE_QUALITY.md`
11. `10_ADMIN_PANEL_CONTROLS.md`
12. `11_TESTING_AND_ACCEPTANCE.md`
13. `12_EDGE_CASES_SECURITY_MODERATION.md`
14. `13_FINAL_REVIEW_PROMPT.md`

Cloudflare docs to verify during implementation:
- Cloudflare R2 overview: https://developers.cloudflare.com/r2/
- R2 S3-compatible API: https://developers.cloudflare.com/r2/api/s3/api/
- R2 Workers API: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- R2 presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- R2 lifecycle rules: https://developers.cloudflare.com/r2/buckets/object-lifecycles/
- Cloudflare Queues overview: https://developers.cloudflare.com/queues/
- Cloudflare Queues retries: https://developers.cloudflare.com/queues/configuration/batching-retries/
- Cloudflare Dead Letter Queues: https://developers.cloudflare.com/queues/configuration/dead-letter-queues/

## Rollout safety addendum

This pack now requires the current client-side image download/compression/re-upload cloud-save flow to remain available as `client_legacy`. The new server-side durable Cloudflare R2 pipeline should be introduced behind an admin-selectable processing mode so production can switch back without redeploying if needed.
