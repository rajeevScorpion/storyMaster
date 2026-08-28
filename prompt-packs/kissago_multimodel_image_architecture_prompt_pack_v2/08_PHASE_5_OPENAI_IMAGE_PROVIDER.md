# Phase 5 — OpenAI Image Provider Integration

## Goal
Add OpenAI as an image provider through the new provider architecture.

## Important
Before coding, verify the latest official OpenAI image generation documentation and confirm:
- currently recommended image model id
- generation endpoint/API method
- supported sizes/aspect ratios
- reference/edit support
- response format
- rate limits/error behavior
- cost implications
- SDK version compatibility

Do not assume the model id or payload format.

## Implementation
Create an OpenAI image provider adapter that supports the current Kissago needs:
- text-to-image generation for story/reel visuals
- normalized response shape
- metadata logging
- error mapping
- cost estimation integration
- asset persistence

Prepare, but do not fully expose unless supported:
- edit image
- reference image
- multi-reference generation
- mask-based editing
- batch generation

## Config
Use existing project pattern for:
- API key
- organization/project id if relevant
- environment-specific config
- admin registry model id

## Errors to map
- missing API key
- invalid API key
- rate limit
- provider outage
- unsupported size/aspect ratio
- content/safety rejection if returned
- malformed provider response
- storage failure after generation

## Acceptance criteria
- OpenAI model appears in admin registry only when configured.
- Admin can enable it tier-wise.
- User can select it if allowed.
- Generated image is stored like existing assets.
- Coin cost is shown and charged safely.
- Commit created.

## Commit example
`feat(image): add OpenAI image provider adapter`

