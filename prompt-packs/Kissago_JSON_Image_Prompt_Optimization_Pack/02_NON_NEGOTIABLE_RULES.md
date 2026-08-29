# Non-Negotiable Engineering Rules

## Codebase Grounding

- Inspect existing services, schemas, request builders, queues, provider clients and admin configuration before proposing replacements.
- Reuse existing abstractions when they are sound.
- Avoid introducing a second source of truth for scenes, characters or references.
- Do not rename or move major modules merely to fit this pack.

## Existing Behaviour to Preserve

Confirm and preserve, where present:

- Story and beat creation
- Multi-panel storyboard generation
- Character reference portraits
- User-uploaded character references
- World references
- Model selection and tier restrictions
- Coin calculation and deductions
- Asynchronous jobs
- Regeneration without changing story continuity
- Overall image-change instructions
- Per-panel advanced image instructions
- Backward-edit continuity rules
- Episodic character migration
- Storage and compressed/HQ assets
- Existing error recovery and retries
- Admin configuration

## Prompt Safety and Integrity

- Never interpolate untrusted user text into system-level prompt control without boundaries.
- Preserve user creative instructions while preventing them from overriding structural requirements such as panel count and character identity.
- Do not include database IDs, signed URLs, storage keys, user IDs or internal diagnostics in the final model prompt.
- Sanitize control characters and excessively long free-text fields.
- Maintain traceability from canonical fields to compiled sections.

## Reliability

- The same JSON and adapter version should generate deterministic text output.
- Provider limits must come from configuration/capability records, not scattered constants.
- Compression must be priority-aware, not blind truncation.
- A failed new compile or validation must have a safe fallback path.
- Legacy and new paths must not both charge coins for one user request.

## Change Discipline

- Use a dedicated branch.
- Make one meaningful concern per commit where practical.
- Include migrations with rollback notes.
- Add tests before enabling the new path by default.
- Do not delete the legacy compiler during initial rollout.
- Document environment variables and admin settings.
