import { describe, it, expect } from 'vitest';
import { buildPlanFeatures, getPlanDescription, tierBelow } from './plan-copy.shared';
import type { PricingPlanOfferCard } from '@/lib/types/pricing';

function offer(overrides: Partial<PricingPlanOfferCard> & Pick<PricingPlanOfferCard, 'planKey'>): PricingPlanOfferCard {
  return {
    name: overrides.planKey.charAt(0).toUpperCase() + overrides.planKey.slice(1),
    description: null,
    tierRank: 1,
    currencyCode: 'INR',
    monthlyPlanVersionId: null,
    annualPlanVersionId: null,
    monthlyProvider: null,
    annualProvider: null,
    monthlyPriceMinor: null,
    annualPriceMinor: null,
    monthlyCoins: 0,
    storyLengthCap: 4,
    canAccessDownloads: false,
    canAccessUnbrandedExports: false,
    creatorControls: false,
    unlimitedWatching: true,
    videoExportPreset: {
      watermarkMode: 'auto',
      watermarkSize: 'small',
      watermarkPosition: 'top-left',
      verticalResolution: '720x1280',
    },
    isCurrentPlan: false,
    ...overrides,
  };
}

/** The catalogue Unit C creates: free 1, audience 2, plus 3, studio 4, with the quota live on Free. */
const FREE = offer({ planKey: 'free', tierRank: 1, unlimitedWatching: false });
const AUDIENCE = offer({ planKey: 'audience', tierRank: 2, unlimitedWatching: true });
const PLUS = offer({ planKey: 'plus', tierRank: 3, unlimitedWatching: true, storyLengthCap: 8 });
const STUDIO = offer({ planKey: 'studio', tierRank: 4, unlimitedWatching: true, storyLengthCap: 12, creatorControls: true });
const FOUR_TIERS = [FREE, AUDIENCE, PLUS, STUDIO];

describe('tierBelow', () => {
  it('finds the immediate neighbour, not the lowest tier', () => {
    expect(tierBelow(PLUS, FOUR_TIERS)?.planKey).toBe('audience');
    expect(tierBelow(STUDIO, FOUR_TIERS)?.planKey).toBe('plus');
  });

  it('returns null for the lowest tier on offer', () => {
    expect(tierBelow(FREE, FOUR_TIERS)).toBeNull();
  });

  it('skips a tier that is not on offer in this market', () => {
    // Audience unpublished: Plus inherits from Free again, with no code change.
    expect(tierBelow(PLUS, [FREE, PLUS, STUDIO])?.planKey).toBe('free');
  });

  it('does not reorder the caller’s array', () => {
    const offers = [...FOUR_TIERS];
    tierBelow(STUDIO, offers);
    expect(offers.map((o) => o.planKey)).toEqual(['free', 'audience', 'plus', 'studio']);
  });
});

describe('buildPlanFeatures', () => {
  it('names the real neighbour above Audience, not a hardcoded Free', () => {
    expect(buildPlanFeatures(PLUS, null, FOUR_TIERS)[0]).toBe('Everything in Audience');
  });

  it('falls back to naming Free when Audience is not published', () => {
    expect(buildPlanFeatures(PLUS, null, [FREE, PLUS, STUDIO])[0]).toBe('Everything in Free');
  });

  it('advertises unlimited watching on the tier that introduces it, and only there', () => {
    const audience = buildPlanFeatures(AUDIENCE, null, FOUR_TIERS);
    const plus = buildPlanFeatures(PLUS, null, FOUR_TIERS);
    const studio = buildPlanFeatures(STUDIO, null, FOUR_TIERS);

    expect(audience).toContain('Watch as many stories a day as you like');
    // Plus and Studio inherit it through "Everything in <tier>" -- repeating it would make the one
    // tier that actually introduces it look no different from the rest.
    expect(plus).not.toContain('Watch as many stories a day as you like');
    expect(studio).not.toContain('Watch as many stories a day as you like');
  });

  it('moves the line to Plus if an admin turns the capability off for Audience', () => {
    // Read off the capability, never off the rank: the copy has to follow the toggle.
    const quotedAudience = offer({ planKey: 'audience', tierRank: 2, unlimitedWatching: false });
    const offers = [FREE, quotedAudience, PLUS, STUDIO];

    expect(buildPlanFeatures(quotedAudience, null, offers)).not.toContain('Watch as many stories a day as you like');
    expect(buildPlanFeatures(PLUS, null, offers)).toContain('Watch as many stories a day as you like');
  });

  it('says nothing about watching anywhere when no plan is quota-limited', () => {
    // The state before Unit C's catalogue edit: the capability defaults true, so every tier has it
    // and no card should claim it as a differentiator.
    const openFree = offer({ planKey: 'free', tierRank: 1, unlimitedWatching: true });
    const offers = [openFree, AUDIENCE, PLUS, STUDIO];
    for (const plan of offers) {
      expect(buildPlanFeatures(plan, null, offers)).not.toContain('Watch as many stories a day as you like');
    }
  });

  it('keeps Audience free of creation claims (owner decision 12)', () => {
    const audience = buildPlanFeatures(AUDIENCE, null, FOUR_TIERS).join(' | ');
    expect(audience).not.toMatch(/creator|download|unbranded|character sheet/i);
  });

  it('still gives Studio its creator lines', () => {
    const studio = buildPlanFeatures(
      offer({ planKey: 'studio', tierRank: 4, canAccessDownloads: true, canAccessUnbrandedExports: true }),
      { freePlusCharacterSheetsEnabled: false, creatorCharacterSheetsEnabled: true },
      FOUR_TIERS
    );
    expect(studio).toContain('Downloads included');
    expect(studio).toContain('Unbranded exports included');
    expect(studio).toContain('Creator Settings with optional 1K character sheets');
  });

  it('does not hand an unknown tier Studio’s creator pitch', () => {
    // This is what the old trailing `return` did: anything that was not free or plus got Studio's
    // list, so a new tier would have advertised tools it may not have.
    const mystery = offer({ planKey: 'studio', tierRank: 5, name: 'Publisher' });
    const unknown = { ...mystery, planKey: 'publisher' as PricingPlanOfferCard['planKey'] };
    const features = buildPlanFeatures(unknown, null, [...FOUR_TIERS, unknown]);

    expect(features).not.toContain('Creator-focused tools for a higher-control workflow');
    expect(features[0]).toBe('Everything in Studio');
  });
});

describe('getPlanDescription', () => {
  it('pitches Audience on watching', () => {
    expect(getPlanDescription(AUDIENCE)).toMatch(/no daily limit/i);
  });

  it('does not promise unlimited watching when Audience does not grant it', () => {
    const quoted = offer({ planKey: 'audience', tierRank: 2, unlimitedWatching: false });
    expect(getPlanDescription(quoted)).not.toMatch(/no daily limit/i);
  });

  it('keeps the existing copy for the three tiers that already had it', () => {
    expect(getPlanDescription(FREE)).toBe('Start creating and sharing short stories right away.');
    expect(getPlanDescription(PLUS)).toBe('Keep family stories growing with more room to create.');
    expect(getPlanDescription(STUDIO)).toBe('Create with export-ready tools and richer control.');
  });

  it('gives an unknown tier the catalogue description rather than Studio’s', () => {
    const unknown = {
      ...offer({ planKey: 'studio', tierRank: 5 }),
      planKey: 'publisher' as PricingPlanOfferCard['planKey'],
      description: 'For publishing houses.',
    };
    expect(getPlanDescription(unknown)).toBe('For publishing houses.');
  });
});
