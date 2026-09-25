'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { requestAccountDeletion } from '@/app/actions/account';
import { startNavigationProgress } from '@/lib/navigation/progress';

const CONFIRMATION_PHRASE = 'DELETE MY ACCOUNT';

export default function DeleteAccountForm() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    return (
      <p className="text-sm text-neutral-400">
        Sign in first, then come back to this page to delete your account.
      </p>
    );
  }

  const hasPasswordIdentity = (user.identities ?? []).some((identity) => identity.provider === 'email');
  const confirmationMatches = confirmation.trim().toUpperCase() === CONFIRMATION_PHRASE;
  const canSubmit = confirmationMatches && (!hasPasswordIdentity || password.length > 0) && !busy;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);

    const result = await requestAccountDeletion({
      confirmation,
      password: hasPasswordIdentity ? password : null,
    });

    if (!result.ok) {
      setError(result.error ?? 'Something went wrong. Please try again.');
      setBusy(false);
      return;
    }

    startNavigationProgress();
    // The account no longer exists server-side -- this only clears the local
    // session cookies, the same as a normal sign-out.
    await signOut();
    router.replace('/signed-out');
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {hasPasswordIdentity && (
        <div>
          <label htmlFor="delete-account-password" className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-neutral-500">
            Confirm your password
          </label>
          <input
            id="delete-account-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-rose-500/40 focus:outline-none focus:ring-2 focus:ring-rose-500/20 disabled:opacity-50"
            placeholder="Your current password"
          />
        </div>
      )}

      {!hasPasswordIdentity && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          You signed in with Google, so there is no password to confirm. If you signed in more than 15 minutes ago,
          sign out and back in with Google first, then return to this page.
        </p>
      )}

      <div>
        <label htmlFor="delete-account-confirmation" className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-neutral-500">
          Type <span className="font-mono text-neutral-300">{CONFIRMATION_PHRASE}</span> to confirm
        </label>
        <input
          id="delete-account-confirmation"
          type="text"
          autoComplete="off"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          disabled={busy}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-rose-500/40 focus:outline-none focus:ring-2 focus:ring-rose-500/20 disabled:opacity-50"
          placeholder={CONFIRMATION_PHRASE}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-rose-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
        Permanently delete my account
      </button>
    </form>
  );
}
