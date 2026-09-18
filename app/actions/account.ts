'use server';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { verifyAdmin } from '@/lib/supabase/admin';
import { deleteAccount } from '@/lib/account/deletion';
import { getFeatureFlag } from '@/lib/ai/model-config';

export interface AccountDeletionActionResult {
  ok: boolean;
  error?: string;
}

const CONFIRMATION_PHRASE = 'DELETE MY ACCOUNT';
const RECENT_SESSION_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_DELETION_FLAG_KEY = 'account_deletion_enabled';

/**
 * Payments Phase 2 plan §7 (never implemented until this review fix): self-serve deletion ships
 * behind a kill switch, off by default. Read the same way billing_reconcile_enabled is
 * (lib/billing/razorpay-reconcile.ts:39) -- fails closed (flag row absent or a read error both
 * resolve to "disabled") so an un-migrated feature_flags table never accidentally turns this on.
 * UserMenu calls this to decide whether to show the "Delete account" entry at all; requestAccountDeletion
 * below re-checks the same flag itself, since a server action is reachable regardless of what the UI shows.
 */
export async function getAccountDeletionEnabled(): Promise<boolean> {
  return getFeatureFlag(ACCOUNT_DELETION_FLAG_KEY, false);
}

/**
 * Self-serve deletion (Payments Phase 2 plan §4, Unit C). Requires a fresh proof
 * of identity before doing anything irreversible:
 *   - password accounts re-enter their password here, verified against a
 *     throwaway, session-less client so the caller's own session cookies are
 *     never touched by the check.
 *   - Google-only accounts have no password to re-check, so the safer signal
 *     available without a redirect-based re-auth flow is recency: Supabase's
 *     own `last_sign_in_at` must be within the last 15 minutes, or the request
 *     is refused and the caller is told to sign out and back in with Google.
 */
export async function requestAccountDeletion(input: {
  confirmation: string;
  password?: string | null;
}): Promise<AccountDeletionActionResult> {
  if (!(await getFeatureFlag(ACCOUNT_DELETION_FLAG_KEY, false))) {
    return {
      ok: false,
      error: 'Self-serve account deletion is not available right now. Contact support if you need your account removed.',
    };
  }

  if (String(input.confirmation ?? '').trim().toUpperCase() !== CONFIRMATION_PHRASE) {
    return { ok: false, error: `Type "${CONFIRMATION_PHRASE}" exactly to confirm.` };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user || !user.email) {
    return { ok: false, error: 'You need to be signed in to delete your account.' };
  }

  const hasPasswordIdentity = (user.identities ?? []).some((identity) => identity.provider === 'email');

  if (hasPasswordIdentity) {
    const password = String(input.password ?? '');
    if (!password) {
      return { ok: false, error: 'Enter your password to confirm.' };
    }
    const verified = await verifyPassword(user.email, password);
    if (!verified) {
      return { ok: false, error: 'Incorrect password.' };
    }
  } else {
    const lastSignInAt = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : NaN;
    if (!Number.isFinite(lastSignInAt) || Date.now() - lastSignInAt > RECENT_SESSION_WINDOW_MS) {
      return {
        ok: false,
        error: 'For your security, sign out and sign back in with Google, then try again within 15 minutes.',
      };
    }
  }

  const outcome = await deleteAccount({ userId: user.id, actor: 'user' });
  if (!outcome.ok) {
    return {
      ok: false,
      error:
        'Something went wrong partway through and your account was not fully deleted. Retrying is safe and picks up where it left off -- please try again, or contact support if it keeps failing.',
    };
  }

  return { ok: true };
}

/**
 * Admin-initiated equivalent, guarded the same way as every other admin action
 * in app/actions/admin-users.ts: verifyAdmin() plus the same self-protection
 * check updateAdminUserModeration uses.
 */
export async function adminDeleteAccount(input: {
  userId: string;
  reason: string;
}): Promise<AccountDeletionActionResult> {
  const { user: actor } = await verifyAdmin();
  const userId = String(input.userId ?? '').trim();
  if (!userId) {
    return { ok: false, error: 'A target account is required.' };
  }
  if (userId === actor.id || userId === process.env.ADMIN_USER_ID) {
    return { ok: false, error: 'The configured administrator account cannot be deleted from here.' };
  }

  const reason = String(input.reason ?? '').trim();
  if (reason.length < 3) {
    return { ok: false, error: 'A reason of at least 3 characters is required.' };
  }

  const outcome = await deleteAccount({ userId, actor: 'admin', reason });
  if (!outcome.ok) {
    return { ok: false, error: `Deletion failed: ${outcome.reason}` };
  }
  return { ok: true };
}

async function verifyPassword(email: string, password: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;

  // Session-less on purpose: this must never touch the caller's own cookies,
  // it only needs to know whether Supabase accepts the password.
  const probe = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await probe.auth.signInWithPassword({ email, password });
  return !error;
}
