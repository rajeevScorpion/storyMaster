# 08 Rate Limiting, Branding, and Plans

Reel Story should use existing Kissago plan, credits, and rate-limit logic. Do not create a separate inconsistent system unless no existing system exists.

## Rate limiting

Reel Story should count as a creation method.

Where possible, cost/limits should account for:

- generated script
- number of generated images
- narration generation
- MP4 export/render
- downloads if existing logic tracks them

Admin should be able to tune limits where existing architecture allows.

## Branding

Default exports include Kissago branding.

Free users:

- Branding always enabled.
- No UI toggle to remove branding.

Paid users:

- Branding toggle visible only if admin setting allows paid users to disable branding.
- Server-side validation must enforce this.

Branding options:

- corner watermark: “Made with Kissago”
- final outro card
- both, if existing export system supports it

Keep branding subtle, premium, and visually aligned.

## Server-side enforcement

Do not rely on UI gating alone.

Server/API/export logic must verify:

- user plan
- admin setting
- requested branding flag

If unauthorized removal is requested, force branding enabled.

## Documentation

Document:

- how Reel Story consumes existing limits
- whether image count affects credits
- how branding is enforced
- what remains pending if plan model is unclear

