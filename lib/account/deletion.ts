import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { cancelRazorpaySubscription } from '@/lib/billing/razorpay';
import { DELETED_TABLES, OWNERLESS_TABLES, ANONYMISED_TABLES } from '@/lib/account/deletion-tables';

type AdminClient = ReturnType<typeof createAdminClient>;

const ACTIVE_IMAGE_BATCH_STATUSES = ['pending', 'submitted', 'running'];
const ACTIVE_NARRATION_BATCH_STATUSES = ['pending', 'running'];
const ACTIVE_IMAGE_JOB_STATUSES = ['pending', 'processing'];
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(['cancelled', 'completed', 'expired']);

export type AccountDeletionOutcome =
  | {
      ok: true;
      alreadyDeleted: boolean;
      eventId: string | null;
      removedSummary: Record<string, number>;
      retainedSummary: Record<string, number>;
    }
  | { ok: false; reason: string };

/**
 * Payments Phase 2, Unit C (docs/payments/phase-2-plan.md §2 decision 12): the
 * ordered, re-runnable account deletion sequence. Callers (app/actions/account.ts)
 * are responsible for authenticating and re-authenticating the caller first --
 * this function trusts `userId` completely and does the irreversible part.
 *
 * Order matters and is fixed: cancel any live subscription before anything else
 * is touched (fail closed -- never delete while money is live), stop pending
 * background jobs, delete the private-activity group, anonymise the kept
 * groups, delete the profile, delete the auth user last.
 *
 * Re-running after a partial failure is safe by construction: every step below
 * is a delete-if-present or null-if-matching operation, so replaying the whole
 * sequence against a partially-processed account just finds fewer rows at each
 * step. Each attempt gets its own audit row rather than reusing a prior one, so
 * "every step recorded" means every *attempt*, not a single mutable ledger row.
 */
export async function deleteAccount(input: {
  userId: string;
  actor: 'user' | 'admin';
  reason?: string | null;
}): Promise<AccountDeletionOutcome> {
  const admin = createAdminClient();
  const userId = input.userId;

  const { data: existingUser } = await admin.auth.admin.getUserById(userId);
  if (!existingUser?.user) {
    // Already gone -- a retry after a fully-succeeded prior run, or a second
    // click. Report success rather than trying (and failing) to delete again.
    const latest = await latestDeletionEvent(admin, userId);
    return {
      ok: true,
      alreadyDeleted: true,
      eventId: latest?.id ?? null,
      removedSummary: {},
      retainedSummary: {},
    };
  }

  const event = await insertDeletionEvent(admin, userId, input.actor);
  const removedSummary: Record<string, number> = {};
  const retainedSummary: Record<string, number> = {};

  try {
    await cancelLiveSubscription(admin, userId);
    await neutralisePendingJobs(admin, userId, removedSummary);

    for (const rule of DELETED_TABLES) {
      removedSummary[rule.table] = await deleteRows(admin, rule.table, rule.matchColumn, userId);
    }

    for (const rule of OWNERLESS_TABLES) {
      retainedSummary[rule.table] = await nullColumn(admin, rule.table, rule.userColumn, userId);
    }

    for (const rule of ANONYMISED_TABLES) {
      let touched = 0;
      for (const column of rule.userColumns) {
        const extra = rule.userColumns.length === 1 ? personalColumnPatch(rule.personalColumns) : undefined;
        touched += await nullColumn(admin, rule.table, column, userId, extra);
      }
      retainedSummary[rule.table] = touched;
    }

    removedSummary.profiles = await deleteRows(admin, 'profiles', 'id', userId);

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
    if (deleteUserError && !isUserNotFoundError(deleteUserError)) {
      throw new Error(`Failed to delete the auth account: ${deleteUserError.message}`);
    }

    await completeDeletionEvent(admin, event.id, removedSummary, retainedSummary);
    return { ok: true, alreadyDeleted: false, eventId: event.id, removedSummary, retainedSummary };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error during account deletion';
    await failDeletionEvent(admin, event.id, reason);
    return { ok: false, reason };
  }
}

/**
 * Cancel any live Razorpay subscription immediately, before anything else is
 * touched. Throws on failure -- deleteAccount()'s catch marks the audit row
 * 'failed' and stops there, leaving the account otherwise untouched. Never
 * delete the account while money is still live.
 */
async function cancelLiveSubscription(admin: AdminClient, userId: string): Promise<void> {
  const { data, error } = await admin
    .from('billing_subscriptions')
    .select('id, provider, provider_subscription_id, status')
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Could not check for a live subscription: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    provider: string;
    provider_subscription_id: string | null;
    status: string;
  }>;
  const liveRows = rows.filter((row) => !TERMINAL_SUBSCRIPTION_STATUSES.has(row.status));

  for (const row of liveRows) {
    if (row.provider !== 'razorpay' || !row.provider_subscription_id) continue;

    await cancelRazorpaySubscription({ subscriptionId: row.provider_subscription_id, atCycleEnd: false });

    const { error: updateError } = await admin
      .from('billing_subscriptions')
      .update({ status: 'cancelled', cancel_at_period_end: false, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (updateError) {
      // The subscription is already cancelled at Razorpay -- the safety property
      // this step exists for is satisfied. A stale local status row is a
      // cosmetic gap the reconcile cron or a future webhook will fix.
      console.error('[deleteAccount] subscription cancelled at Razorpay but local row update failed:', updateError.message);
    }
  }
}

/**
 * Mark any still-active background job 'cancelled' before the "deleted" group
 * step removes the row outright, so a worker mid-flight (batch image/narration
 * generation, single-image generation) sees a stop signal rather than its row
 * disappearing out from under it mid-poll.
 */
async function neutralisePendingJobs(
  admin: AdminClient,
  userId: string,
  removedSummary: Record<string, number>
): Promise<void> {
  const jobs: Array<{ table: string; statuses: string[] }> = [
    { table: 'image_batch_jobs', statuses: ACTIVE_IMAGE_BATCH_STATUSES },
    { table: 'narration_batch_jobs', statuses: ACTIVE_NARRATION_BATCH_STATUSES },
    { table: 'image_generation_jobs', statuses: ACTIVE_IMAGE_JOB_STATUSES },
  ];

  for (const job of jobs) {
    const { data, error } = await admin
      .from(job.table)
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('status', job.statuses)
      .select('id');
    if (error) {
      throw new Error(`Could not stop pending ${job.table}: ${error.message}`);
    }
    removedSummary[`${job.table}_stopped`] = data?.length ?? 0;
  }
}

async function deleteRows(admin: AdminClient, table: string, matchColumn: string, userId: string): Promise<number> {
  const { data, error } = await admin.from(table).delete().eq(matchColumn, userId).select(matchColumn);
  if (error) {
    throw new Error(`Could not remove ${table}: ${error.message}`);
  }
  return data?.length ?? 0;
}

async function nullColumn(
  admin: AdminClient,
  table: string,
  column: string,
  userId: string,
  extra?: Record<string, null>
): Promise<number> {
  const patch: Record<string, null> = { [column]: null, ...(extra ?? {}) };
  const { data, error } = await admin.from(table).update(patch).eq(column, userId).select(column);
  if (error) {
    throw new Error(`Could not anonymise ${table}.${column}: ${error.message}`);
  }
  return data?.length ?? 0;
}

function personalColumnPatch(columns?: string[]): Record<string, null> | undefined {
  if (!columns || columns.length === 0) return undefined;
  const patch: Record<string, null> = {};
  for (const column of columns) patch[column] = null;
  return patch;
}

async function insertDeletionEvent(
  admin: AdminClient,
  userId: string,
  actor: 'user' | 'admin'
): Promise<{ id: string }> {
  const { data, error } = await admin
    .from('account_deletion_events')
    .insert({ subject_ref: userId, actor, status: 'started' })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`Could not open a deletion audit record: ${error?.message ?? 'unknown error'}`);
  }
  return data as { id: string };
}

async function completeDeletionEvent(
  admin: AdminClient,
  eventId: string,
  removedSummary: Record<string, number>,
  retainedSummary: Record<string, number>
): Promise<void> {
  const { error } = await admin
    .from('account_deletion_events')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      removed_summary_json: removedSummary,
      retained_summary_json: retainedSummary,
    })
    .eq('id', eventId);
  if (error) {
    console.error('[deleteAccount] account was deleted but the audit row could not be marked completed:', error.message);
  }
}

async function failDeletionEvent(admin: AdminClient, eventId: string, reason: string): Promise<void> {
  const { error } = await admin
    .from('account_deletion_events')
    .update({ status: 'failed', failure_reason: reason.slice(0, 2000) })
    .eq('id', eventId);
  if (error) {
    console.error('[deleteAccount] failed to record the failure reason on the audit row:', error.message);
  }
}

async function latestDeletionEvent(admin: AdminClient, userId: string): Promise<{ id: string; status: string } | null> {
  const { data } = await admin
    .from('account_deletion_events')
    .select('id, status')
    .eq('subject_ref', userId)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string; status: string } | null) ?? null;
}

function isUserNotFoundError(error: { message?: string; status?: number } | null): boolean {
  if (!error) return false;
  const message = (error.message ?? '').toLowerCase();
  return message.includes('user not found') || error.status === 404;
}
