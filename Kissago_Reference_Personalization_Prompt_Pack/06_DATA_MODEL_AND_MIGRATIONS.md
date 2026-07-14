# Data Model and Migration Guidance

Use existing naming and ORM conventions. Prefer additive tables/collections or additive nullable fields.

## Conceptual entities

### `reference_sources`

- `id`
- `user_id`
- `type`: `character | world`
- `display_name`
- `storage_key`
- `mime_type`
- `size_bytes`
- `width`
- `height`
- `checksum`
- `validation_status`
- `moderation_status`
- `privacy`: private
- `created_at`
- `deleted_at`
- `retention_expires_at`

### `story_reference_adoptions`

- `id`
- `story_id`
- `source_reference_id`
- `reference_type`
- `scope_type`: `story | episode | branch`
- `scope_id`
- `display_name`
- `style_id`
- `style_version`
- `image_model_id`
- `adoption_version`
- `status`
- `structured_description_json`
- `prompt_anchor_text`
- `canonical_asset_id`
- `provider_state_json`
- `first_introduced_beat_id`
- `created_by_user_id`
- `created_at`
- `updated_at`
- `superseded_at`

### `story_reference_usages`

- `id`
- `adoption_id`
- `story_id`
- `branch_id`
- `beat_id`
- `usage_role`
- `included_in_prompt`
- `input_mode`: `provider_handle | canonical_resend | description_only`
- `provider_job_id`
- `created_at`

### `reference_jobs`

Reuse the existing durable job entity when possible. Otherwise include:

- `id`
- `job_type`
- `adoption_id`
- `status`
- `step`
- `attempt`
- `idempotency_key`
- `reserved_coin_transaction_id`
- `failure_code`
- `failure_message_safe`
- `created_at`
- `started_at`
- `completed_at`

## Structured descriptions

Avoid storing a single unversioned prose blob only. Store a versioned structured payload plus a concise compiled anchor.

### Character structure

- identity summary
- approximate visible age category when necessary for depiction
- face and head
- hair
- body/silhouette
- distinctive marks
- stable accessories
- temporary clothing
- expression baseline
- prohibited drift
- reference confidence
- extraction version

### World structure

- summary
- world type
- architecture
- geography
- spatial layout
- materials
- palette observations as source information, not style lock
- lighting
- atmosphere
- recurring objects
- scale
- continuity anchors
- prohibited drift
- extraction version

## Migration safety

- Add indexes for ownership, story, branch, status and checksum.
- Add unique protection around idempotency keys.
- Do not backfill all existing stories.
- Existing stories should have no adoption rows.
- Add nullable Story Bible references or a versioned extension object.
- Rollback must not delete already generated canonical assets.
- Disabling the feature should prevent new creation while preserving read paths.

## Versioning

Every adoption must record:

- Source checksum
- Extraction schema version
- Style ID/version
- Image model/provider version where available
- Prompt compiler version
- Canonical asset version

This allows deterministic debugging and future re-adoption.
