# 12 Implementation Documentation

Documentation is mandatory and must be included with the implementation.

Create or update:

```text
docs/reel-story-generator-implementation.md
```

## Required sections

### 1. Codebase Findings

Include:

- files/routes/components inspected
- existing story creation flow
- existing admin settings flow
- existing storage flow
- existing generation flow
- existing export support or absence
- existing plan/rate-limit logic

### 2. Implementation Summary

Include:

- what was added
- what was changed
- what was intentionally not changed
- how Reel Story fits with existing architecture

### 3. Admin Configuration

Document:

- settings added
- prompt definer categories
- default presets
- Short/Medium/Long word range configuration
- storyboard image count configuration
- retention settings

### 4. Data Model and Migrations

Document:

- migration files created
- whether they were applied or not
- manual application instructions
- rollback notes
- generated type update requirements, if any

### 5. User Flow

Document:

- free user flow
- paid user flow
- branding behavior
- publishing visibility choice
- expiry/retention messaging

### 6. Storage Lifecycle

Document:

- retention rules
- cleanup safety rules
- dry-run/manual cleanup process
- assets included in cleanup
- audit logging

### 7. Export Support

Document:

- whether MP4 export is fully implemented
- if not, what foundation was added
- what remains pending

### 8. Testing Notes

Include:

- commands run
- results
- skipped checks and why
- manual QA performed

### 9. Known Limitations and Next Steps

Be honest and precise.

Examples:

- MP4 renderer pending
- subtitle sync approximate
- cleanup function manual only
- prompt playground preview only
- plan integration partially gated pending existing billing model

## Final response after implementation

When done, provide the user with:

- branch name
- summary of changes
- migration files created
- documentation file path
- checks run
- commit hash if committed
- push status: not pushed

