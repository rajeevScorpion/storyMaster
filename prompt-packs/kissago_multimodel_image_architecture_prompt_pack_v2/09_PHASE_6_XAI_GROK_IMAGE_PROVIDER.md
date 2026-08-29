# Phase 6 — xAI / Grok Image Provider Integration

## Goal
Add xAI/Grok image generation as a provider through the same architecture.

## Important
Before coding, verify the latest official xAI/Grok image generation documentation and confirm:
- currently recommended model id
- API endpoint/payload
- authentication method
- response format
- whether returned images are URLs, base64, or files
- whether URLs are temporary
- supported aspect ratios/resolutions
- edit/reference support
- rate limits/error behavior
- cost implications

Do not assume the model id or response shape.

## Implementation
Create an xAI/Grok image provider adapter that supports:
- text-to-image generation for story/reel visuals
- normalized response shape
- metadata logging
- error mapping
- cost estimation integration
- safe asset persistence

## Special caution
If the provider returns temporary URLs, immediately copy the generated image into Kissago’s own storage before considering generation successful.

## Errors to map
- missing API key
- invalid API key
- rate limit
- provider outage
- unsupported aspect ratio/resolution
- temporary URL expired before storage
- malformed provider response
- storage failure

## Product positioning
Treat Grok as configurable by admin. It may be marked:
- experimental
- premium
- fast variation model
- available only to selected tiers

Do not hardcode such labels; let admin config decide if possible.

## Acceptance criteria
- Grok/xAI provider works through provider router.
- Admin can enable/disable and tier-control it.
- User sees cost before using it.
- Generated images are persisted safely.
- Failures do not create unfair coin charges.
- Commit created.

## Commit example
`feat(image): add xAI Grok image provider adapter`

