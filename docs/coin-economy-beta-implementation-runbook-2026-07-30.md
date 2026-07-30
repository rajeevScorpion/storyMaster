# Kissago Coin Economy Beta Implementation Runbook

Date: 2026-07-30

This runbook describes the implemented beta foundation. It complements `pricing-coin-economy-release-audit-2026-07-30.md`.

## Confirmed beta policy

| Event | Free | Plus | Studio | Charging |
|---|---|---|---|---|
| Text generation | Allowed | Allowed | Allowed | Metered |
| AI image generation | Off by default | Allowed | Allowed | Per successful image |
| External image upload | Allowed | Allowed | Allowed | No generation charge |
| Story/reel TTS | Allowed | Allowed | Allowed | Always metered |
| Provider-backed narration preview | Allowed | Allowed | Allowed | Always metered |
| Text/audio forced alignment | Allowed | Allowed | Allowed | Always metered when provider succeeds |
| True STT transcription | Off for beta | Off for beta | Off for beta | Separate future meter |
| SD browser export | Allowed | Allowed | Allowed | Always metered |
| HD browser export | Locked | Allowed | Allowed | Always metered |
| Paid checkout market | India only | India only | India only | Razorpay |

Holding or purchasing coins never unlocks a disabled plan capability.

## Implemented architecture

`CoinEconomyService` is implemented in:

- `lib/pricing/coin-economy.ts`
- `lib/pricing/coin-economy.shared.ts`

All integrated wallet authorization entry points now converge on this service. It:

1. resolves the authenticated plan
2. checks the global and per-tier meter entitlement
3. builds authoritative component line items
4. calculates the collective coin total
5. delegates the atomic hold to the existing wallet reservation RPC
6. records hard-mode reservation components
7. relies on the existing finalize/release path for settlement

The existing AI providers remain independent. The service centralizes entitlement and consumption; it does not force all AI work through one vendor.

## Database migration

Apply:

```text
supabase/migrations/082_coin_economy_gateway.sql
```

The migration:

- adds display, cost-family, billing-unit, and Free/Plus/Studio switches to `pricing_action_costs`
- seeds explicit image, TTS, alignment, STT, SD-export, and HD-export meters
- creates `beat_spend_reservation_components`
- creates `beat_usage_event_components`
- materializes finalized component usage through a database trigger
- seeds the India-only beta runtime flag

Rollback:

```text
supabase/migrations/082_coin_economy_gateway_rollback.sql
```

Do not enable hard enforcement before migration 082 is present. In hard mode, component-accounting failure deliberately releases the wallet hold and blocks provider execution.

## Seeded beta rates

These are safe starting values, not irrevocable product decisions:

| Meter | Initial rate |
|---|---:|
| Story TTS | 10 coins / narration |
| Reel TTS | 10 coins / narration |
| Provider-backed narration preview | 5 coins / preview |
| Text/audio alignment | 5 coins / alignment |
| SD video export | 20 coins / export |
| HD video export | 30 coins / export |
| Image generation | Selected image-model rate |

Image-model rates are editable in the same Pricing “Metering and Entitlements” workspace. Existing text, reference, cover, and image-model values are preserved.

## Admin workflow

Open Admin → Pricing → Action Costs. The section is now named “Metering and Entitlements.”

For each event the administrator can manage:

- user-facing coin price
- global active/inactive state
- Free entitlement
- Plus entitlement
- Studio entitlement
- image model coin overrides

For the first beta candidate verify:

- `image_generation`: Free off; Plus and Studio on
- `generate_story_narration`: all tiers on
- `generate_reel_narration`: all tiers on
- `generate_narration_preview`: all tiers on
- `align_story_text_overlay`: all tiers on
- `transcribe_audio_stt`: all tiers off
- `export_video_sd`: all tiers on
- `export_video_hd`: Free off; Plus and Studio on
- `pricing_india_only_beta_enabled`: on

Changes invalidate the local pricing caches immediately. Other running application instances remain bounded by the normal deployment/runtime cache behavior.

## User-facing behavior

- A Free account is forced into prompt-only/BYO-image mode when image generation is off.
- The AI image switch is visibly disabled for Free.
- Integrated high-level server authorization independently rejects Free image generation, including regeneration, covers, reference adoption visualization, batch, and stateful flows.
- TTS authorizes coins before the provider call and finalizes only after a usable result.
- Failed TTS releases the reservation.
- Alignment authorizes separately from TTS and charges only when forced alignment succeeds.
- Failed alignment releases its reservation and returns the existing non-highlight fallback.
- Export no longer depends on `pricing_snapshot_enabled`.
- Export presets show their own coin prices.
- Free can select SD; HD is locked.
- Export authorization rechecks the preset and plan on the server before browser rendering starts.
- Successful export finalizes the reservation; cancellation/failure releases it.
- The wallet hides the outside-India market selector while India-only beta is enabled.
- Checkout also rejects non-India purchases server-side.

## Provider-boundary prerequisite

The normal UI and high-level server workflows now authorize through the gateway. However, the legacy browser-orchestrated generation path still imports individually addressable Gemini server actions from `app/actions/gemini-proxy.ts` and `app/actions/image-generation.ts`.

Before inviting untrusted beta testers, do one of the following:

1. force all user generation through the bundled server pipeline and verify that the legacy path cannot be selected; or
2. require a one-time, reservation-bound provider-call claim in every low-level text and image action.

The second option is the durable design. The claim must be atomically consumed, bound to the authenticated user, meter/action, reservation, and permitted call count, and reject replay. A reservation ID by itself is not sufficient because it can be reused.

Until one of these controls is in place, normal clients are correctly gated but the provider boundary is not yet safe against a deliberately modified client.

## Staged activation

1. Apply migration 082 to staging.
2. Confirm meter rows and component tables.
3. Close the provider-boundary prerequisite above.
4. Freeze the editable rates and monthly plan allowances.
5. Turn pricing snapshot on in staging.
6. Turn shadow metering on; leave hard enforcement off.
7. Exercise every event and review shadow reservation metadata, including component totals.
8. Seed tester balances.
9. Turn hard enforcement on in staging.
10. Run the tier, zero-balance, exact-balance, failure, retry, cancellation, and tampered-client matrix.
11. Decide whether closed beta uses grants only or live Razorpay checkout.
12. Promote the same migration and configuration to production.
13. Enable production flags in the same order.

## Required staging checks

At minimum verify:

- Free story generation is prompt-only and does not call an image provider.
- Turning Free image generation on in admin makes the AI choice available after pricing refresh.
- Turning it off blocks an already-open normal client at high-level server authorization.
- Direct invocation of every low-level provider action without a valid one-time claim is rejected.
- Free TTS debits the configured amount.
- TTS provider failure leaves no finalized debit.
- Alignment success creates its own usage component.
- Alignment fallback does not finalize a debit.
- Free SD export displays and debits the SD rate.
- Free HD export is server-denied.
- Plus/Studio SD and HD export debit the selected preset rate.
- cancelled export releases the reservation.
- ROW checkout is rejected while India-only beta is enabled.
- usage-event component totals equal their parent usage-event total.

Validation query:

```sql
SELECT
  usage.id,
  usage.action_key,
  usage.beat_cost AS parent_beats,
  COALESCE(SUM(component.beat_cost), 0) AS component_beats
FROM public.beat_usage_events usage
LEFT JOIN public.beat_usage_event_components component
  ON component.usage_event_id = usage.id
GROUP BY usage.id, usage.action_key, usage.beat_cost
ORDER BY usage.created_at DESC;
```

For events created through the new gateway, `parent_beats` and `component_beats` must match.

## Validation completed locally

- TypeScript: passed
- Production build: passed
- Vitest: 63 files, 371 tests passed
- Focused coin-economy tests cover Free image blocking, composite text/image totals, charged Free TTS, SD/HD tier behavior, and global meter shutdown

No staging or production migration, configuration, wallet, or billing data was changed during implementation.
