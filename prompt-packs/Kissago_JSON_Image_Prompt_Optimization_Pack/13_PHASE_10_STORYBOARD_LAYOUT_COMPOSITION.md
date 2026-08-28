# Phase 10 — Storyboard Layout and Composition Reliability

The current use case includes one full-bleed image containing exactly four equal panels in a 2×2 grid. Text prompting alone may not be equally reliable across models.

## Investigate Existing Composition

Determine whether Kissago currently uses:

- A single model generation for the full grid
- Separate panel generation followed by composition
- Layout reference images
- Masks
- Control images
- Canvas composition
- Provider-native multi-image tools

Preserve the working approach unless a measured improvement justifies a change.

## Supported Strategies

Choose per model based on evidence:

### Strategy A — Single Generation

Use one prompt for the complete grid when the model reliably follows multi-panel layouts and benefits from shared identity context.

### Strategy B — Controlled Panel Generation + Composition

Generate panels independently or in coordinated groups, then compose them into a deterministic grid. Address character consistency through shared references, seeds where available, identity packages and style/world anchors.

### Strategy C — Layout-Control Reference

Provide a clean 2×2 layout guide or composition reference where supported.

The coder may implement more than one strategy behind model capability settings.

## Hard Layout Rules

For the four-panel example:

- 9:16 vertical output
- Exactly four equal quadrants
- Reading order: top-left, top-right, bottom-left, bottom-right
- Thin near-black dividers only
- No outer padding
- No white or cream gutters
- No rounded frames
- Every panel edge-to-edge
- No nested panel inside a quadrant
- No text or labels

## Validation

Where practical, perform post-generation checks for:

- Approximate divider placement
- Panel count
- Unexpected large whitespace
- Text presence using an existing safe detector if available

Do not make OCR a mandatory expensive production step without justification.

## Deliverables

- Model-specific layout strategy
- Deterministic composition utility if needed
- Tests
- Quality comparison with legacy output
- Clear handling of retries and coin charging
