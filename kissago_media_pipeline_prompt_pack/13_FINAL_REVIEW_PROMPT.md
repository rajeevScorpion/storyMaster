# 13 — Final Review Prompt

Use this after implementation.

Review the Kissago media pipeline implementation against the original product requirements.

## Check the requirements

Confirm with evidence from code:
- Users can start generation and close the browser.
- Generation job persists in DB before heavy work begins.
- Worker continues generation without active browser session.
- Original image is saved to Cloudflare R2 privately.
- Server creates compressed display variant.
- UI renders compressed version for normal viewing.
- HQ download/export uses original or high-quality derived asset only after entitlement check.
- Free users do not get HQ download.
- Plus users get admin-configurable HQ retention, default 10 days.
- Studio users get admin-configurable HQ retention, default 30 days.
- Users can set story private/public/unlisted.
- Public/unlisted stories do not expose private original assets.
- Higher-tier users get low/high quality toggle before share/publish.
- Admin can configure retention and publishing behavior.
- Cleanup job removes expired originals.
- Old working behavior is not broken.

## Check code quality

Look for:
- idempotent worker processing
- retry handling
- good error messages
- no long-lived signed URLs stored in DB
- no client-side compression dependency for generated images
- route-level authorization checks
- database indexes
- migration safety
- clear tests

## Output format

Create `MEDIA_PIPELINE_FINAL_REVIEW.md` with:

```md
# Final Review

## Requirements Met

## Requirements Partially Met

## Missing Items

## Risks

## Security Findings

## Performance Findings

## Recommended Follow-Up Commits
```


## Rollout safety review

Before final handoff, verify:
- The current legacy client-side flow is still available.
- Admin can switch new jobs between `client_legacy` and `server_pipeline`.
- Every new job/media record stores its effective processing mode.
- Existing stories render after switching modes.
- Server-generated stories render after switching back to legacy mode.
- No duplicate media records are created when switching modes.
- Rollback instructions are documented for admin/developer use.
