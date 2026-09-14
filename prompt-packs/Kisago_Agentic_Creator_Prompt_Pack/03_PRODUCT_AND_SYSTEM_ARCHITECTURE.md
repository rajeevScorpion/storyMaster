# Product and System Architecture Requirements

## Goal
Build a persistent agentic editorial system that creates Kisago stories at scale while maintaining originality, age appropriateness, learning/entertainment value, multilingual creative identity, continuity, cost control, human oversight and recoverability.

This is not a stateless prompt-to-LLM feature.

## Core actors

### Editorial Supervisor / Content Manager Agent
Decides **what should be created and which persona should create it**.

V1 responsibilities:
- semantic awareness of existing catalogue,
- detect repetition/content gaps,
- age-group/language/genre/value balance,
- understand episodic/series relationships and recurring characters,
- know active/inactive personas,
- create task pool/commissions,
- assign suitable personas.

### Execution Orchestrator
Reliably executes approved tasks: scheduling, job state, retries, idempotency, model routing, bounded service/tool calls, permission checks, cost/usage telemetry, run history and recovery.

### Creator Persona
Provides creative identity. Persona concepts include display identity, language, audience/age group, genres, storytelling philosophy, tone, vocabulary/pacing tendencies, preferred beat range, voice defaults/pool, Advanced Settings defaults, editable prompt, permissions and persistent memory.

Personas are database-seeded/editable, not hardcoded logic.

### Independent Evaluator
Creator should not be its only grader. Evaluate coherence, age fit, language, persona fidelity, originality, repetition, name reuse, pacing, educational/entertainment value, safety and review readiness. Combine deterministic checks and model evaluation where practical.

### Human Reviewer / Expert Author
V1 publication requires human review. Reviewer reads/listens, edits, approves/rejects/requests regeneration, triggers downstream media when authorized and publishes/selects editorial classification when authorized.

## Programmatic creation principle
Agents must not operate the UI. Prefer:
`Agent -> same domain/service layer used by human UI`.
The result must be a normal editable Kisago project/story.

## Preferred V1 creation pathway
Use existing Seed Story pathway if repository inspection confirms it is the most direct/stable route.

Desired sequence:
1. Task commissioned
2. Persona creates concept/brief
3. Novelty check against global + persona memory
4. Persona writes complete Seed Story
5. Persona chooses permitted settings
6. Normal Kisago draft/project is created
7. Optional narration if enabled
8. Evaluation
9. Human review
10. Reviewer triggers remaining media as appropriate
11. Publish

Use the existing equivalent of strict follow/no adaptation when appropriate and confirmed. Do not invent settings.

Defer autonomous Prompt Story beat-by-beat exploration to future scope unless trivially isolated.

## Advanced Settings
Each persona carries a default Advanced Settings profile based only on actual supported Kisago settings. Admin can inspect/edit defaults and control which settings the persona may change dynamically.

Once a story/series establishes production settings, episodic extensions should inherit them by default for continuity using the existing project/series architecture.

## Media-cost gates
### Images
`Allow Image Generation` is a per-persona/admin capability and **defaults OFF**. When OFF, no autonomous image call may occur.

### Narration
Narration/TTS is independently toggleable. Do not invent a universal default. Existing forced alignment should follow existing narration flow.

### Economic staging
Prefer text -> narration/TTS + forced alignment -> images. Allow a draft to stop after cheap stages for human review before expensive media.

## Human-in-the-loop publication
V1 principle: **AI creates drafts. Humans certify publishable stories.** No autonomous publication bypass.

## Provenance and editorial labels
Keep creator provenance separate from editorial classification.
Visible editorial options:
- From Kisago Creators
- Kisago Original
- Premium Story

Agent-origin work can start as From Kisago Creators and be promoted after review. Future human creators can also receive Original/Premium classification. Do not bind Premium Story to subscription semantics unless existing product explicitly does so.

## Persona catalogue
Filterable by age group, language, genre, status and search. Lifecycle concepts: Draft, Testing, Active, Paused, Archived, mapped to existing conventions if equivalent.

## Persona Test Lab
Admin can choose a persona, optionally provide a theme, run an unpublished test, inspect brief/story/settings/model routing/novelty/evaluation, and optionally create a normal draft. Test mode must not pollute production feeds.
