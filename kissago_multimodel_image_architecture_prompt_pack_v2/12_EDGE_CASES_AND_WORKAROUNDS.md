# Edge Cases and Practical Workarounds

## 1. Legacy stories have no selected model
Workaround: default to existing Gemini behavior and optionally backfill model metadata lazily.

## 2. Model disabled after a story is created
Workaround: allow existing story to continue with the saved model only if provider config remains valid, or show a controlled fallback prompt.

## 3. Admin disables all models for a tier
Workaround: validation should prevent saving a tier with no usable default, or user UI should show a clear “no model available” state.

## 4. Model price changes mid-generation
Workaround: snapshot estimated cost at request start and use that for the transaction. New price applies to new requests.

## 5. Provider succeeds but storage fails
Workaround: generation is not considered successful until asset is stored in Kissago storage. Do not finalize charge until storage succeeds.

## 6. Provider returns temporary image URLs
Workaround: immediately copy to Kissago storage. Treat failure to copy as generation failure.

## 7. API timeout but provider may still generate image
Workaround: use idempotent request tracking where possible. Do not duplicate charge on retry. Log ambiguous states for admin review.

## 8. User has enough coins at estimate but not at final generation
Workaround: reserve coins before generation or re-check immediately before generation.

## 9. Partial story generation
Workaround: charge only successful images if product allows partial output, or reserve total and refund failed beats. Make policy explicit.

## 10. Regeneration cost confusion
Workaround: always show regeneration cost before user confirms.

## 11. Changing model mid-story damages consistency
Workaround: lock model after generation starts, or require strong warning/confirmation.

## 12. Model supports different aspect ratios
Workaround: model registry should include capabilities. UI should only offer supported options.

## 13. Future reference uploads not implemented
Workaround: design provider interface and schema placeholders, but hide UI until upload flow is real.

## 14. Gemini code is too tightly coupled
Workaround: wrap first, refactor later. Do not destructively rewrite working code.

## 15. Coin system lacks refund support
Workaround: prefer charge-after-success if technically possible. If not, add compensation/refund transaction with audit logging.

## 16. Multiple default models configured
Workaround: enforce one default per tier/context or define clear priority order.

## 17. Provider-specific safety/content rejection
Workaround: normalize errors to user-safe messages while logging full technical details for admins.

## 18. Provider cost does not map neatly to coins
Workaround: admin-defined coin price should absorb provider pricing differences, margin, retries, and infrastructure overhead.

