# Post-Implementation Audit Prompt

Audit the completed implementation against this pack and the actual codebase.

Do not merely summarize code. Verify behaviour with tests and concrete evidence.

## Audit areas

### Architecture

- Existing abstractions reused appropriately
- No duplicate continuity system
- No provider logic leaked into core services
- No unrelated rewrites

### Product behaviour

- Free resolves to 2 character and 1 world
- Platform ceiling is 3 and 3
- Tier controls work
- Character naming optional
- World label optional
- Style remains locked
- Character adoption works
- World description and visualization modes work
- Only relevant references reach Image Composer
- Custom-option references are branch-local

### Reliability

- Durable jobs
- Idempotent retries
- Browser closure safe
- Duplicate request safe
- Coin charge/refund correct
- Provider handle expiry safe
- Deployment compatibility

### Privacy

- Raw sources private
- Signed access
- No source URL in public payload
- Logs safe
- Deletion/retention implemented

### Compatibility

- No-reference stories unchanged
- Existing stories readable
- Current character references unchanged
- Existing episodes/regeneration work
- Client/server image-processing mode preserved
- Admin rollback works

## Return

1. Pass/fail table
2. Evidence with file paths and test names
3. Remaining defects
4. Severity
5. Required fixes
6. Safe rollout recommendation
7. Any configuration that must remain disabled
