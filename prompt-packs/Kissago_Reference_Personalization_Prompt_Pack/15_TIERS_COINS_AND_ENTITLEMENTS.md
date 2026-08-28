# Tiers, Coins and Entitlements

## Default seed values

- Platform maximum:
  - 3 character references per story
  - 3 world references per story
- Free:
  - 2 character references per story
  - 1 world reference per story

Paid-tier values must be seeded through settings/configuration and remain editable by admin.

## Entitlement dimensions

Per tier, support:

- Feature visible/enabled
- Character references at story creation
- World references at story creation
- Character count
- World count
- Custom-option attachments
- Saved reference library reuse
- Character adoption included count
- World description extraction included count
- World visualization included count
- Regeneration permission
- Reference retention
- Maximum upload size
- Description-only fallback
- Provider/model restrictions

## Coin dimensions

Keep upload and generation concepts separate.

Possible chargeable operations, driven by existing coin architecture:

- Character identity analysis
- Character canonical adoption generation
- World DNA analysis
- World canonical visualization
- Adoption regeneration
- Higher-cost provider surcharge

Do not invent a second wallet.

## Required transaction behaviour

1. Calculate cost before commitment where possible.
2. Resolve tier inclusions.
3. Reserve coins.
4. Attach transaction to idempotent job.
5. Finalize once.
6. Release/refund on permanent failure according to current ledger rules.
7. Retry without a second debit.
8. Display a user-safe cost breakdown.

## Race conditions

Recheck server-side when:

- story begins
- adoption job is created
- custom option submits

Handle:

- tier downgrade while setup is open
- admin limit changed
- coin balance changed
- duplicated browser request
- same upload reused
- job resumed after deployment

## Existing stories after downgrade

Do not remove generated references or make stories unreadable.

A downgrade may prevent:

- adding new references
- regenerating references
- using premium quality
- extending retention

Apply current entitlement policy consistently and do not destroy assets prematurely.
