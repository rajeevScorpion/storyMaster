# 08 — Retention and Entitlements

High-quality storage is a product entitlement, not a permanent default.

## Default retention rules

Free:
- Normal compressed viewing: yes
- HQ download/export: no
- Original retention: 0–24 hours internal processing buffer, admin configurable

Plus:
- Normal compressed viewing: yes
- HQ download/export: yes
- Original retention: 10 days default, admin configurable

Studio:
- Normal compressed viewing: yes
- HQ download/export: yes
- Original retention: 30 days default, admin configurable

## Retention source of truth

Use application DB timestamps as source of truth:
- `originalExpiresAt`
- `hqDownloadAllowedUntil`
- `hqShareAllowedUntil`

Use R2 lifecycle rules as a safety net, not the only source of entitlement logic.

## Download entitlement check

Before generating an HQ download URL:
1. Authenticate user.
2. Confirm user owns story/media or has valid permission.
3. Confirm tier allows HQ download/export.
4. Confirm original exists.
5. Confirm `now < originalExpiresAt`.
6. Generate short-lived signed URL.

## Downgrade behavior

Recommended rule:
- Existing HQ retention already earned remains until its original expiry date.
- New generations use the user's current tier.

This avoids surprising users and reduces support issues.

## Expired original behavior

If original has expired:
- Story remains viewable using compressed display version.
- Standard share/export remains available if derived assets exist.
- HQ download/export shows unavailable state.
- Optional CTA: “High-resolution file has expired. Regenerate or upgrade for longer future retention.”

## Cleanup job

Run scheduled cleanup:
- Find media where `originalExpiresAt < now` and `originalKey IS NOT NULL`.
- Delete original object from R2.
- Null or mark original key as expired according to schema preference.
- Keep display/thumbnail/share-low assets.
- Record cleanup status.

## Admin settings

Admin should configure:
- Free original retention hours
- Plus original retention days
- Studio original retention days
- Cleanup enabled/disabled
- Cleanup batch size
- Preserve originals on failed compression true/false

## Cost principle

Do not permanently store high-quality originals for all users. Store compressed long-term and retain originals only when they create product value or are needed for recovery.
