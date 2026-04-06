'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import KissagoLogo from '@/components/ui/KissagoLogo';

export default function UpdatePasswordPage() {
  const router = useRouter();
  const { user, isLoading, updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isRecoveryReady = useMemo(() => !isLoading && !!user, [isLoading, user]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (password.length < 8) {
      setError('Use at least 8 characters for your new password.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    const result = await updatePassword(password);
    if (result.error) {
      setError(result.error);
      setIsSubmitting(false);
      return;
    }

    setMessage(result.message ?? 'Password updated successfully.');
    setIsSubmitting(false);
    window.setTimeout(() => router.replace('/'), 1200);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-neutral-950 text-neutral-200">
      <div className="absolute inset-0 z-0">
        <div className="absolute left-10 top-10 h-56 w-56 rounded-full bg-emerald-900/20 blur-3xl" />
        <div className="absolute bottom-10 right-10 h-56 w-56 rounded-full bg-indigo-900/20 blur-3xl" />
      </div>

      <header className="relative z-10 p-4 md:p-6">
        <KissagoLogo fixed={false} />
      </header>

      <main className="relative z-10 flex min-h-[calc(100vh-88px)] items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-neutral-900/70 p-8 shadow-2xl backdrop-blur-xl">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.18em] text-emerald-300">Password recovery</p>
            <h1 className="text-3xl font-serif text-neutral-100">Set a new password</h1>
            <p className="text-sm leading-relaxed text-neutral-400">
              Choose a fresh password for your Kissago account and you will be sent back home.
            </p>
          </div>

          <div className="mt-6">
            {isLoading ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-neutral-400">
                Preparing your recovery session...
              </div>
            ) : !isRecoveryReady ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  This recovery link is not active right now. Try the reset flow again from the sign-in dialog.
                </div>
                <Link
                  href="/"
                  className="inline-flex rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-neutral-200 transition-colors hover:bg-white/10"
                >
                  Back to home
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="new-password" className="text-xs uppercase tracking-[0.16em] text-neutral-500">
                    New password
                  </label>
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <KeyRound className="h-4 w-4 text-neutral-500" />
                    <input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="w-full bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
                      placeholder="At least 8 characters"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="confirm-new-password" className="text-xs uppercase tracking-[0.16em] text-neutral-500">
                    Confirm new password
                  </label>
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <KeyRound className="h-4 w-4 text-neutral-500" />
                    <input
                      id="confirm-new-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      className="w-full bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
                      placeholder="Repeat your password"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                {error && (
                  <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                )}

                {message && (
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                    {message}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full rounded-2xl bg-white px-4 py-3.5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? 'Updating password...' : 'Save new password'}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
