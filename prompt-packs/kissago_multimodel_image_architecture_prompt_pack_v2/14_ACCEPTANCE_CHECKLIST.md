# Final Acceptance Checklist

## Investigation
- [ ] Existing Gemini flow investigated.
- [ ] Story/reel generation flow mapped.
- [ ] Coin system inspected.
- [ ] Admin/tier system inspected.
- [ ] Storage and failure flow inspected.
- [ ] Official API docs verified before OpenAI/Grok implementation.
- [ ] Clarifying questions asked after investigation.

## Architecture
- [ ] Provider abstraction exists.
- [ ] Gemini is wrapped behind provider adapter.
- [ ] Provider responses are normalized.
- [ ] Provider router selects model safely.
- [ ] Future providers can be added without major rewrite.

## Admin
- [ ] Admin can enable/disable models.
- [ ] Admin can include/exclude models by tier.
- [ ] Admin can configure coin cost.
- [ ] Admin can mark default/recommended/premium/experimental.
- [ ] Misconfigured models are hidden from users.

## User flow
- [ ] User can select image model during story/reel creation.
- [ ] User sees only allowed models.
- [ ] User sees coin cost before generation.
- [ ] Selected model is stored at story/reel level.
- [ ] Legacy stories still work.

## Coins
- [ ] Estimate is shown before generation.
- [ ] Insufficient coins are handled before generation.
- [ ] Failed generation does not unfairly charge the user.
- [ ] Coin events are logged/auditable.
- [ ] Regeneration cost is clear.

## Providers
- [ ] Gemini works as before.
- [ ] OpenAI provider works when configured.
- [ ] xAI/Grok provider works when configured.
- [ ] Provider failures are handled gracefully.
- [ ] Generated assets are stored permanently.

## Consistency
- [ ] Story-level visual profile foundation exists.
- [ ] Prompt compiler can use shared visual invariants.
- [ ] Future reference upload support is scoped architecturally.
- [ ] No fake reference upload UI is exposed.

## Safety
- [ ] Nothing already working has broken.
- [ ] Tests added/updated.
- [ ] Manual QA completed.
- [ ] Rollout/feature flag plan considered.
- [ ] Meaningful commits completed phase-wise.

