import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/pricing/enforcement', () => ({
  isAdminUserId: vi.fn(),
  resolveWatchQuotaPolicyForUser: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUserId, resolveWatchQuotaPolicyForUser } from '@/lib/pricing/enforcement';
import { consumeWatchSlot, resetWatchQuotaMissingRpcLatchForTests } from './watch-quota';

const isAdminUserIdMock = vi.mocked(isAdminUserId);
const resolveWatchQuotaPolicyForUserMock = vi.mocked(resolveWatchQuotaPolicyForUser);
const createAdminClientMock = vi.mocked(createAdminClient);

const USER_ID = 'user-1';
const STORYLINE_ID = 'storyline-1';

interface RpcResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

function stubSupabaseRpc(result: RpcResult) {
  const rpc = vi.fn().mockResolvedValue(result);
  createAdminClientMock.mockReturnValue({ rpc } as unknown as ReturnType<typeof createAdminClient>);
  return rpc;
}

describe('consumeWatchSlot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWatchQuotaMissingRpcLatchForTests();
    isAdminUserIdMock.mockReturnValue(false);
    resolveWatchQuotaPolicyForUserMock.mockResolvedValue({ unlimited: false, dailyQuota: 3 });
  });

  it('allows an admin account without consulting the capability or the RPC', async () => {
    isAdminUserIdMock.mockReturnValue(true);
    const rpc = stubSupabaseRpc({ data: null, error: null });

    const result = await consumeWatchSlot({ userId: USER_ID, storylineId: STORYLINE_ID });

    expect(result).toEqual({ allowed: true, used: 0, limit: 0, isReplay: false, unlimited: true });
    expect(resolveWatchQuotaPolicyForUserMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('allows a plan carrying the unlimitedWatching capability without calling the RPC', async () => {
    resolveWatchQuotaPolicyForUserMock.mockResolvedValue({ unlimited: true, dailyQuota: 0 });
    const rpc = stubSupabaseRpc({ data: null, error: null });

    const result = await consumeWatchSlot({ userId: USER_ID, storylineId: STORYLINE_ID });

    expect(result).toEqual({ allowed: true, used: 0, limit: 0, isReplay: false, unlimited: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('checks the admin bypass before the capability (cheapest, most permissive first)', async () => {
    isAdminUserIdMock.mockReturnValue(true);
    resolveWatchQuotaPolicyForUserMock.mockResolvedValue({ unlimited: false, dailyQuota: 3 });
    stubSupabaseRpc({ data: null, error: null });

    await consumeWatchSlot({ userId: USER_ID, storylineId: STORYLINE_ID });

    expect(resolveWatchQuotaPolicyForUserMock).not.toHaveBeenCalled();
  });

  it('is free and does not re-consume a slot on replay', async () => {
    const rpc = stubSupabaseRpc({ data: [{ allowed: true, used: 2, is_replay: true }], error: null });

    const result = await consumeWatchSlot({ userId: USER_ID, storylineId: STORYLINE_ID });

    expect(result).toEqual({ allowed: true, used: 2, limit: 3, isReplay: true, unlimited: false });
    expect(rpc).toHaveBeenCalledWith('consume_watch_slot', expect.objectContaining({
      p_user_id: USER_ID,
      p_storyline_id: STORYLINE_ID,
      p_limit: 3,
    }));
  });

  it('allows a new watch within the limit', async () => {
    stubSupabaseRpc({ data: [{ allowed: true, used: 3, is_replay: false }], error: null });

    const result = await consumeWatchSlot({ userId: USER_ID, storylineId: STORYLINE_ID });

    expect(result).toEqual({ allowed: true, used: 3, limit: 3, isReplay: false, unlimited: false });
  });

  it('refuses a new watch over the limit', async () => {
    stubSupabaseRpc({ data: [{ allowed: false, used: 3, is_replay: false }], error: null });

    const result = await consumeWatchSlot({ userId: USER_ID, storylineId: STORYLINE_ID });

    expect(result).toEqual({ allowed: false, used: 3, limit: 3, isReplay: false, unlimited: false });
  });

  it('allows the watch when the RPC itself is missing (42883), logging once', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubSupabaseRpc({ data: null, error: { code: '42883', message: 'function does not exist' } });

    const result = await consumeWatchSlot({ userId: USER_ID, storylineId: STORYLINE_ID });

    expect(result).toEqual({ allowed: true, used: 0, limit: 3, isReplay: false, unlimited: false });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('sends the admin-configured limit to the RPC, not a constant', () => {
    // Unit E made the number a pricing runtime setting. The old fallback constant is gone; if it
    // ever comes back, this is what notices.
    resolveWatchQuotaPolicyForUserMock.mockResolvedValue({ unlimited: false, dailyQuota: 7 });
    const rpc = stubSupabaseRpc({ data: [{ allowed: true, used: 1, is_replay: false }], error: null });

    return consumeWatchSlot({ userId: USER_ID, storylineId: STORYLINE_ID }).then((result) => {
      expect(rpc).toHaveBeenCalledWith('consume_watch_slot', expect.objectContaining({ p_limit: 7 }));
      expect(result.limit).toBe(7);
    });
  });

  it('treats a non-positive configured limit as unrestricted rather than a total block', async () => {
    // A 0 or a negative is what a misconfigured row looks like, not an admin asking for "no
    // watching at all". Refusing every reader on a bad setting is the worse failure.
    resolveWatchQuotaPolicyForUserMock.mockResolvedValue({ unlimited: false, dailyQuota: 0 });
    const rpc = stubSupabaseRpc({ data: null, error: null });

    const result = await consumeWatchSlot({ userId: USER_ID, storylineId: STORYLINE_ID });

    expect(result).toEqual({ allowed: true, used: 0, limit: 0, isReplay: false, unlimited: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('allows the watch when PostgREST cannot find the function (PGRST202)', async () => {
    stubSupabaseRpc({ data: null, error: { code: 'PGRST202', message: 'not found' } });

    const result = await consumeWatchSlot({ userId: USER_ID, storylineId: STORYLINE_ID });

    expect(result.allowed).toBe(true);
    expect(result.unlimited).toBe(false);
  });

  it('latches the missing-RPC allowance so a second call skips the RPC and does not log again', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rpc = stubSupabaseRpc({ data: null, error: { code: '42883', message: 'function does not exist' } });

    await consumeWatchSlot({ userId: USER_ID, storylineId: STORYLINE_ID });
    await consumeWatchSlot({ userId: USER_ID, storylineId: STORYLINE_ID });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('does not fail open on a real RPC error -- only the missing-function codes are special-cased', async () => {
    stubSupabaseRpc({ data: null, error: { code: '55P03', message: 'lock not available' } });

    await expect(consumeWatchSlot({ userId: USER_ID, storylineId: STORYLINE_ID })).rejects.toThrow(
      'consume_watch_slot failed'
    );
  });
});
