/**
 * Payments Phase 3, Unit C (docs/payments/phase-3-plan.md §6): the wallet's plan-card copy.
 *
 * Pure and isomorphic so it can be unit-tested without mounting WalletPage, which is what the
 * `.shared.ts` split is for (CLAUDE.md). It picks what a plan card SAYS; it grants nothing, and
 * every capability line is read off the offer's own flags rather than inferred from its tier rank
 * — the constraint phase-3-plan.md §4 puts on the rank scale.
 */

import type { PricingPlanOfferCard, PricingWalletPageData } from '@/lib/types/pricing';

export type PlanCopyWalletData = Pick<
  PricingWalletPageData,
  'freePlusCharacterSheetsEnabled' | 'creatorCharacterSheetsEnabled'
>;

/**
 * The tier immediately below `offer` among the plans actually on offer, or null for the lowest.
 *
 * Payments Phase 3, Unit C: "Everything in X" has to name the real neighbour. Plus used to say
 * "Everything in Free" as a literal, which Audience sitting between them makes wrong -- and
 * hardcoding "Everything in Audience" instead would be wrong again in a market where Audience is
 * not published. Reading it off the rendered offers is correct in both worlds, and in whatever
 * order a fifth tier eventually lands in.
 */
export function tierBelow(
  offer: PricingPlanOfferCard,
  offers: PricingPlanOfferCard[]
): PricingPlanOfferCard | null {
  return offers
    .filter((candidate) => candidate.tierRank < offer.tierRank)
    .sort((a, b) => b.tierRank - a.tierRank)[0] ?? null;
}

export function buildPlanFeatures(
  offer: PricingPlanOfferCard,
  walletData: PlanCopyWalletData | null,
  offers: PricingPlanOfferCard[]
): string[] {
  const below = tierBelow(offer, offers);
  const inherits = below ? [`Everything in ${below.name}`] : [];

  // Named only on the lowest tier that grants it, and only while some tier on offer does NOT --
  // unlimited watching is a feature exactly when something else is limited. Before Unit C sets the
  // capability false on Free every plan has it by default, and a card claiming it then would be
  // advertising the absence of a restriction nobody has met. Above the tier that introduces it,
  // the "Everything in X" line already carries it; repeating it on every paid card would make the
  // one tier the quota actually sells look no different from the rest.
  //
  // Read off the capability, never off the tier rank (phase-3-plan.md §4): an admin can move it,
  // and the copy has to follow the toggle rather than an assumption about who sits where.
  const someTierIsLimited = offers.some((candidate) => !candidate.unlimitedWatching);
  const introducesUnlimitedWatching =
    someTierIsLimited && offer.unlimitedWatching && !(below?.unlimitedWatching ?? false)
      ? ['Watch as many stories a day as you like']
      : [];

  if (offer.planKey === 'free') {
    return [
      'Ready the moment you create your account',
      `${offer.storyLengthCap} beats per story`,
      ...introducesUnlimitedWatching,
      'Hosted sharing with Kissago branding',
    ];
  }

  if (offer.planKey === 'audience') {
    // Owner decision 12: Audience adds nothing to creation -- same coins, same retention, same
    // gates as Free. Watching is the whole of it, so the copy must not imply more room to create.
    return [
      ...inherits,
      ...introducesUnlimitedWatching,
      `${offer.storyLengthCap} beats per story`,
    ];
  }

  if (offer.planKey === 'plus') {
    return [
      ...inherits,
      ...introducesUnlimitedWatching,
      `${offer.storyLengthCap} beats per story`,
      'Made for recurring family story creation',
      walletData?.freePlusCharacterSheetsEnabled
        ? 'Enhanced character consistency with compact character sheets'
        : 'More room for recurring stories and returning characters',
    ];
  }

  if (offer.planKey === 'studio') {
    return [
      ...inherits,
      ...introducesUnlimitedWatching,
      `${offer.storyLengthCap} beats per story`,
      offer.canAccessDownloads ? 'Downloads included' : 'Downloads ready as this plan expands',
      offer.canAccessUnbrandedExports ? 'Unbranded exports included' : 'Export-friendly creator workflow',
      walletData?.creatorCharacterSheetsEnabled
        ? 'Creator Settings with optional 1K character sheets'
        : 'Creator-focused tools for a higher-control workflow',
    ];
  }

  // A plan key this build predates. It used to fall into Studio's arm, so a new tier would have
  // advertised creator tools it may not have; say only what the offer itself carries.
  return [...inherits, ...introducesUnlimitedWatching, `${offer.storyLengthCap} beats per story`];
}

export function getPlanDescription(offer: PricingPlanOfferCard): string {
  if (offer.planKey === 'free') {
    return 'Start creating and sharing short stories right away.';
  }

  if (offer.planKey === 'audience') {
    return offer.unlimitedWatching
      ? 'Watch every story on Kissago, with no daily limit.'
      : 'Made for readers who watch more than they create.';
  }

  if (offer.planKey === 'plus') {
    return 'Keep family stories growing with more room to create.';
  }

  if (offer.planKey === 'studio') {
    return 'Create with export-ready tools and richer control.';
  }

  // Same reasoning as buildPlanFeatures' last arm: an unknown tier gets the catalogue's own
  // description rather than Studio's pitch.
  return offer.description ?? '';
}
