# Rollout, Feature Flags and Rollback

## Flags

Use existing feature-flag/admin-setting infrastructure.

Suggested logical flags:

- `reference_personalization_enabled`
- `character_references_enabled`
- `world_references_enabled`
- `reference_story_creation_enabled`
- `reference_custom_option_enabled`
- `world_reference_visualization_enabled`
- `reference_provider_handle_reuse_enabled`
- `reference_description_fallback_enabled`

Names should follow repository conventions.

## Rollout sequence

1. Code merged with master flag off.
2. Migrations deployed.
3. Admin tab visible only to authorized admins.
4. Internal staff test.
5. One provider/model canary.
6. One tier/user cohort canary.
7. Monitor failure/cost/privacy metrics.
8. Expand gradually.
9. Enable custom-option phase separately.

## Snapshot rule

When an adoption job starts, snapshot relevant configuration. Later admin changes should normally affect new jobs.

Do not leave a job changing provider, charge or fallback mid-run unless current job infrastructure explicitly supports it.

## Rollback

A rollback must be able to:

- disable new uploads
- pause new adoption jobs
- disable provider-handle reuse
- force canonical resend
- disable world visualization
- disable custom-option attachments
- leave existing stories readable
- preserve completed canonical assets
- safely settle queued/reserved coin transactions
- retain audit history

## Database rollback

Prefer forward-fix migrations. Do not drop new tables/fields during an emergency application rollback if deployed code may still reference them.

## Legacy image-processing mode

Preserve current admin-controlled legacy client-side mode and server-side durable mode.

Reference Personalization should use the resolved mode safely. Do not remove the safety net.
