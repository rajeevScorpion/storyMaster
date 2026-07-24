# Phase 03 — Visual Relevance Filter

Implement a deterministic filter that converts raw story/character/world data into visually relevant scene data before prompt compilation.

## Include by Default

- Physical appearance
- Clothing
- Distinguishing features
- Pose
- Expression
- Action
- Interaction
- Camera framing
- Composition
- Lighting
- Palette
- Environment
- Important objects
- Spatial relationships
- Continuity requirements
- Panel order
- User-requested visible changes

## Exclude by Default

- Database IDs
- User IDs
- Storage keys and URLs
- Beat numbers unless visually required
- Internal status fields
- Coin values
- Provider implementation details
- Narrative biography unrelated to appearance
- Abstract personality traits with no visual manifestation
- Duplicate summaries
- Processing flags

## Convert Narrative Traits to Visible Acting

Only when relevant to the panel:

- `patient mentor` → `warm, reassuring expression`
- `curious child` → `focused gaze and slightly raised eyebrows`
- `nervous` → `tense posture and uncertain expression`

Avoid over-translating every trait into exaggerated acting.

## Character Reference Awareness

When a valid reference image is supplied:

- Keep a compact identity descriptor.
- Do not repeat the full description in every panel.
- Mark identity preservation as critical.
- Let the provider adapter map the reference image through its native request format.

## Traceability

Return a diagnostic structure showing:

- Included fields
- Excluded fields
- Converted fields
- Warnings
- Reasons for exclusion or conversion

This diagnostic is for development/admin visibility and must not be inserted into the provider prompt.

## Tests

Add tests showing that:

- Internal IDs never enter prompt-ready data.
- Personality-only fields are excluded.
- Visible emotions are retained.
- User visual changes are retained.
- Reference-aware descriptions are compact.
- Critical action and identity data are never dropped.
