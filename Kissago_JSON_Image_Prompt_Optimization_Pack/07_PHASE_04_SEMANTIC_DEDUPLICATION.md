# Phase 04 — Semantic Deduplication and Normalisation

Build a deterministic normalisation layer that removes repeated visual concepts before natural-language compilation.

## Do Not Use Only Exact String Matching

The system should recognise overlap such as:

- `warm golden palette`
- `gold and amber sunlight`
- `sunlit golden tones`

These normally become one global visual instruction unless a panel intentionally differs.

Likewise:

- `elderly scholar with a long white beard and spectacles`
- `old mentor wearing glasses with a long white beard`

should map to one canonical character identity description.

## Preferred Implementation

Use predictable techniques first:

- Canonical field structure
- Normalised tags/enums where practical
- Synonym maps for common visual terms
- Set-based merging
- Priority rules
- Scope rules: global, character, panel
- Difference detection between global and panel-specific values

An LLM-based optimiser may be added as an optional offline/admin tool, but should not be required for every generation without evidence that it improves quality enough to justify latency, cost and nondeterminism.

## Scope Rules

- Global properties appear once.
- Character identity appears once per character.
- Panels refer to defined characters by stable display name.
- Panel-specific differences override global values only within that panel.
- Negative constraints appear once, or in a provider-specific negative field.
- Layout instructions appear once.

## Preserve Meaning

Never merge concepts that are visually different:

- `golden daylight` and `blue moonlight`
- `red apple` and `green apple`
- `smiling` and `worried`
- `wide shot` and `close-up`

## Output

Return:

- Normalised scene
- Removed duplicates
- Conflicts discovered
- Resolution decisions
- Warnings requiring provider-adapter handling

## Tests

Create unit tests for:

- Exact duplicates
- Synonym duplicates
- Global versus panel overrides
- Conflicting lighting
- Conflicting clothing
- Repeated negative constraints
- Repeated layout constraints
- Character identity preservation
