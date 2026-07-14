# Product Requirements

## Feature name

**References & Personalization**

## User value

The feature allows users to create stories based on people, characters, places and imagined worlds that matter to them. Kissago turns uploaded material into a style-consistent story universe rather than merely pasting a photograph into generated scenes.

## In scope — first release

### At story creation

- Character-reference upload
- Optional character name
- World-reference upload
- Optional world label
- Tier-aware limits
- Admin-controlled feature availability
- Character identity extraction
- Character style adoption
- World DNA extraction
- Optional world style visualization
- Story Bible integration
- Image Composer integration
- Stateful/stateless provider handling
- Background processing
- Coin reservation/charge/refund integration
- Private storage and safe signed access
- Progress, success and failure states
- Existing story compatibility

### Later isolated phase

- New references attached to custom options
- Branch-local reference introduction
- Continuity journal updates
- Downstream-only application

## Out of scope unless existing infrastructure already supports it cleanly

- Editing an uploaded reference after story generation has started
- Applying a newly added reference retroactively to completed beats
- Automatic multi-person extraction from group images
- Unlimited cross-story world libraries
- Public marketplace for reference assets
- Training custom models or LoRAs
- Replacing the selected story style with upload style
- Rewriting unrelated story-generation infrastructure

## Functional rules

### Character references

- Up to 3 per story at platform level.
- Tier limits may be lower.
- Name is optional.
- When no name is supplied, create a non-colliding internal display name such as `Character 1`.
- Store the original upload separately from the story-adopted reference.
- Use the existing named-character mechanism where possible.
- Identity traits should remain stable.
- Clothing may evolve with the plot unless explicitly fixed.
- The system should not infer protected or sensitive personal attributes unnecessarily.
- The adopted reference, not the raw upload, is the primary generation anchor after adoption succeeds.

### World references

- Up to 3 per story at platform level.
- Tier limits may be lower.
- Label is optional.
- Extract concise structured World DNA.
- A canonical visualization is optional and controlled by entitlement/admin settings.
- World visualization happens once per adoption version, not on every beat.
- World descriptions can always accompany prompts.
- Only relevant world references are supplied to a beat.

### Visual style

- Story style remains locked.
- All adopted assets record the style/version used.
- Reference changes must not silently change the story style.
- A style change, if the product already supports it, must explicitly trigger re-adoption or display a compatibility warning.

### Story continuity

- Add adopted references to the Story Bible.
- Record first introduction point.
- Record stable identity/world anchors.
- Record provider handles without making them canonical.
- Carry compatible references into episodic continuations using the existing character/library rules.
- Branch-local custom-option references do not leak into sibling branches.

## Non-functional requirements

- Durable jobs: browser closure must not lose processing.
- Idempotent processing.
- Signed/private source image access.
- No raw private image in public story payloads.
- Existing stories continue working.
- Feature can be disabled without making already generated stories unreadable.
- Provider failure has a deterministic fallback.
- Admin sees failures and usage.
- Costs are visible before commitment where the current flow supports previews.
- Logging must not include full raw prompts or private images unless existing privacy-safe debugging explicitly permits it.
