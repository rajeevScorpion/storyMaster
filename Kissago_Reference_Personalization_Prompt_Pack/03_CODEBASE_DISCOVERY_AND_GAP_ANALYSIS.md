# Codebase Discovery and Gap Analysis Prompt

Do not write production code yet.

Inspect the repository and return a concise but concrete report with file paths, modules, data models and call flows.

## Trace these flows end to end

1. Story creation form and advanced settings
2. Visual style selection and style persistence
3. Image model selection and per-story model locking
4. Named-character extraction
5. Current character-reference visualization and storage
6. Story Bible and continuity anchors
7. Beat creation and Image Composer invocation
8. Prompt compilation
9. Image-provider adapter invocation
10. Image upload, compression, Cloudflare/storage handling
11. Client-side versus server-side image-processing mode
12. Job creation, queue, retry and completion notification
13. Custom-option creation and branch continuation
14. Backward-edit continuity warning and downstream invalidation
15. Character Library and episodic character migration
16. Tier/plan entitlement resolution
17. Coin estimate, reservation, debit and refund
18. Global Settings tabs and admin permission checks
19. Public/private/unlisted story payloads
20. Test and deployment patterns

## Find reusable components

Specifically report whether the codebase already contains:

- Generic upload component
- Image crop/resize component
- Image metadata table
- Character entity or reference table
- Story asset table
- Story Bible JSON
- Provider reference-image input support
- Provider session/reference-handle support
- Feature flag service
- Tier capability matrix
- Admin setting registry
- Durable job state machine
- Signed URL helper
- Content moderation helper
- Coin reservation ledger
- Idempotency-key conventions

## Produce

### A. Current architecture map

Use a text diagram showing UI → API → service → job → provider → storage → database → UI completion.

### B. Gap table

For every required capability:

- Existing implementation
- Can reuse?
- Required change
- Risk
- Suggested phase

### C. Data ownership map

Identify source of truth for:

- Raw upload
- Styled adopted reference
- Extracted description
- Story Bible identity
- Provider reference handle
- Tier entitlement
- Coin transaction
- Job status

### D. Questions

Ask only material questions not answerable from the repository. Include your recommended default and consequences for each.

### E. Implementation recommendation

Recommend the smallest safe design. Avoid introducing new infrastructure when existing queues, storage abstractions, provider layers or settings systems can be extended.
