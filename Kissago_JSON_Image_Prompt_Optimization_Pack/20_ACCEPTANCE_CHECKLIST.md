# Acceptance Checklist

## Architecture

- [ ] Canonical JSON is the internal source of truth.
- [ ] Schema is versioned and runtime validated.
- [ ] Legacy records can still generate images.
- [ ] Provider logic is separated into adapters.
- [ ] Model capabilities are centrally configured.

## Prompt Optimisation

- [ ] Global layout is stated once.
- [ ] Style/world are stated once unless a panel intentionally differs.
- [ ] Each character identity is defined once.
- [ ] Panels refer to character names without repeating full descriptions.
- [ ] Internal IDs never reach the final prompt.
- [ ] Negative constraints are deduplicated.
- [ ] User instructions are scoped correctly.
- [ ] No blind truncation is used.
- [ ] Compression diagnostics are available.

## Character and Scene Consistency

- [ ] Reference images are mapped through provider-native mechanisms where supported.
- [ ] Correct characters appear in each panel.
- [ ] Named characters are not accidentally cloned.
- [ ] Clothing continuity is maintained unless intentionally changed.
- [ ] Important objects remain continuous across panels.
- [ ] World references and scene anchors are retained.

## Storyboard

- [ ] Exact panel count and reading order are preserved.
- [ ] Full-bleed grid requirements are retained.
- [ ] Thin dark dividers are correctly requested or composed.
- [ ] No extra nested panels are introduced by the compiler.
- [ ] Model-specific layout strategy is documented.

## Reliability

- [ ] Prompt limits are provider/model aware.
- [ ] Legacy fallback works.
- [ ] Shadow mode does not call paid image generation twice.
- [ ] Fallback/retry does not charge coins twice.
- [ ] Queue jobs record compatible compiler/adapter versions.
- [ ] Errors are safely classified and logged.

## Quality

- [ ] Median prompt length is materially reduced.
- [ ] Prompt-too-long failure rate is reduced or eliminated.
- [ ] Character consistency equals or improves upon baseline.
- [ ] Scene and panel consistency equals or improves upon baseline.
- [ ] User regeneration instructions remain effective.
- [ ] Multiple runs were evaluated to account for model variance.

## Operations

- [ ] Admin can disable the new path.
- [ ] Rollout can be controlled per provider/model.
- [ ] Logs redact secrets and personal data.
- [ ] Documentation explains how to add a model adapter.
- [ ] Rollback runbook is tested.
- [ ] Handover report is complete.
