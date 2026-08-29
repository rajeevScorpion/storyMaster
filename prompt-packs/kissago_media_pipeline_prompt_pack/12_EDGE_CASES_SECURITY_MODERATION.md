# 12 — Edge Cases, Security, Privacy, and Moderation

## Edge cases

### Browser closes immediately
Expected: job continues server-side.

### Story deleted during processing
Expected: worker detects deletion/cancel state and stops or deletes generated assets according to policy.

### User account deleted
Expected: scheduled deletion of user's media objects or retention according to privacy policy.

### Provider returns remote image URL that expires quickly
Expected: worker must fetch and store original immediately.

### Provider returns base64
Expected: server decodes and stores original. Do not forward base64 to browser as persistence method.

### Compression fails after original saved
Expected: keep original, retry compression, show “optimization pending”.

### Original expires before share-high exists
Expected: high-quality share unavailable; standard share remains available.

### User downgrades
Expected recommended behavior: existing HQ retention remains until expiry; future jobs use new tier.

### User upgrades after Free generation
Decision needed:
- Either no retroactive HQ if original already deleted.
- Or allow HQ only if original is still in free processing buffer.
Recommended: allow only if original still exists.

## Security rules

- Never expose private original keys to the client.
- Never store long-lived signed URLs in DB.
- Generate signed URLs only after access checks.
- Sanitize all public story metadata.
- Do not include user email/name in public R2 keys.
- Validate MIME types and file sizes before processing.
- Set max image dimensions/bytes to avoid processing abuse.

## Publishing moderation

Kissago is child/family/story oriented. Public publishing should support:
- report story
- admin unpublish
- admin hide user public gallery access
- optional moderation before discovery listing
- block unsafe prompts/content based on existing safety systems

## Privacy

Private story means:
- private route
- private metadata
- private media access
- not indexed
- not visible in public gallery

Unlisted story means:
- not discoverable
- tokenized share link
- revocable link

Public story means:
- visible according to platform rules
- only safe derived assets exposed
- original remains private

## Abuse prevention

- Rate limit generation job creation.
- Enforce coin/credit consumption at accepted job stage or reserved-credit stage.
- Prevent duplicate accidental job creation through idempotency key.
- Add per-user worker concurrency limits if needed.
