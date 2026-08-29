# Phase 8 — Testing, QA, and Rollout

## Goal
Verify that multi-model image generation is safe, maintainable, and does not break existing Kissago functionality.

## Automated tests to add or update
Adapt to project stack.

### Provider tests
- Gemini provider contract
- OpenAI provider contract with mocked API
- xAI/Grok provider contract with mocked API
- provider router selection
- unsupported capability handling
- normalized response handling

### Admin tests
- model enable/disable
- tier visibility
- default model validation
- misconfigured model hidden
- coin cost validation

### User flow tests
- allowed model visible
- unavailable model hidden or locked
- model selection persists
- cost estimate updates
- insufficient coins blocks generation

### Coin tests
- charge on success
- no unfair charge on failure
- refund/reversal if applicable
- idempotency on retries
- partial generation failure

### Regression tests
- existing Gemini generation still works
- legacy stories without selected model still work
- existing story/reel creation flow still works

## Manual QA checklist
1. Create story with default Gemini model.
2. Create story with OpenAI model.
3. Create story with Grok/xAI model.
4. Disable a model and confirm user cannot select it.
5. Restrict model to premium tier and confirm standard users cannot use it.
6. Confirm coin cost is shown before generation.
7. Confirm insufficient coins blocks generation.
8. Simulate provider failure and confirm fair coin behavior.
9. Confirm generated assets are stored permanently.
10. Confirm logs include provider/model/cost info.
11. Confirm old stories still open and regenerate safely.
12. Confirm UI does not expose future reference upload prematurely.

## Rollout recommendation
Use feature flags or admin-only release first:
1. Gemini adapter only
2. admin model registry hidden from users
3. OpenAI provider admin-only
4. Grok provider admin-only
5. limited premium beta
6. general user release

## Commit example
`test(image): add multi-provider generation regression coverage`

