import { describe, expect, it } from 'vitest';

import { buildCoinEconomyQuote } from './coin-economy.shared';
import type { DbPricingActionCost } from '@/lib/types/database';

function meter(
  actionKey: DbPricingActionCost['action_key'],
  beatCost: number,
  overrides: Partial<DbPricingActionCost> = {}
): DbPricingActionCost {
  return {
    id: `meter-${actionKey}`,
    action_key: actionKey,
    display_name: String(actionKey),
    beat_cost: beatCost,
    is_active: true,
    cost_family: 'other',
    billing_unit: 'operation',
    free_enabled: true,
    plus_enabled: true,
    studio_enabled: true,
    metadata_json: {},
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_to: null,
    updated_at: '2026-01-01T00:00:00.000Z',
    updated_by: null,
    ...overrides,
  };
}

describe('coin economy quote', () => {
  it('blocks Free image generation independently of wallet price', () => {
    const quote = buildCoinEconomyQuote({
      operationKey: 'regenerate_image',
      planKey: 'free',
      components: [{
        meterKey: 'image_generation',
        unitBeatCostOverride: 0.5,
      }],
      catalog: [
        meter('image_generation', 0, {
          cost_family: 'image',
          billing_unit: 'image',
          free_enabled: false,
        }),
      ],
    });

    expect(quote.allowed).toBe(false);
    expect(quote.deniedReason).toBe('tier_locked');
    expect(quote.deniedMeterKey).toBe('image_generation');
  });

  it('quotes a composite text and image operation as line items and a total', () => {
    const quote = buildCoinEconomyQuote({
      operationKey: 'start_story_initial_beat',
      planKey: 'plus',
      components: [
        { meterKey: 'start_story_initial_beat_prompt_only' },
        {
          meterKey: 'image_generation',
          quantity: 2,
          unitBeatCostOverride: 0.5,
        },
      ],
      catalog: [
        meter('start_story_initial_beat_prompt_only', 0.5, {
          cost_family: 'text',
        }),
        meter('image_generation', 0, {
          cost_family: 'image',
          billing_unit: 'image',
          free_enabled: false,
        }),
      ],
    });

    expect(quote.allowed).toBe(true);
    expect(quote.components).toHaveLength(2);
    expect(quote.components[0].totalCoinCost).toBe(5);
    expect(quote.components[1].totalCoinCost).toBe(10);
    expect(quote.totalBeatCost).toBe(1.5);
    expect(quote.totalCoinCost).toBe(15);
  });

  it('charges TTS for Free when the tier capability is enabled', () => {
    const quote = buildCoinEconomyQuote({
      operationKey: 'generate_story_narration',
      planKey: 'free',
      components: [{ meterKey: 'generate_story_narration' }],
      catalog: [
        meter('generate_story_narration', 1, {
          cost_family: 'tts',
          billing_unit: 'narration',
        }),
      ],
    });

    expect(quote.allowed).toBe(true);
    expect(quote.totalCoinCost).toBe(10);
  });

  it('allows SD export for Free but reserves HD for paid tiers', () => {
    const catalog = [
      meter('export_video_sd', 2, {
        cost_family: 'export',
        billing_unit: 'export',
      }),
      meter('export_video_hd', 3, {
        cost_family: 'export',
        billing_unit: 'export',
        free_enabled: false,
      }),
    ];

    const sd = buildCoinEconomyQuote({
      operationKey: 'export_video_sd',
      planKey: 'free',
      components: [{ meterKey: 'export_video_sd' }],
      catalog,
    });
    const freeHd = buildCoinEconomyQuote({
      operationKey: 'export_video_hd',
      planKey: 'free',
      components: [{ meterKey: 'export_video_hd' }],
      catalog,
    });
    const plusHd = buildCoinEconomyQuote({
      operationKey: 'export_video_hd',
      planKey: 'plus',
      components: [{ meterKey: 'export_video_hd' }],
      catalog,
    });

    expect(sd.allowed).toBe(true);
    expect(sd.totalCoinCost).toBe(20);
    expect(freeHd.deniedReason).toBe('tier_locked');
    expect(plusHd.allowed).toBe(true);
    expect(plusHd.totalCoinCost).toBe(30);
  });

  it('fails closed when an administrator disables a meter globally', () => {
    const quote = buildCoinEconomyQuote({
      operationKey: 'align_story_text_overlay',
      planKey: 'studio',
      components: [{ meterKey: 'align_story_text_overlay' }],
      catalog: [
        meter('align_story_text_overlay', 0.5, {
          is_active: false,
          cost_family: 'alignment',
        }),
      ],
    });

    expect(quote.allowed).toBe(false);
    expect(quote.deniedReason).toBe('feature_disabled');
  });
});
