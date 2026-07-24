# Phase 12 — Prompt Budgeting, Compression and Failure Fallbacks

Implement model-aware prompt budgets.

## Starting Targets

These are initial guidance only; validate against actual models:

- Single image: approximately 800–1,800 characters
- Four-panel storyboard: approximately 1,500–2,800 characters
- Complex scenes: configurable per model

Provider hard limits and observed quality should override these starting values.

## No Blind Truncation

When over budget, compress in priority order.

Suggested removal order:

1. Decorative environmental adjectives
2. Repeated palette synonyms
3. Secondary background objects
4. Redundant emotional wording
5. Repeated continuity statements
6. Low-priority style modifiers

Never silently remove:

- Character identity anchors
- Characters present
- Required action
- Important object
- Panel count/order
- Layout
- User-requested visual delta
- Critical negative constraints

## Compression Levels

Consider deterministic levels:

- Level 0: full optimised prompt
- Level 1: concise decorative details
- Level 2: compact world/style phrasing
- Level 3: minimal safe prompt preserving critical requirements

Return diagnostics showing the level used and removed information.

## Token Estimation

Use provider token counting only where available and relevant. Character count is a reliable cross-provider baseline.

## Failure Fallback

On compile/validation failure:

- Do not charge twice.
- Log the failure safely.
- Fall back to the legacy prompt path if enabled and valid.
- If both fail, return the existing user-facing error mechanism.

On provider prompt-too-long errors:

- Recompile at the next compression level.
- Retry within existing retry policy.
- Avoid infinite loops.

## Tests

- Each compression level
- Critical fields preserved
- Provider hard limit
- Retry path
- Legacy fallback
- Coin integrity
