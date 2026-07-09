# Phase 1 — Safe Baseline and Gemini Adapter

## Goal
Create the foundation for multi-model support without changing current user behavior.

## Do before coding
- Create or confirm a working branch.
- Run current build/tests.
- Document baseline behavior.
- Identify one or more test stories/reels to use for regression.
- Confirm how to roll back.

## Implementation
1. Create image provider abstraction.
2. Wrap existing Gemini logic in a `GeminiImageProvider` or equivalent.
3. Ensure old calls route through the new abstraction but behave exactly as before.
4. Normalize provider response shape internally.
5. Preserve current prompt format unless refactoring is clearly safe.
6. Add provider/model metadata to generation logs where possible.
7. Do not expose new user/admin UI yet unless needed for internal testing.

## Suggested provider response shape
Adapt to the codebase, but consider fields like:
- provider
- model
- status
- image asset references
- raw provider response reference/log id
- duration
- error code/message if failed
- cost estimate fields if available

## Acceptance criteria
- Existing Gemini story/reel image generation still works.
- No user-visible behavior changed.
- Logs/metadata can identify the provider as Gemini.
- Code now has a clear extension point for future providers.
- Commit created after successful verification.

## Commit example
`refactor(image): wrap Gemini generation behind provider adapter`

