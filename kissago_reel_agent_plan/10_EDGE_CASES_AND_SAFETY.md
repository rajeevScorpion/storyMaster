# 10 Edge Cases and Safety

Implement defensively.

## Input edge cases

Very short prompt:

- Expand into a meaningful micro-story.
- Do not ask the user to rewrite unless required.

Very long prompt:

- Summarize and adapt into reel format.
- Preserve emotional intent.

Ambiguous mood:

- Use default mood preset.

Unsupported language:

- Use existing language handling.
- If none exists, default to app language or English and document limitation.

## Generation failures

Image generation partially fails:

- retry failed images only if current service supports it.
- preserve successful images.

Narration fails:

- allow retry.
- allow text-only preview/export if existing UX permits.

Export fails:

- preserve generated assets.
- expose retry.
- do not regenerate all assets unnecessarily.

## Admin misconfiguration

No active mood preset:

- use safe built-in default.

Invalid word range:

- clamp to safe default.

Storyboard image count too high:

- clamp to safe max.

Image duration invalid:

- clamp to safe range.

## Storage deletion safety

Do not delete:

- public stories unless explicitly allowed
- active generation/export jobs
- recently failed jobs within retry window
- assets referenced by multiple records
- records without safe ownership/plan determination

## Security and authorization

Verify server-side:

- story owner
- admin access
- plan permissions
- branding removal permission
- cleanup permissions
- export/download access

## Abuse/content safety

Use existing moderation/safety handling.

If no moderation exists, avoid adding broad new unsafe capabilities and document the gap.

