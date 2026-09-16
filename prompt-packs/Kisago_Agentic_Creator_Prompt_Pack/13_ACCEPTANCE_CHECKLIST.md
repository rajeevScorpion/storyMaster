# V1 Acceptance Checklist

## Architecture
- [ ] Admin route split audited before planning.
- [ ] Final route/module structure documented.
- [ ] No UI automation for agentic creation.
- [ ] Existing story/domain services reused where practical.
- [ ] Feature can be disabled with normal Kisago unchanged.

## Personas
- [ ] 15 database-seeded personas.
- [ ] English, Hindi, Bangla, Marathi, Gujarati represented.
- [ ] Seed distribution mapped to actual age taxonomy.
- [ ] Editable, cloneable prompts/settings/voice/permissions.
- [ ] Image generation default OFF.
- [ ] Narration independently configurable.
- [ ] New/cloned persona automatically gets memory.

## Admin
- [ ] Agentic functions modularized under approved Agents area.
- [ ] Reviewer/author functions modularized under approved Authors area.
- [ ] Persona filters: age/language/genre/status/search.
- [ ] Persona Test Lab.
- [ ] Schedules/runs visible.
- [ ] Reviewer queue/assignments visible.

## Memory/originality
- [ ] Global story memory.
- [ ] Persona memory.
- [ ] Titles/briefs/plots/themes/character names covered.
- [ ] Pre-generation novelty check.
- [ ] Post-generation similarity check.
- [ ] Series continuity distinguished from duplication.

## Editorial Supervisor
- [ ] Catalogue-aware.
- [ ] Knows persona availability.
- [ ] Creates/assigns tasks.
- [ ] Detects basic age/language/genre/value gaps.
- [ ] Audience analytics deferred.

## Orchestration/model routing
- [ ] Recoverable stateful jobs, schedules, retry/idempotency, run history.
- [ ] Task-role model routing.
- [ ] Model names not hardcoded in persona logic.
- [ ] Admin-configurable mappings/fallbacks documented.
- [ ] Cost/usage visibility where feasible.

## Story creation
- [ ] Codebase-grounded Seed Story integration.
- [ ] Full story generated before downstream production.
- [ ] Persona chooses only permitted settings.
- [ ] Normal editable Kisago draft/project created.
- [ ] Episode continuity inherits locked settings.

## Human review/media
- [ ] AI cannot publish autonomously in V1.
- [ ] Existing users can become approved reviewer/expert author.
- [ ] Reviewer reads/edits/listens/approves/rejects/requests rewrite.
- [ ] Text-only run works.
- [ ] Narration toggle works independently.
- [ ] Existing forced alignment intact.
- [ ] Image OFF technically prevents image calls.
- [ ] Image can be explicitly enabled/triggered.
- [ ] Retries don't duplicate paid generation.

## Publishing
- [ ] Provenance separate from editorial classification.
- [ ] From Kisago Creators supported.
- [ ] Kisago Original supported.
- [ ] Premium Story supported.
- [ ] Future human Original/Premium creators remain possible.
- [ ] Existing publishing behavior intact.

## Quality/recovery
- [ ] Regression baseline documented.
- [ ] Existing critical flows retested.
- [ ] New feature tests added.
- [ ] Migrations additive/recoverable where possible.
- [ ] Living docs current.
- [ ] Meaningful commits created.
