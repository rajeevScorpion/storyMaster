import Link from 'next/link';
import { ShieldOff, CheckCircle2, XCircle } from 'lucide-react';
import DeleteAccountForm from '@/components/account/DeleteAccountForm';

export const dynamic = 'force-dynamic';

export default function DeleteAccountPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 py-16 text-neutral-100">
      <section className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/15 text-rose-300">
          <ShieldOff className="h-6 w-6" />
        </span>
        <p className="mt-6 text-xs uppercase tracking-[0.2em] text-neutral-500">Account</p>
        <h1 className="mt-2 text-3xl font-serif">Delete your account</h1>
        <p className="mt-4 text-sm leading-6 text-neutral-400">
          This ends your access to Kissago. Read what happens before you confirm below.
        </p>

        <div className="mt-6 space-y-3">
          <div className="flex items-start gap-3 rounded-2xl border border-rose-500/15 bg-rose-500/5 px-4 py-3">
            <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-300" />
            <p className="text-sm leading-6 text-neutral-300">
              Your access ends immediately and your login is freed for a fresh sign-up. Your profile, private
              stories in progress, saved and liked storylines, viewing history, presets and settings are deleted.
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-300" />
            <p className="text-sm leading-6 text-neutral-300">
              Stories you already published stay visible in the gallery, still credited to the same author name.
              Deleting your account removes your access to Kissago, not the work you shared with readers.
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <ShieldOff className="mt-0.5 h-4 w-4 flex-shrink-0 text-neutral-400" />
            <p className="text-sm leading-6 text-neutral-300">
              Billing records (orders, subscriptions, payments) are kept for 8 years, as Indian tax law requires,
              with your name and contact details removed from them.
            </p>
          </div>
        </div>

        <p className="mt-6 text-xs text-neutral-500">This cannot be undone. There is no recovery window.</p>

        <div className="mt-6 border-t border-white/10 pt-6">
          <DeleteAccountForm />
        </div>

        <p className="mt-6 text-center text-xs text-neutral-500">
          Changed your mind? <Link href="/" className="text-neutral-300 underline hover:text-neutral-100">Go back home</Link>.
        </p>
      </section>
    </main>
  );
}
