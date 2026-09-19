'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';

import AdminToggle from '@/components/admin/AdminToggle';
import { getOperationalFlags, setOperationalFlag } from '@/app/actions/operational-flags';
import {
  OPERATIONAL_FLAG_DEFINITIONS,
  OPERATIONAL_FLAG_GROUP_LABELS,
  type OperationalFlagDefinition,
} from '@/lib/admin/operational-flags.shared';

/**
 * The switches for the plain `feature_flags` rows that had no UI at all before this — chiefly the
 * account-deletion kill switch and the payment reconciliation backstop, both of which were previously
 * flipped by hand in the Supabase dashboard.
 *
 * Each row states what being on and being off actually mean rather than leaving an admin to infer it
 * from the flag key, because two of these three decide whether people's money and accounts are
 * touched.
 */
export default function OperationalFlagsPanel() {
  const [flags, setFlags] = useState<Record<string, boolean> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setFlags(await getOperationalFlags());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load flags');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(async (flag: OperationalFlagDefinition, next: boolean) => {
    setSavingKey(flag.key);
    setSaveError(null);
    try {
      setFlags(await setOperationalFlag(flag.key, next));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : `Failed to update ${flag.label}`);
      // The server is the authority on what actually landed -- never leave the switch showing a
      // state the database may not have.
      void load();
    } finally {
      setSavingKey(null);
    }
  }, [load]);

  if (loadError) {
    return (
      <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
        Failed to load operational flags - {loadError}. Try refreshing the page.
      </div>
    );
  }

  if (!flags) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading flags...
      </div>
    );
  }

  const groups = Array.from(new Set(OPERATIONAL_FLAG_DEFINITIONS.map((flag) => flag.group)));

  return (
    <div className="space-y-6">
      {saveError && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      {groups.map((group) => (
        <section key={group} className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-6">
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-neutral-500">
            {OPERATIONAL_FLAG_GROUP_LABELS[group]}
          </h2>

          <div className="mt-4 space-y-3">
            {OPERATIONAL_FLAG_DEFINITIONS.filter((flag) => flag.group === group).map((flag) => {
              const enabled = flags[flag.key] ?? flag.defaultEnabled;
              const busy = savingKey === flag.key;

              return (
                <div
                  key={flag.key}
                  className="rounded-xl border border-white/10 bg-neutral-900/60 px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm text-neutral-100">{flag.label}</p>
                      <p className="mt-1 text-sm text-neutral-400">{flag.description}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {busy && <Loader2 className="h-4 w-4 animate-spin text-neutral-500" />}
                      <AdminToggle
                        checked={enabled}
                        disabled={busy}
                        ariaLabel={flag.label}
                        onToggle={() => void toggle(flag, !enabled)}
                      />
                    </div>
                  </div>

                  <p className={`mt-3 text-xs leading-5 ${enabled ? 'text-emerald-300/80' : 'text-neutral-500'}`}>
                    {enabled ? flag.enabledHelp : flag.disabledHelp}
                  </p>

                  {/* Shown only while the flag is off, which is exactly when someone is about to
                      turn it on. Once it is on the step has either happened or been skipped, and a
                      standing reminder would just become furniture. */}
                  {!enabled && flag.beforeEnabling && (
                    <p className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs leading-5 text-amber-200/90">
                      <span className="font-medium">Before you turn this on: </span>
                      {flag.beforeEnabling}
                    </p>
                  )}

                  <p className="mt-2 font-mono text-[11px] text-neutral-600">{flag.key}</p>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <p className="text-xs text-neutral-500">
        A change can take up to a minute to reach every running server, which caches these for 60 seconds.
      </p>
    </div>
  );
}
