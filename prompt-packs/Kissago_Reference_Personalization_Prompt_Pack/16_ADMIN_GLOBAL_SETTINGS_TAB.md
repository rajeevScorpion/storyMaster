# Admin — New Global Settings Tab

## Tab name

**References & Personalization**

Add it under the existing Global Settings system. Reuse current permissions, forms, validation, audit logs, caching and rollout conventions.

## Section A — Master controls

- Master feature toggle
- Character references toggle
- World references toggle
- Story-creation attachment toggle
- Custom-option attachment toggle
- Reference-library reuse toggle
- World visualization toggle
- Description-only fallback toggle

## Section B — Tier matrix

For each tier:

- Enabled
- Maximum character references per story
- Maximum world references per story
- Maximum saved character references
- Maximum saved world references
- Allow story-creation references
- Allow custom-option references
- Allow character regeneration
- Allow world regeneration
- Included character adoptions
- Included world analyses
- Included world visualizations
- Coin cost overrides or linked price rule
- Original retention
- Canonical retention

Seed Free as 2 character and 1 world.

## Section C — Processing

- Character analysis model
- Character adoption image model
- World analysis model
- World visualization model
- Reference fidelity/default strength where supported
- Maximum provider input images
- Stateful handle reuse
- Resend fallback
- Retry count
- Job timeout
- Concurrency
- Quality-check toggle
- Moderation toggle

## Section D — Upload rules

- Accepted MIME types
- Maximum file size
- Minimum dimensions
- Maximum dimensions
- Auto-crop/resize
- One-primary-character validation
- World/environment validation
- Ownership confirmation copy/version
- Original upload retention

## Section E — Failure and fallback

- Retry enabled
- Description-only fallback
- Refund on permanent failure
- Disable provider handle reuse
- Force canonical resend
- Pause new adoption jobs
- Safe maintenance message

## Section F — Observability

Display or link to:

- adoption jobs by status
- failure rate
- retries
- average cost
- average duration
- provider/model
- tier usage
- moderation rejection
- fallback usage
- orphaned uploads
- expired provider handles

## Behaviour rules

- Validate tier limits against platform ceiling.
- Settings changes are audited.
- Master disable prevents new references.
- Existing stories remain readable.
- In-progress jobs follow a clearly defined snapshot rule.
- Prefer snapshotting resolved settings into each adoption job.
- Dangerous changes require confirmation.
- Do not expose secret provider configuration.
