# Test Plan, Edge Cases and Acceptance Criteria

## Unit tests

- Tier limit resolution
- Free defaults: 2 character, 1 world
- Platform ceiling: 3 and 3
- Optional naming and collision handling
- Stable character/world ID resolution
- Description compilation
- Relevant-reference selection
- Provider input prioritization
- Provider handle expiry fallback
- Idempotency
- Coin reserve/finalize/refund
- Settings validation
- Branch scoping

## Integration tests

- Story with no references follows unchanged flow
- One character adoption
- Two free character references
- Free third character rejected
- One free world accepted
- Free second world rejected
- Paid/configured limits
- Character plus world
- Stateful provider path
- Stateless provider path
- Provider handle expires
- Canonical resend fallback
- World description-only mode
- World visualization mode
- Browser closes during processing
- Worker retry
- Duplicate Start Story click
- Tier downgrade during setup
- Admin disables feature mid-job
- Published story does not expose source URL
- Existing story opens after feature disable
- Episodic continuation
- Custom-option branch-local introduction
- Backward edit invalidates downstream usage only

## Visual QA

Character:

- recognizable identity
- selected style
- no copied source background
- no extra person
- stable distinctive traits
- plot-appropriate clothing flexibility

World:

- preserved spatial landmarks
- selected style
- no unintended people as characters
- no UI/watermark
- correct recurring architecture/materials

## Security/privacy tests

- Cross-user source access denied
- Cross-story access denied
- Signed URL expiry
- Public story payload inspection
- Logs do not include signed URLs
- Deleted source cannot be fetched
- Provider callback ownership verification
- Upload MIME spoofing
- Oversized/decompression-bomb protection using existing platform safeguards

## Edge cases

- Same image uploaded twice
- Character and world use same source
- Collage
- Group photo
- Animal character
- Toy/object character
- Masked face
- Back view
- Low light
- Stylized source
- Source visual style conflicts with story style
- Multiple worlds in one beat
- More references than provider limit
- Name uses emoji/non-Latin characters
- User renames before adoption
- User removes source while job runs
- Model disabled
- Insufficient coins after cost recalculation
- Job succeeds but notification fails
- Story deleted during job
- Branch deleted during adoption
- Source retention expires
- Provider returns text/watermark
- Analysis succeeds, visualization fails

## Acceptance criteria

The feature is complete only when:

1. Admin can enable/disable it globally and by capability.
2. Free defaults resolve to 2 character and 1 world.
3. Tier limits are configurable.
4. User can upload, name/label, replace and remove references at story creation.
5. Character source becomes a story-style canonical reference.
6. World source becomes structured World DNA and optional canonical visualization.
7. Story style remains consistent.
8. Only relevant references are routed to each beat.
9. Stateful and stateless provider paths work.
10. Browser closure does not lose jobs.
11. Coin retries are idempotent.
12. Story Bible and episodic continuity are preserved.
13. Existing stories and no-reference flows are unaffected.
14. Raw source references remain private.
15. Feature can be rolled back without breaking completed stories.
16. Custom-option references, when enabled, remain branch-local and downstream-only.
