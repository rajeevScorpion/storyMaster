# Phased Execution Prompts

Run these in order. Complete discovery before Phase 1.

---

## Phase 0 — Discovery and final plan

Inspect the repository using `03_CODEBASE_DISCOVERY_AND_GAP_ANALYSIS.md`.

Return:

- architecture map
- exact reuse points
- proposed changes
- migrations
- risks
- provider matrix
- phase-by-phase file plan
- unresolved material questions

Do not code until this report is coherent.

Commit documentation only if the repository stores implementation plans.

---

## Phase 1 — Foundations, schema and flags

Implement additive reference entities, settings schema, entitlement keys, job types and API types.

Requirements:

- master flag off by default
- Free defaults: 2 character, 1 world
- platform ceiling: 3 and 3
- existing stories unaffected
- no upload UI yet unless required for internal testing
- migrations backwards-compatible
- add tests

Commit after build/tests pass.

---

## Phase 2 — Admin References & Personalization tab

Implement the new Global Settings tab using the existing admin patterns.

Include:

- master and fine-grained toggles
- tier matrix
- processing settings
- upload settings
- fallback settings
- audit/validation
- safe defaults

Do not connect unsafe provider/model options that are not supported by current adapters. Show only valid choices.

Commit after admin permission, validation and persistence tests pass.

---

## Phase 3 — Private upload and preprocessing

Implement:

- story/setup ownership
- private source upload
- preview
- server validation
- checksum/idempotency
- character/world type
- signed access
- retention metadata
- cleanup

Reuse existing Cloudflare/storage and image-processing mode abstractions.

Do not expose upload UI broadly yet. Add internal or flag-gated testing path.

Commit after privacy and duplicate-upload tests pass.

---

## Phase 4 — Character adoption

Integrate with the current character-reference flow.

Implement:

- identity extraction
- stable/changeable trait separation
- optional naming
- canonical style adoption
- quality gate
- durable job
- Story Bible persistence
- coin integration
- notifications
- retries

Use selected story style and locked image model according to current product rules.

Commit after one supported provider works end to end and fallback behaviour is tested.

---

## Phase 5 — World adoption

Implement:

- World DNA extraction
- concise prompt anchor
- optional canonical visualization
- quality gate
- Story Bible persistence
- durable job
- coin integration
- retries

Support `description_only` and `description_plus_canonical_visual`.

Commit after tests pass.

---

## Phase 6 — Story creation UX

Add **Personalize with References** to story setup.

Implement:

- character/world sections
- optional names/labels
- tier counters
- cost preview
- progress/error states
- replace/remove
- duplicate-submit protection
- story generation gating

No-reference story creation must remain unchanged.

Commit after responsive and accessibility checks.

---

## Phase 7 — Image Composer routing

Implement normalized reference context.

Add:

- relevant character selection
- relevant world selection
- provider-aware priority
- handle/resend/description modes
- usage records
- prompt-section separation
- style-lock enforcement

Test with:

- no refs
- one character
- multiple characters
- one world
- provider input limit
- stateful and stateless paths

Commit after generated payload snapshots and integration tests pass.

---

## Phase 8 — Continuity, Story Bible and episodes

Complete:

- first-introduction tracking
- versioned adoptions
- episode carry-forward
- regeneration preservation
- library/local-character compatibility
- historical usage records
- provider-handle replacement

Do not modify established backward-editing behaviour except to include reference consequences.

Commit after episodic and regeneration tests.

---

## Phase 9 — Custom-option attachments

Keep behind a separate flag.

Implement:

- attach existing adoption
- upload new branch-local character/world
- locked-style adoption
- Story Bible branch extension
- continuity journal update
- downstream-only routing
- sibling isolation
- backward-edit invalidation handling

Commit separately so this phase can be disabled or reverted without affecting story-creation references.

---

## Phase 10 — Observability, canary and hardening

Add:

- job metrics
- cost metrics
- provider failures
- retry/fallback metrics
- privacy audit checks
- orphan cleanup
- admin operational view
- rollout documentation

Run full acceptance checklist and produce a release report.

Do not enable globally until canary results are acceptable.
