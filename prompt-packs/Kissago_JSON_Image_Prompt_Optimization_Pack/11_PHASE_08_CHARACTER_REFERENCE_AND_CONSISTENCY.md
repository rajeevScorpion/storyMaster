# Phase 08 — Character Reference and Identity Consistency

Improve character consistency across panels, beats and episodes without overloading prompts.

## Identity Source of Truth

Use the existing canonical character record and reference assets as the source of truth.

A character identity package may include:

- Stable character key
- Display name
- Compact visual identity summary
- Distinguishing features
- Current clothing state
- Colour anchors
- Reference portrait(s)
- Uploaded reference(s)
- Generated adopted-style reference
- Story/global scope
- Version or update timestamp

Do not generate a new identity description independently for every panel.

## Reference Mapping

For each provider:

- Attach references through native image/reference fields.
- Preserve deterministic ordering.
- Explicitly map reference A to Master Elrick, reference B to Leo, etc., where supported.
- Avoid sending unrelated references.
- Respect provider reference limits.
- Define a safe priority when too many references exist.

## Panel Presence

- Each panel must list exact named characters present.
- Prevent duplicate entries in canonical JSON.
- Add concise no-cloning language only where useful.
- A character absent from a panel should not be described as present.

## Clothing Continuity

Respect Kissago's story logic:

- Clothing may change when the plot requires it.
- Within a continuous scene, preserve the same clothing unless a change is explicitly defined.
- Store current clothing at the appropriate scene/beat scope.
- Do not permanently overwrite the base character identity when clothing changes temporarily.

## Reference Failure Handling

Handle:

- Missing asset
- Expired URL
- Provider download failure
- Unsupported format
- Too many references
- Low-resolution reference
- Conflicting references
- Character record changed after an old beat was created

Use safe fallback text and diagnostics. Do not expose storage secrets.

## Evaluation

Add consistency fixtures and score:

- Face/identity
- Hair and distinguishing features
- Clothing
- Body proportions
- Colour anchors
- Correct number of appearances per panel

## Deliverables

- Character identity package builder
- Reference selection policy
- Adapter integration
- Continuity tests
- Failure-handling tests
