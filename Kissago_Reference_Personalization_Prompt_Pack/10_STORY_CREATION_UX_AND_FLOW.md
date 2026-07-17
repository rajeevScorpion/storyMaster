# Story Creation UX and Flow

## Placement

Add a section titled **Personalize with References** after the user has selected the visual style and image model, or at the closest existing point where these values are already stable.

Do not place adoption before the style is known.

## Suggested UI structure

### Character References

Each card includes:

- upload
- preview
- optional name
- validation state
- adoption state
- remove/replace
- estimated coin cost when applicable
- error/retry state

### World References

Each card includes:

- upload
- preview
- optional label
- description/visualization status
- remove/replace
- estimated coin cost
- error/retry state

### Limit display

Use resolved entitlements, not static copy.

Examples:

- `Character references: 0/2`
- `World references: 0/1`

## Story start behaviour

The codebase investigation should determine whether adoption happens:

- before story record creation,
- after a draft story is created,
- or as part of a story setup job.

Prefer a draft story/setup entity so uploads and durable jobs have a stable owner.

The Start Story action must:

1. Revalidate entitlement server-side.
2. Revalidate references.
3. Show total cost.
4. Reserve coins as a single transparent operation or linked sub-transactions.
5. Create durable adoption jobs.
6. Prevent duplicate starts.
7. Proceed to story generation only after required canonical references are ready, unless an explicit enabled fallback applies.

## Failure UX

Show actionable states:

- upload invalid
- subject unclear
- world not identifiable
- moderation rejected
- adoption failed
- provider temporarily unavailable
- tier limit changed
- insufficient coins
- source expired

Do not display raw provider errors.

## Existing users

When feature disabled or unavailable:

- hide or disable the section according to existing UX patterns
- do not affect normal story creation
- do not show irrelevant prompt fields
