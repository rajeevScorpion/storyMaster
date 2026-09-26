// Payments Phase 3, Unit B (docs/payments/phase-3-plan.md §5, B4): loadStorylineWithBeats is the
// single enforcement point for the Free daily watch quota, and a refusal must leave it as a
// RETURNED value. It shipped as a thrown Error carrying a marker string, which works on a local
// dev server and fails on every deployed build -- Next.js redacts a thrown server action's message
// to a generic string plus a digest (GOTCHAS.md, "Browser callers get gateway failures as data"),
// so the caller's marker match misses and its generic catch leaves a cached copy of the story on
// screen: the reader watches the story the server just refused, with no visible error.
//
// These tests pin the channel, not the copy. The `rejects` assertions matter as much as the
// `resolves` one: the day someone "tidies" this back into a throw, that is the test that fails.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/pricing/watch-quota', () => ({
  consumeWatchSlot: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { consumeWatchSlot } from '@/lib/pricing/watch-quota';
import { loadStorylineWithBeats } from '@/app/actions/exploration';

const createClientMock = vi.mocked(createClient);
const consumeWatchSlotMock = vi.mocked(consumeWatchSlot);

const USER_ID = 'user-1';
const STORYLINE_ID = 'storyline-1';

/** Enough of the server client for the auth guard and the storyline fetch that follows it. A
 * `maybeSingle` of null is "no such storyline", which is the throwing path the refusal must stay
 * distinguishable from. */
function stubServerClient(options: { user: { id: string } | null }) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.user },
        error: options.user ? null : { message: 'no session' },
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
    })),
  };
  createClientMock.mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
  return client;
}

describe('loadStorylineWithBeats — watch quota refusal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeWatchSlotMock.mockResolvedValue({
      allowed: true,
      used: 1,
      limit: 3,
      isReplay: false,
      unlimited: false,
    });
  });

  it('returns the refusal as data instead of throwing', async () => {
    stubServerClient({ user: { id: USER_ID } });
    consumeWatchSlotMock.mockResolvedValue({
      allowed: false,
      used: 3,
      limit: 3,
      isReplay: false,
      unlimited: false,
    });

    await expect(loadStorylineWithBeats(STORYLINE_ID)).resolves.toEqual({
      status: 'watch_quota_exhausted',
    });
  });

  it('does not fetch the storyline once the quota has refused the watch', async () => {
    const client = stubServerClient({ user: { id: USER_ID } });
    consumeWatchSlotMock.mockResolvedValue({
      allowed: false,
      used: 3,
      limit: 3,
      isReplay: false,
      unlimited: false,
    });

    await loadStorylineWithBeats(STORYLINE_ID);

    // A refused watch costs one indexed query, not the whole payload (§5, B4).
    expect(client.from).not.toHaveBeenCalled();
  });

  it('checks authentication before the quota, so a signed-out caller still throws', async () => {
    stubServerClient({ user: null });

    await expect(loadStorylineWithBeats(STORYLINE_ID)).rejects.toThrow('Not authenticated');
    expect(consumeWatchSlotMock).not.toHaveBeenCalled();
  });

  it('still throws for a missing storyline, which is a different channel from a refusal', async () => {
    stubServerClient({ user: { id: USER_ID } });

    await expect(loadStorylineWithBeats(STORYLINE_ID)).rejects.toThrow('Storyline not found');
  });

  it('spends a slot against the storyline actually being loaded', async () => {
    stubServerClient({ user: { id: USER_ID } });

    await expect(loadStorylineWithBeats(STORYLINE_ID)).rejects.toThrow('Storyline not found');
    expect(consumeWatchSlotMock).toHaveBeenCalledWith({
      userId: USER_ID,
      storylineId: STORYLINE_ID,
    });
  });
});
