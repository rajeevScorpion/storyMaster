# Production Pricing Rollout Checklist

This checklist is for promoting the current `pricing` branch work into `kissago` production safely.

Status right now:

- The branch is pushed to `origin/pricing`.
- Do **not** push to `main` until explicit confirmation.
- The safest order is:
  1. migrate the `kissago` production database
  2. verify all pricing flags remain off by default
  3. merge/push code to `main`
  4. validate production behavior with pricing still dormant

## Scope of this rollout

This production rollout includes:

- pricing catalog tables and seed data
- billing and wallet tables
- pricing runtime snapshot and wallet UI
- Razorpay-first billing foundation
- pricing enforcement plumbing
- portrait reference modes and admin controls
- storyboard always-on cleanup so admin no longer advertises a dead off-switch
- gallery cover hardening for legacy/private storyline cover URLs

## Important safety note

The new pricing system is still designed to stay operationally dormant in production until flags are enabled.

That means:

- database migrations can be present
- code can be deployed
- production users should still remain unaffected as long as pricing rollout flags stay off

## Preflight

Before touching production:

1. Confirm the current branch tip:
   - use the intended release commit from `pricing`
   - do not rely on an older hardcoded hash in this checklist
2. Confirm the working tree is clean
3. Confirm production Vercel env values are ready:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_USER_ID`
   - any existing auth/story env vars already used by `kissago`
4. Do **not** point production at stage Supabase or stage Razorpay keys

## Production database migration order

Run these on the `kissago` production Supabase project, in order:

1. `015_pricing_catalog.sql`
2. `016_billing_core.sql`
3. `017_wallet_core.sql`
4. `018_pricing_runtime_flags.sql`
5. `019_pricing_seed_data.sql`
6. `020_rename_seeded_topup_pack_labels_to_coins.sql`
7. `021_pricing_enforcement_primitives.sql`
8. `022_fix_pricing_finalize_reservation_ambiguity.sql`

## Immediate post-migration checks

After the production migrations run:

1. Verify the new tables exist
2. Verify the seed data exists for pricing plans and top-up packs
3. Verify runtime pricing flags are still off / false
4. Verify no accidental paid India variants were published beyond what you intend

Recommended production-safe flag state right after migration:

- `pricing_snapshot_enabled = false`
- `pricing_checkout_enabled = false`
- `pricing_shadow_metering_enabled = false`
- `pricing_hard_enforcement_enabled = false`
- `pricing_story_length_ui_limits_enabled = false`
- `pricing_admin_bypass_enabled = false`

Character reference admin flags can also remain off initially if desired:

- `character_sheet_enabled_free_plus = false`
- `character_sheet_enabled_creator = false`

## Code rollout order

After production DB migration succeeds:

1. merge `pricing` into `main`
2. push `main`
3. allow production deploy to complete
4. verify the public site

## Production smoke test after deploy

Check these first:

1. landing page loads
2. gallery page loads
3. storyline page loads
4. public storyline cards show thumbnails where recoverable
5. user menu loads without pricing errors
6. admin pages still open correctly for the admin user

## Why the thumbnail issue should not persist

The recent gallery hardening does two things:

- it resolves legacy/private `story-assets` cover URLs into fresh signed URLs on the server
- it falls back to the legacy storyline beat image when `cover_image_url` is empty

So the missing-thumbnail behavior seen on stage should not carry into production after this code is deployed, even if some older rows are imperfect.

If production still has old rows with no recoverable image at all, cards will now show a graceful placeholder instead of a broken blank block.

## What should stay deferred after production deploy

Do not enable these in production during the first code rollout:

- Razorpay checkout
- hard payment enforcement
- shadow metering
- story-length pricing limits
- self-serve plan switching

The known deferred billing item is documented here:

- `docs/future-subscription-account-management.md`

## When ready for activation later

Use `kissagoStage` as the development/test environment and only promote to production after:

- checkout is re-verified
- subscription account management behavior is finalized
- wallet deductions are fully validated
- rollout flags are enabled intentionally in a staged sequence
