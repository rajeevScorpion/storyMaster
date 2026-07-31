import 'server-only';

import {
  authorizeBillableAction,
  getPricingPolicyContextForUser,
  releaseBillableAction,
} from '@/lib/pricing/enforcement';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildCoinEconomyQuote,
  type CoinEconomyComponentInput,
  type CoinEconomyQuote,
} from '@/lib/pricing/coin-economy.shared';
import {
  COINS_PER_BEAT,
  type PlanKey,
  type PricingActionKey,
  type PricingBillableActionAuthorization,
} from '@/lib/types/pricing';
import { getEffectiveUserModeration } from '@/lib/admin/user-moderation';

export interface AuthorizeCoinOperationInput {
  userId: string | null;
  operationKey: PricingActionKey;
  idempotencyKey: string;
  components: CoinEconomyComponentInput[];
  relatedStoryId?: string | null;
  relatedNodeId?: string | null;
  relatedStorylineId?: string | null;
  metadata?: Record<string, unknown>;
}

function beatsToCoins(value: number): number {
  return Number((value * COINS_PER_BEAT).toFixed(2));
}

export async function quoteCoinOperationForUser(input: {
  userId: string | null;
  operationKey: PricingActionKey;
  components: CoinEconomyComponentInput[];
  assumedPlanKey?: PlanKey;
}): Promise<CoinEconomyQuote> {
  const context = await getPricingPolicyContextForUser(input.userId);
  return buildCoinEconomyQuote({
    operationKey: input.operationKey,
    planKey: input.assumedPlanKey ?? context.planKey,
    components: input.components,
    catalog: context.actionCosts,
  });
}

export async function quoteCoinOperationsForUser(input: {
  userId: string | null;
  operations: Array<{
    operationKey: PricingActionKey;
    components: CoinEconomyComponentInput[];
    assumedPlanKey?: PlanKey;
  }>;
}): Promise<CoinEconomyQuote[]> {
  const context = await getPricingPolicyContextForUser(input.userId);
  return input.operations.map((operation) => buildCoinEconomyQuote({
    operationKey: operation.operationKey,
    planKey: operation.assumedPlanKey ?? context.planKey,
    components: operation.components,
    catalog: context.actionCosts,
  }));
}

export async function authorizeCoinOperationForUser(
  input: AuthorizeCoinOperationInput
): Promise<PricingBillableActionAuthorization> {
  const context = await getPricingPolicyContextForUser(input.userId);
  const quote = buildCoinEconomyQuote({
    operationKey: input.operationKey,
    planKey: context.planKey,
    components: input.components,
    catalog: context.actionCosts,
  });

  if (!input.userId) {
    return {
      status: 'denied',
      reason: 'sign_in_required',
      beatCost: quote.totalBeatCost,
      coinCost: quote.totalCoinCost,
      availableBeats: 0,
      availableCoins: 0,
    };
  }

  const moderation = await getEffectiveUserModeration(input.userId);
  if (moderation.status === 'blocked' || moderation.status === 'suspended') {
    return {
      status: 'denied',
      reason: 'account_restricted',
      beatCost: quote.totalBeatCost,
      coinCost: quote.totalCoinCost,
      availableBeats: context.availableBeats,
      availableCoins: beatsToCoins(context.availableBeats),
    };
  }

  if (!quote.allowed) {
    return {
      status: 'denied',
      reason: quote.deniedReason ?? 'pricing_unavailable',
      beatCost: quote.totalBeatCost,
      coinCost: quote.totalCoinCost,
      availableBeats: context.availableBeats,
      availableCoins: beatsToCoins(context.availableBeats),
    };
  }

  const authorization = await authorizeBillableAction({
    userId: input.userId,
    actionKey: input.operationKey,
    idempotencyKey: input.idempotencyKey,
    relatedStoryId: input.relatedStoryId ?? null,
    relatedNodeId: input.relatedNodeId ?? null,
    relatedStorylineId: input.relatedStorylineId ?? null,
    requestedBeatCostOverride: quote.totalBeatCost,
    metadata: {
      ...(input.metadata ?? {}),
      coinEconomyVersion: 1,
      planKey: quote.planKey,
      componentTotalBeatCost: quote.totalBeatCost,
      componentTotalCoinCost: quote.totalCoinCost,
      components: quote.components,
    },
  });

  if (
    authorization.status === 'allowed'
    && authorization.mode === 'hard'
    && authorization.reservationId
  ) {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('beat_spend_reservation_components')
      .upsert(
        quote.components.map((component) => ({
          reservation_id: authorization.reservationId,
          component_key: component.meterKey,
          cost_family: component.costFamily,
          billing_unit: component.billingUnit,
          quantity: component.quantity,
          unit_beat_cost: component.unitBeatCost,
          quoted_beat_cost: component.totalBeatCost,
          status: 'quoted',
          metadata_json: component.metadata,
        })),
        { onConflict: 'reservation_id,component_key' }
      );

    if (error) {
      await releaseBillableAction({
        userId: input.userId!,
        reservationId: authorization.reservationId,
        reason: 'component_accounting_failed',
        releaseStatus: 'failed',
        metadata: { message: error.message },
      }).catch(() => undefined);
      throw new Error(`Failed to record coin-operation components: ${error.message}`);
    }
  }

  return authorization;
}
