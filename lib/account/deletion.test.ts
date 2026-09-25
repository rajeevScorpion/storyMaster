// Payments Phase 2, Unit C: lib/account/deletion.ts drives the whole self-serve
// deletion sequence off the three lists in deletion-tables.ts. These tests prove:
//   1. the step order (subscription cancel -> pending jobs -> deleted group ->
//      owned/anonymised groups -> profiles -> auth.users -> audit row),
//   2. each of the three table groups behaves as decided,
//   3. a failed subscription cancel aborts before anything else is touched,
//   4. billing rows survive with user_id null and subject_ref intact,
//   5. a published story is still readable, still under its author name,
//   6. re-running after a part-way failure finishes the job.
//
// Supabase is a small in-memory fake, not a mock of every builder call: real
// row state (added/removed/nulled) is easier to get right and to read than a
// call-recorder across ~30 tables.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { adminState } = vi.hoisted(() => ({ adminState: { client: null as any } }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => adminState.client,
}));

const cancelRazorpaySubscriptionMock = vi.fn();
vi.mock('@/lib/billing/razorpay', () => ({
  cancelRazorpaySubscription: (...args: unknown[]) => cancelRazorpaySubscriptionMock(...args),
}));

import { deleteAccount } from '@/lib/account/deletion';

const USER_ID = 'user-to-delete';
const OTHER_USER_ID = 'someone-else';

/** A tiny in-memory Postgrest-alike. Tables are plain arrays of row objects. */
function createFakeAdmin(
  tables: Record<string, any[]>,
  options: {
    authUserExists?: boolean;
    onOperation?: (table: string, op: string) => void;
    callLog?: string[];
  } = {}
) {
  const callLog: string[] = options.callLog ?? [];
  let authUserExists = options.authUserExists ?? true;

  function ensureTable(table: string): any[] {
    return tables[table] ?? (tables[table] = []);
  }

  function builder(table: string, op: 'select' | 'delete' | 'update' | 'insert', payload: any) {
    const filters: Array<(row: any) => boolean> = [];
    let orderCol: string | null = null;
    let ascending = true;
    let limitN: number | null = null;

    const api: any = {
      eq(col: string, val: unknown) {
        filters.push((row) => row[col] === val);
        return api;
      },
      in(col: string, vals: unknown[]) {
        filters.push((row) => vals.includes(row[col]));
        return api;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col;
        ascending = opts?.ascending ?? true;
        return api;
      },
      limit(n: number) {
        limitN = n;
        return api;
      },
      select(_cols?: string) {
        return api;
      },
      single() {
        return execute(true);
      },
      maybeSingle() {
        return execute(true);
      },
      then(resolve: any, reject: any) {
        return execute(false).then(resolve, reject);
      },
    };

    async function execute(single: boolean) {
      options.onOperation?.(table, op);
      callLog.push(`${op}:${table}`);
      const rows = ensureTable(table);

      if (op === 'select') {
        let matched = rows.filter((row) => filters.every((f) => f(row)));
        if (orderCol) {
          const col = orderCol;
          matched = [...matched].sort((a, b) => {
            if (a[col] === b[col]) return 0;
            const cmp = a[col] < b[col] ? -1 : 1;
            return ascending ? cmp : -cmp;
          });
        }
        if (limitN != null) matched = matched.slice(0, limitN);
        return single ? { data: matched[0] ?? null, error: null } : { data: matched, error: null };
      }

      if (op === 'delete') {
        const matched = rows.filter((row) => filters.every((f) => f(row)));
        tables[table] = rows.filter((row) => !filters.every((f) => f(row)));
        return single ? { data: matched[0] ?? null, error: null } : { data: matched, error: null };
      }

      if (op === 'update') {
        const matched: any[] = [];
        tables[table] = rows.map((row) => {
          if (filters.every((f) => f(row))) {
            const next = { ...row, ...payload };
            matched.push(next);
            return next;
          }
          return row;
        });
        return single ? { data: matched[0] ?? null, error: null } : { data: matched, error: null };
      }

      // insert
      const row = { id: `generated-${rows.length}-${Math.random().toString(36).slice(2)}`, ...payload };
      rows.push(row);
      return single ? { data: row, error: null } : { data: [row], error: null };
    }

    return api;
  }

  const client = {
    from: (table: string) => ({
      select: (cols?: string) => builder(table, 'select', null),
      delete: () => builder(table, 'delete', null),
      update: (payload: any) => builder(table, 'update', payload),
      insert: (payload: any) => builder(table, 'insert', payload),
    }),
    auth: {
      admin: {
        getUserById: async (id: string) => {
          if (!authUserExists) return { data: { user: null }, error: null };
          return { data: { user: { id } }, error: null };
        },
        deleteUser: async (_id: string) => {
          authUserExists = false;
          return { error: null };
        },
      },
    },
  };

  return { client, tables, callLog };
}

beforeEach(() => {
  vi.clearAllMocks();
  cancelRazorpaySubscriptionMock.mockResolvedValue({});
});

describe('deleteAccount -- step order', () => {
  it('cancels the subscription, then stops jobs, then deletes, then anonymises, then removes the profile, then the auth user, then completes the audit row', async () => {
    const sharedLog: string[] = [];
    cancelRazorpaySubscriptionMock.mockImplementation(async () => {
      sharedLog.push('razorpay:cancel');
      return {};
    });

    const { client, tables } = createFakeAdmin(
      {
        billing_subscriptions: [{ id: 'sub-1', user_id: USER_ID, provider: 'razorpay', provider_subscription_id: 'rzp_sub_1', status: 'active' }],
        image_batch_jobs: [{ id: 'job-1', user_id: USER_ID, status: 'running' }],
        saved_storylines: [{ id: 'save-1', user_id: USER_ID, storyline_id: 'sl-1' }],
        stories: [{ id: 'story-1', user_id: USER_ID, title: 'A story' }],
        billing_orders: [{ id: 'order-1', user_id: USER_ID, subject_ref: USER_ID, amount_minor: 1000 }],
        profiles: [{ id: USER_ID, display_name: 'Someone' }],
      },
      { callLog: sharedLog }
    );
    adminState.client = client;

    const outcome = await deleteAccount({ userId: USER_ID, actor: 'user' });

    expect(outcome.ok).toBe(true);
    expect(cancelRazorpaySubscriptionMock).toHaveBeenCalledWith({ subscriptionId: 'rzp_sub_1', atCycleEnd: false });

    const razorpayIndex = sharedLog.indexOf('razorpay:cancel');
    const jobUpdateIndex = sharedLog.indexOf('update:image_batch_jobs');
    const deletedGroupIndex = sharedLog.indexOf('delete:saved_storylines');
    const ownerlessIndex = sharedLog.indexOf('update:stories');
    const anonymisedIndex = sharedLog.indexOf('update:billing_orders');
    const profileDeleteIndex = sharedLog.indexOf('delete:profiles');

    expect(razorpayIndex).toBeGreaterThan(-1);
    expect(jobUpdateIndex).toBeGreaterThan(razorpayIndex);
    expect(deletedGroupIndex).toBeGreaterThan(jobUpdateIndex);
    expect(ownerlessIndex).toBeGreaterThan(deletedGroupIndex);
    expect(anonymisedIndex).toBeGreaterThan(ownerlessIndex);
    expect(profileDeleteIndex).toBeGreaterThan(anonymisedIndex);

    // profiles gone, auth user gone, audit row completed.
    expect(tables.profiles).toHaveLength(0);
    const events = tables.account_deletion_events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('completed');
    expect(events[0].subject_ref).toBe(USER_ID);
  });
});

describe('deleteAccount -- the three groups', () => {
  it('deletes the private-activity group outright', async () => {
    const { client, tables } = createFakeAdmin({
      saved_storylines: [
        { id: 'save-1', user_id: USER_ID },
        { id: 'save-2', user_id: OTHER_USER_ID },
      ],
      viewer_profiles: [{ id: 'vp-1', account_id: USER_ID }],
      profiles: [{ id: USER_ID }],
    });
    adminState.client = client;

    const outcome = await deleteAccount({ userId: USER_ID, actor: 'user' });

    expect(outcome.ok).toBe(true);
    expect(tables.saved_storylines).toEqual([{ id: 'save-2', user_id: OTHER_USER_ID }]);
    expect(tables.viewer_profiles).toHaveLength(0);
    expect(tables.profiles).toHaveLength(0);
  });

  it('keeps kept-ownerless content, only nulling the owner column', async () => {
    const { client, tables } = createFakeAdmin({
      stories: [{ id: 'story-1', user_id: USER_ID, title: 'A story' }],
      storylines: [
        { id: 'sl-1', user_id: USER_ID, author_name: 'Alice', is_public: true, title: 'Published tale' },
      ],
      beats: [{ id: 'beat-1', generated_by: USER_ID, story_id: 'story-1' }],
    });
    adminState.client = client;

    await deleteAccount({ userId: USER_ID, actor: 'user' });

    expect(tables.stories).toEqual([{ id: 'story-1', user_id: null, title: 'A story' }]);
    expect(tables.beats).toEqual([{ id: 'beat-1', generated_by: null, story_id: 'story-1' }]);
    // The published storyline survives, still under its author name -- a
    // reader never sees this row's user_id.
    expect(tables.storylines).toEqual([
      { id: 'sl-1', user_id: null, author_name: 'Alice', is_public: true, title: 'Published tale' },
    ]);
  });

  it('anonymises kept records: user_id null, subject_ref untouched, GST fields kept on billing_profiles but contact details cleared', async () => {
    const { client, tables } = createFakeAdmin({
      billing_orders: [{ id: 'order-1', user_id: USER_ID, subject_ref: USER_ID, amount_minor: 5000 }],
      legal_acceptances: [{ id: 'la-1', user_id: USER_ID, subject_ref: USER_ID, document_key: 'terms' }],
      billing_profiles: [
        {
          id: 'bp-1',
          user_id: USER_ID,
          legal_name: 'Alice Example',
          gstin: '24AAAAA0000A1Z5',
          state_code: '24',
          billing_email: 'alice@example.com',
          phone: '+91-9999999999',
          city: 'Ahmedabad',
        },
      ],
    });
    adminState.client = client;

    await deleteAccount({ userId: USER_ID, actor: 'user' });

    expect(tables.billing_orders[0].user_id).toBeNull();
    expect(tables.billing_orders[0].subject_ref).toBe(USER_ID);
    expect(tables.legal_acceptances[0].user_id).toBeNull();
    expect(tables.legal_acceptances[0].subject_ref).toBe(USER_ID);

    const profile = tables.billing_profiles[0];
    expect(profile.user_id).toBeNull();
    expect(profile.legal_name).toBe('Alice Example');
    expect(profile.gstin).toBe('24AAAAA0000A1Z5');
    expect(profile.state_code).toBe('24');
    expect(profile.billing_email).toBeNull();
    expect(profile.phone).toBeNull();
    expect(profile.city).toBeNull();
  });

  it('nulls only the matching admin-attribution column, leaving another user\'s attribution alone', async () => {
    const { client, tables } = createFakeAdmin({
      reel_visual_styles: [{ id: 'style-1', created_by: USER_ID, updated_by: OTHER_USER_ID, name: 'Cinematic' }],
    });
    adminState.client = client;

    await deleteAccount({ userId: USER_ID, actor: 'user' });

    expect(tables.reel_visual_styles[0].created_by).toBeNull();
    expect(tables.reel_visual_styles[0].updated_by).toBe(OTHER_USER_ID);
  });
});

describe('deleteAccount -- fail closed on a live subscription', () => {
  it('aborts before touching anything else when the Razorpay cancel fails, and marks the audit row failed', async () => {
    cancelRazorpaySubscriptionMock.mockRejectedValueOnce(new Error('razorpay is down'));

    const { client, tables } = createFakeAdmin({
      billing_subscriptions: [{ id: 'sub-1', user_id: USER_ID, provider: 'razorpay', provider_subscription_id: 'rzp_sub_1', status: 'active' }],
      saved_storylines: [{ id: 'save-1', user_id: USER_ID }],
      stories: [{ id: 'story-1', user_id: USER_ID }],
      profiles: [{ id: USER_ID }],
    });
    adminState.client = client;

    const outcome = await deleteAccount({ userId: USER_ID, actor: 'user' });

    expect(outcome.ok).toBe(false);
    // Nothing past the subscription check was touched.
    expect(tables.saved_storylines).toHaveLength(1);
    expect(tables.stories[0].user_id).toBe(USER_ID);
    expect(tables.profiles).toHaveLength(1);

    const events = tables.account_deletion_events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('failed');
    expect(events[0].failure_reason).toContain('razorpay is down');
  });

  it('does not call Razorpay at all when there is no live subscription', async () => {
    const { client, tables } = createFakeAdmin({
      billing_subscriptions: [{ id: 'sub-1', user_id: USER_ID, provider: 'razorpay', provider_subscription_id: 'rzp_sub_1', status: 'cancelled' }],
      profiles: [{ id: USER_ID }],
    });
    adminState.client = client;

    const outcome = await deleteAccount({ userId: USER_ID, actor: 'user' });

    expect(outcome.ok).toBe(true);
    expect(cancelRazorpaySubscriptionMock).not.toHaveBeenCalled();
    expect(tables.profiles).toHaveLength(0);
  });
});

describe('deleteAccount -- re-runnable after a part-way failure', () => {
  it('finishes the job on retry after a transient error mid-sequence', async () => {
    let failOnceMore = true;
    const { client, tables } = createFakeAdmin(
      {
        saved_storylines: [{ id: 'save-1', user_id: USER_ID }],
        stories: [{ id: 'story-1', user_id: USER_ID }],
        billing_orders: [{ id: 'order-1', user_id: USER_ID, subject_ref: USER_ID }],
        profiles: [{ id: USER_ID }],
      },
      {
        onOperation: (table, op) => {
          if (table === 'billing_orders' && op === 'update' && failOnceMore) {
            failOnceMore = false;
            throw new Error('transient database error');
          }
        },
      }
    );
    adminState.client = client;

    const first = await deleteAccount({ userId: USER_ID, actor: 'user' });
    expect(first.ok).toBe(false);
    // Steps before the failure already landed.
    expect(tables.saved_storylines).toHaveLength(0);
    expect(tables.stories[0].user_id).toBeNull();
    // The step that failed left the row untouched.
    expect(tables.billing_orders[0].user_id).toBe(USER_ID);
    // auth.users is untouched, so a retry is still possible.

    const second = await deleteAccount({ userId: USER_ID, actor: 'user' });
    expect(second.ok).toBe(true);
    expect(tables.billing_orders[0].user_id).toBeNull();
    expect(tables.billing_orders[0].subject_ref).toBe(USER_ID);
    expect(tables.profiles).toHaveLength(0);

    const events = tables.account_deletion_events ?? [];
    expect(events).toHaveLength(2);
    expect(events[0].status).toBe('failed');
    expect(events[1].status).toBe('completed');
  });

  it('treats a call against an already-deleted account as a clean no-op success', async () => {
    const { client, tables } = createFakeAdmin(
      { profiles: [] },
      { authUserExists: false }
    );
    adminState.client = client;

    const outcome = await deleteAccount({ userId: USER_ID, actor: 'user' });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.alreadyDeleted).toBe(true);
    }
    expect(tables.account_deletion_events ?? []).toHaveLength(0);
  });
});
