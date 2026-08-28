# Phase 3 — Coin Cost Engine for Image Models

## Goal
Make model costs transparent, realistic, and safe.

Users must know the coin cost before selecting/generating with a model.

## Investigate first
Before changing coin logic, inspect:
- current wallet/coin tables
- transaction records
- current deduction/refund behavior
- existing idempotency or duplicate-charge protection
- current regeneration pricing if any
- subscription/tier logic

## Implement
Add or extend cost estimation so it supports:
- per-model cost
- per-operation cost if needed
- story-level estimate
- per-image estimate
- regeneration cost
- discounts or tier modifiers if already supported
- admin-configured pricing

## Recommended cost flow
Prefer one of these, based on existing architecture:

### Best option: reserve then capture
1. Estimate cost.
2. Check user has enough coins.
3. Reserve/hold coins.
4. Generate image(s).
5. Capture final charge on success.
6. Release/refund unused reservation on failure.

### Simpler option: charge after success
1. Estimate cost.
2. Check user has enough coins.
3. Generate.
4. Deduct only after successful asset storage.

### Compensation option: charge then refund
Use only if existing system forces it.
1. Deduct.
2. Generate.
3. Refund automatically on provider failure or asset-storage failure.

## Must handle
- failed generation
- partial success
- retry
- duplicate callback/job retry
- insufficient coins after estimate
- model price changed during generation
- admin disables model during generation
- provider timeout

## User-facing requirement
The user must see:
- cost per image or story
- total estimated cost
- warning for regeneration costs
- insufficient coin message before generation starts

## Acceptance criteria
- Costs are visible before generation.
- Billing is not duplicated.
- Failed generation is not unfairly charged.
- Coin transactions are auditable.
- Commit created.

## Commit example
`feat(coins): add per-model image generation cost estimation`

