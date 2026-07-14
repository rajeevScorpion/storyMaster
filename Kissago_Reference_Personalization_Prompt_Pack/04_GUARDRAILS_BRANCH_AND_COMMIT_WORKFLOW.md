# Guardrails, Branch and Commit Workflow

## Before coding

- Ensure working tree is clean or document pre-existing changes.
- Create a dedicated branch, for example:
  - `feature/reference-personalization`
- Capture current test/build status.
- Record relevant environment variables and feature flags without exposing secrets.
- Do not modify production configuration directly.

## Guardrails

1. No unrelated refactor.
2. No replacement of a working abstraction without evidence.
3. No hard-coded paid tiers.
4. No provider-specific logic in core story services.
5. No raw-upload URLs in public payloads.
6. No synchronous long-running adoption request tied to browser lifecycle.
7. No duplicate coin charge on retry.
8. No automatic retroactive regeneration.
9. No leaking references across users, stories or branches.
10. No style override from the uploaded reference.
11. No assumption that provider state is permanent.
12. No deletion of legacy client-side image-processing support.
13. No breaking schema migration.
14. No silent fallback that changes chargeable behaviour.
15. No use of a source reference after it has expired or been deleted without a clear user-visible state.

## Commit discipline

Use small meaningful commits, such as:

1. `chore(refs): document existing reference and continuity flows`
2. `feat(refs): add additive reference entities and settings`
3. `feat(refs): add private upload validation pipeline`
4. `feat(refs): add character adoption job`
5. `feat(refs): add world DNA extraction and visualization`
6. `feat(refs): integrate story creation and entitlements`
7. `feat(refs): route relevant references through image composer`
8. `feat(refs): persist story bible and continuity usage`
9. `feat(refs): add admin references personalization tab`
10. `feat(refs): support branch-local custom option references`
11. `test(refs): add integration, privacy and rollback coverage`
12. `docs(refs): add rollout and operations guide`

Every commit should leave the application buildable whenever practical.

## Stop conditions

Pause implementation and report before proceeding when:

- Existing storage mode cannot safely support private source assets.
- Current coin ledger cannot reserve and refund idempotently.
- The existing story schema has no safe additive extension path.
- Current provider abstraction cannot accept reference inputs without affecting other models.
- Custom-option branching does not have a durable branch identifier.
- A migration would require destructive conversion.
- The implementation would expose private source images in published stories.

Provide a practical workaround rather than forcing a fragile implementation.
