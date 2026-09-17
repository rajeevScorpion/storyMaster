// Payments Phase 2, Unit C: app/actions/account.ts is the re-authentication and
// authorization gate in front of lib/account/deletion.ts's irreversible work.
// These tests mock deleteAccount() itself (its own behaviour is covered in
// lib/account/deletion.test.ts) and prove the gate: confirmation phrase,
// password re-entry for password accounts, a recent-session check for
// Google-only accounts, and the admin equivalent's guardrails.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  verifyAdmin: vi.fn(),
}));

vi.mock('@/lib/account/deletion', () => ({
  deleteAccount: vi.fn(),
}));

const signInWithPasswordMock = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { signInWithPassword: signInWithPasswordMock },
  })),
}));

import { createClient } from '@/lib/supabase/server';
import { verifyAdmin } from '@/lib/supabase/admin';
import { deleteAccount } from '@/lib/account/deletion';
import { requestAccountDeletion, adminDeleteAccount } from '@/app/actions/account';

const createClientMock = vi.mocked(createClient);
const verifyAdminMock = vi.mocked(verifyAdmin);
const deleteAccountMock = vi.mocked(deleteAccount);

const CONFIRMATION = 'DELETE MY ACCOUNT';
const USER_ID = 'user-1';

function passwordUser(overrides: Partial<{ last_sign_in_at: string }> = {}) {
  return {
    id: USER_ID,
    email: 'alice@example.com',
    identities: [{ provider: 'email' }],
    last_sign_in_at: new Date().toISOString(),
    ...overrides,
  };
}

function googleOnlyUser(lastSignInAt: string) {
  return {
    id: USER_ID,
    email: 'alice@example.com',
    identities: [{ provider: 'google' }],
    last_sign_in_at: lastSignInAt,
  };
}

function mockSignedInAs(user: unknown) {
  createClientMock.mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user }, error: null }) },
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  deleteAccountMock.mockResolvedValue({
    ok: true,
    alreadyDeleted: false,
    eventId: 'event-1',
    removedSummary: {},
    retainedSummary: {},
  });
});

describe('requestAccountDeletion -- confirmation and session gates', () => {
  it('refuses a wrong confirmation phrase without ever checking the session', async () => {
    const result = await requestAccountDeletion({ confirmation: 'delete my account please' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain(CONFIRMATION);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(deleteAccountMock).not.toHaveBeenCalled();
  });

  it('refuses when there is no signed-in user', async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
    } as any);

    const result = await requestAccountDeletion({ confirmation: CONFIRMATION });

    expect(result.ok).toBe(false);
    expect(deleteAccountMock).not.toHaveBeenCalled();
  });
});

describe('requestAccountDeletion -- password accounts', () => {
  it('refuses with no password entered', async () => {
    mockSignedInAs(passwordUser());

    const result = await requestAccountDeletion({ confirmation: CONFIRMATION });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/password/i);
    expect(deleteAccountMock).not.toHaveBeenCalled();
  });

  it('refuses an incorrect password without deleting anything', async () => {
    mockSignedInAs(passwordUser());
    signInWithPasswordMock.mockResolvedValue({ error: { message: 'Invalid login credentials' } });

    const result = await requestAccountDeletion({ confirmation: CONFIRMATION, password: 'wrong' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Incorrect password.');
    expect(deleteAccountMock).not.toHaveBeenCalled();
  });

  it('deletes the account once the password verifies', async () => {
    mockSignedInAs(passwordUser());
    signInWithPasswordMock.mockResolvedValue({ error: null });

    const result = await requestAccountDeletion({ confirmation: CONFIRMATION, password: 'correct-horse' });

    expect(result.ok).toBe(true);
    expect(deleteAccountMock).toHaveBeenCalledWith({ userId: USER_ID, actor: 'user' });
  });
});

describe('requestAccountDeletion -- Google-only accounts', () => {
  it('refuses a stale session and never deletes', async () => {
    const staleSignIn = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    mockSignedInAs(googleOnlyUser(staleSignIn));

    const result = await requestAccountDeletion({ confirmation: CONFIRMATION });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/sign out and sign back in/i);
    expect(deleteAccountMock).not.toHaveBeenCalled();
  });

  it('proceeds on a recent session', async () => {
    const recentSignIn = new Date(Date.now() - 60 * 1000).toISOString(); // 1 minute ago
    mockSignedInAs(googleOnlyUser(recentSignIn));

    const result = await requestAccountDeletion({ confirmation: CONFIRMATION });

    expect(result.ok).toBe(true);
    expect(deleteAccountMock).toHaveBeenCalledWith({ userId: USER_ID, actor: 'user' });
  });
});

describe('requestAccountDeletion -- deletion failure', () => {
  it('reports a safe, retry-friendly message without leaking the internal reason', async () => {
    mockSignedInAs(passwordUser());
    signInWithPasswordMock.mockResolvedValue({ error: null });
    deleteAccountMock.mockResolvedValue({ ok: false, reason: 'some internal database detail' });

    const result = await requestAccountDeletion({ confirmation: CONFIRMATION, password: 'correct-horse' });

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('some internal database detail');
    expect(result.error).toMatch(/try again/i);
  });
});

describe('adminDeleteAccount', () => {
  beforeEach(() => {
    verifyAdminMock.mockResolvedValue({ user: { id: 'admin-1' } } as any);
    delete process.env.ADMIN_USER_ID;
  });

  it('refuses to target the acting admin', async () => {
    const result = await adminDeleteAccount({ userId: 'admin-1', reason: 'testing' });

    expect(result.ok).toBe(false);
    expect(deleteAccountMock).not.toHaveBeenCalled();
  });

  it('refuses to target the configured ADMIN_USER_ID', async () => {
    process.env.ADMIN_USER_ID = 'configured-admin';

    const result = await adminDeleteAccount({ userId: 'configured-admin', reason: 'testing' });

    expect(result.ok).toBe(false);
    expect(deleteAccountMock).not.toHaveBeenCalled();
  });

  it('requires a reason of at least 3 characters', async () => {
    const result = await adminDeleteAccount({ userId: 'target-1', reason: 'ab' });

    expect(result.ok).toBe(false);
    expect(deleteAccountMock).not.toHaveBeenCalled();
  });

  it('deletes the target account with actor "admin"', async () => {
    const result = await adminDeleteAccount({ userId: 'target-1', reason: 'requested by support ticket #4' });

    expect(result.ok).toBe(true);
    expect(deleteAccountMock).toHaveBeenCalledWith({
      userId: 'target-1',
      actor: 'admin',
      reason: 'requested by support ticket #4',
    });
  });
});
