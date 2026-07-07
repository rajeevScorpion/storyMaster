# 11 — Testing and Acceptance Criteria

## Core acceptance tests

### Fire-and-forget
- Start generation.
- Close browser immediately.
- Wait for worker to complete.
- Reopen app.
- Story shows generated display image.
- Job status is `ready`.

### Refresh during generation
- Start generation.
- Refresh page while job is queued/generating/compressing.
- UI shows current status from DB.
- No duplicate generation unless explicitly requested.

### Original saved before compression
- Simulate compression failure.
- Confirm original remains saved.
- Retry compression.
- Confirm display variant becomes available.

### R2 upload retry
- Simulate temporary R2 failure.
- Job retries.
- No duplicate media records.
- Final object keys are deterministic or safely unique.

### Free user
- Generate image.
- View compressed display image.
- HQ download button hidden/disabled.
- Original expires according to free internal buffer setting.

### Plus user
- Generate image.
- HQ download available for default 10 days or admin setting.
- Download URL generated only after click.
- After expiry, standard viewing still works and HQ is unavailable.

### Studio user
- Generate image.
- HQ download available for default 30 days or admin setting.
- High-quality share/publish toggle visible.

### Private story
- Non-owner cannot view.
- Non-owner cannot access private display media.
- Owner can view.

### Unlisted story
- Link with token works.
- Link without token fails.
- Regenerating token invalidates old link.

### Public story
- Public page loads derived assets only.
- Original is never exposed.
- Public listing follows moderation/admin settings.

### Quality toggle
- Free user cannot choose high quality.
- Plus/Studio can choose high quality while eligible.
- Expired HQ state falls back to standard.
- Server rejects forged high-quality requests from ineligible users.

## Security tests

- User A cannot download User B original.
- Public story media response does not include R2 private original keys.
- Signed URLs are short-lived.
- Signed URL generation checks entitlement every time.
- Deleted/expired originals cannot be accessed through app endpoint.

## Regression tests

- Existing story generation still works behind feature flag.
- Existing stories remain viewable.
- Existing public/private routes, if any, do not break.
- Coin/tier system remains intact.
- Admin panel remains accessible.

## Load tests

- Batch generate multiple story images.
- Confirm worker concurrency limits are respected.
- Confirm compression does not block API response.
- Confirm queue backlog is visible.

## Manual QA checklist

- Mobile browser close after generate
- Weak network / airplane mode after generate
- Multiple tabs open
- User logs out after generate
- User changes plan after generate
- Story deleted while job processing
- Admin disables publishing while user is on publish screen
