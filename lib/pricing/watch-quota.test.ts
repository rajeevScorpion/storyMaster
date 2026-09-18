import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/pricing/enforcement', () => ({
  isAdminUserId: vi.fn(),
  resolveUnlimitedWatchingForUser: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminUserId, resolveUnlimitedWatchingForUser } from '@/lib/pricing/enforcement';
import { consumeWatchSlot, resetWatchQuotaMissingRpcLatchForTests } from './watch-quota';

const isAdminUserIdMock = vi.mocked(isAdminUserId);
const resolveUnlimitedWatchingForUserMock = vi.mocked(resolveUnlimitedWatchingForUser);
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
    resolveUnlimitedWatchingForUserMock.mockResolvedValue(false);
  });

  it('allows an admin account without consulting the capability or the RPC', async () => {
    isAdminUserIdMock.mockReturnValue(true);
    const rpc = stubSupabaseRpc({ data: null, error: null });

    const result = await consumeWatchSlot({ userId: USER_ID, storylineId: STORYLINE_ID });

    expect(result).toEqual({ allowed: true, used: 0, limit: 0, isReplay: false, unlimited: true });
    expect(resolveUnlimitedWatchingForUserMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('allows a plan carrying the unlimitedWatching capability without calling the RPC', async () => {
    resolveUnlimitedWatchingForUserMock.mockResolvedValue(true);
    const rpc = stubSupabaseRpc({ data: null, error: null });

    const result = await consumeWatchSlot({ userId: USER_ID, storylineId: STORYLINE_ID });

    expect(result).toEqual({ allowed: true, used: 0, limit: 0, isReplay: false, unlimited: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('checks the admin bypass before the capability (cheapest, most permissive first)', async () => {
    isAdminUserIdMock.mockReturnValue(true);
    resolveUnlimitedWatchingForUserMock.mockResolvedValue(false);
    stubSupabaseRpc({ data: null, error: null });

    await consumeWatchSlot({ userId: USER_ID, storylineId: STORYLINE_ID });

    expect(resolveUnlimitedWatchingForUserMock).not.toHaveBeenCalled();
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
