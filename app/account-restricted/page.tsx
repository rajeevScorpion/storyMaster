import { redirect } from 'next/navigation';
import { Clock3, ShieldAlert } from 'lucide-react';
import RestrictedAccountActions from '@/components/auth/RestrictedAccountActions';
import { getEffectiveUserModeration } from '@/lib/admin/user-moderation';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function formatSuspensionEnd(value: string): string {
  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

export default async function AccountRestrictedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/signed-out');
  }

  const moderation = await getEffectiveUserModeration(user.id);
  if (moderation.status === 'active') {
    redirect('/');
  }

  const suspended = moderation.status === 'suspended';

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 py-12 text-neutral-100">
      <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl backdrop-blur-xl">
        <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${
          suspended ? 'bg-amber-500/15 text-amber-300' : 'bg-rose-500/15 text-rose-300'
        }`}>
          {suspended ? <Clock3 className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
        </span>
        <p className="mt-6 text-xs uppercase tracking-[0.2em] text-neutral-500">
          Account access
        </p>
        <h1 className="mt-2 text-3xl font-serif">
          {suspended ? 'Your account is temporarily suspended' : 'Your account is blocked'}
        </h1>
        <p className="mt-4 text-sm leading-6 text-neutral-400">
          {suspended && moderation.suspendedUntil
            ? `Access will automatically resume after ${formatSuspensionEnd(moderation.suspendedUntil)}.`
            : 'Access remains unavailable until the account is reviewed by the Kissago team.'}
        </p>
        <p className="mt-2 text-sm text-neutral-500">
          If you believe this is a mistake, contact Kissago support from another account.
        </p>
        <div className="mt-7">
          <RestrictedAccountActions />
        </div>
      </section>
    </main>
  );
}
