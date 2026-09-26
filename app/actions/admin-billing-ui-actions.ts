'use server';

/**
 * The admin user record's entry points into app/actions/admin-billing-actions.ts. Each one settles
 * the underlying action into { ok, result | error } rather than letting it throw: Next omits a
 * thrown server-action error's message in production builds, and the refusal reasons those actions
 * give (coins already spent, refund cap reached, kill switch off) are exactly what the admin needs
 * to read. Every check still happens inside the wrapped action -- nothing is re-implemented here.
 */

import {
  cancelBillingSubscriptionAtCycleEnd,
  refundBillingPayment,
  reprocessBillingWebhookEventById,
  resyncBillingSubscriptionFromProvider,
  resyncBillingTopupFromProvider,
} from '@/app/actions/admin-billing-actions';
import type { AdminBillingActionResult } from '@/lib/admin/billing-admin-ui.shared';

async function settle<T>(run: () => Promise<T>): Promise<AdminBillingActionResult<T>> {
  try {
    return { ok: true, result: await run() };
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.message ? error.message : 'This action failed.' };
  }
}

export async function refundBillingPaymentSettled(input: Parameters<typeof refundBillingPayment>[0]) {
  return settle(() => refundBillingPayment(input));
}

export async function cancelBillingSubscriptionAtCycleEndSettled(
  input: Parameters<typeof cancelBillingSubscriptionAtCycleEnd>[0]
) {
  return settle(() => cancelBillingSubscriptionAtCycleEnd(input));
}

export async function resyncBillingSubscriptionFromProviderSettled(
  input: Parameters<typeof resyncBillingSubscriptionFromProvider>[0]
) {
  return settle(() => resyncBillingSubscriptionFromProvider(input));
}

export async function resyncBillingTopupFromProviderSettled(input: Parameters<typeof resyncBillingTopupFromProvider>[0]) {
  return settle(() => resyncBillingTopupFromProvider(input));
}

export async function reprocessBillingWebhookEventByIdSettled(
  input: Parameters<typeof reprocessBillingWebhookEventById>[0]
) {
  return settle(() => reprocessBillingWebhookEventById(input));
}
