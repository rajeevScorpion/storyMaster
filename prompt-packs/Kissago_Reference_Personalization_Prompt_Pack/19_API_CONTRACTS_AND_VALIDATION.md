# API Contracts and Validation

Adapt endpoints/actions to existing API conventions.

## Conceptual operations

### Create source upload

Input:

- reference type
- optional display name
- draft story/setup ID
- file metadata

Output:

- source ID
- upload target or accepted file reference
- constraints
- idempotency token

### Finalize upload

Input:

- source ID
- checksum
- dimensions
- idempotency key

Output:

- validation status
- preview
- next action

### Create adoption

Input:

- source ID
- story/setup ID
- style ID
- model ID
- scope
- idempotency key

Output:

- adoption ID
- job ID
- cost/reservation
- status

### Adoption status

Output:

- status
- safe progress
- preview/canonical asset when ready
- error code
- retry/replace actions

### Attach adoption to custom option

Input:

- custom option/branch point
- existing adoption ID or new source ID
- stable character/world role

Output:

- branch-scoped adoption
- downstream generation readiness

## Server-side validation

Every mutation validates:

- authentication
- ownership
- feature toggle
- tier entitlement
- platform limit
- story/setup state
- branch scope
- style lock
- model availability
- coin balance/reservation
- source state
- idempotency

## Error taxonomy

Use stable internal codes and safe user messages:

- `REFERENCE_FEATURE_DISABLED`
- `REFERENCE_TIER_NOT_ALLOWED`
- `REFERENCE_LIMIT_REACHED`
- `REFERENCE_INVALID_FILE`
- `REFERENCE_SUBJECT_UNCLEAR`
- `REFERENCE_WORLD_UNCLEAR`
- `REFERENCE_MODERATION_REJECTED`
- `REFERENCE_SOURCE_EXPIRED`
- `REFERENCE_STYLE_MISMATCH`
- `REFERENCE_PROVIDER_UNAVAILABLE`
- `REFERENCE_ADOPTION_FAILED`
- `REFERENCE_INSUFFICIENT_COINS`
- `REFERENCE_BRANCH_CONFLICT`
- `REFERENCE_NAME_CONFLICT`

Do not expose raw stack traces or provider payloads.
