# Phase 13 — Admin Controls and Observability

Add practical controls and diagnostics using the existing admin architecture.

## Admin Controls

Where appropriate, support:

- Enable new compiler globally
- Enable per provider/model
- Feature rollout percentage
- Shadow mode percentage
- Prompt budget per model
- Compression policy
- Legacy fallback
- Reference strategy
- Adapter version
- Log-retention policy

Use sensible defaults. Do not expose raw prompt editing to admins unless the current system already supports it safely.

## Generation Diagnostics

For authorised admin/development views, record:

- Scene schema version
- Compiler version
- Adapter version
- Provider/model
- Original legacy prompt length, when shadow-compared
- New prompt length
- Percentage reduction
- Compression level
- Reference count
- Removed-information categories
- Warnings
- Provider error category
- Latency
- Retry count
- Fallback used

## Privacy and Security

- Redact signed URLs, storage keys and personal data.
- Restrict prompt visibility to authorised roles.
- Apply retention controls.
- Avoid logging full user prompts in general analytics systems.

## Comparison View

In development/admin tooling, provide a readable comparison:

- Legacy prompt
- Compiled prompt
- Character and token counts
- Removed duplicates
- Critical requirements retained
- Provider request summary

## Monitoring

Track:

- Prompt-too-long failures
- Generation failures by adapter/model
- Fallback rate
- Average prompt reduction
- Character consistency evaluation on sampled fixtures
- Layout failure rate
- Regeneration failure rate

## Deliverables

- Admin/config integration
- Safe logging
- Metrics
- Comparison tool
- Tests for permission and redaction
