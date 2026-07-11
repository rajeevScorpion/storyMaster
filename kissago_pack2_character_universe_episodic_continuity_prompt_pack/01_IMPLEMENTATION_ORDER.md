# 01 — Implementation Order

This pack must be implemented in a deliberate order.

## Phase 0 — Discovery and safety setup

1. Create a new branch.
2. Inspect the Pack 1 state of the codebase.
3. Identify current story, beat, and character-generation/storage flow.
4. Identify current continuation logic, if any.
5. Identify current admin settings/feature flags.
6. Produce a short discovery report.
7. Confirm the safest integration points.

## Phase 1 — Character foundation

Implement first:

1. Character master/card model.
2. Character scopes: story, episodic branch, global.
3. Character-instance logic for use inside a story.
4. Logic to seed character cards from current named-character prompt definitions.
5. Save-to-global flow.
6. Character library UI basics.

## Phase 2 — Story continuity foundation

Then implement:

1. Episode branch model.
2. Story bible model.
3. Journal/event log model.
4. Automatic migration of named characters into new episode branches.
5. Continue-as-episode flow.
6. Carry-forward story bible and journal context.

## Phase 3 — Character mixing and local reuse

Then implement:

1. Select characters from the user library.
2. Bring selected characters into a new story locally.
3. Create local story instances without mutating the original source character.
4. Handle conflicting names or duplicate aliases safely.

## Phase 4 — Stabilization

1. Test continuing stories into episodes.
2. Test automatic character migration.
3. Test save-global and reuse flows.
4. Test mixed-character stories.
5. Test rollback and disable toggles.
6. Confirm no current Pack 1 or base Kissago behavior breaks.

## Do not reverse the order

Do not build episodic branching before the character data model is stable. Do not build character mixing before scope/instance logic exists.
