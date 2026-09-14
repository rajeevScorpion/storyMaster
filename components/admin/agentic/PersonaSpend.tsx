import { Info, Coins } from 'lucide-react';
import type { PersonaSpendReport } from '@/lib/agentic/persona-spend.shared';

// ── Agentic Creator System: persona spend, read-only ─────────────────────
//
// A server component on purpose: it only renders numbers, so there is nothing for a
// client bundle to do, and rendering on the server alone sidesteps the hydration class
// of bug that locale-aware formatting caused on the review queue. Numbers are formatted
// by hand here for the same reason -- no toLocaleString.

/** Groups digits without toLocaleString, which can differ between server and browser. */
function formatNumber(value: number): string {
  const fixed = Number.isInteger(value) ? String(value) : value.toFixed(2);
  const [whole, fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** 'batch_image_generation' -> 'Batch image generation'. */
function formatActionKey(actionKey: string): string {
  const words = actionKey.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : actionKey;
}

export default function PersonaSpend({
  report,
  unavailable,
}: {
  report: PersonaSpendReport | null;
  unavailable: 'schema_missing' | 'no_agentic_account' | null;
}) {
  if (unavailable || !report) {
    return (
      <section className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm text-neutral-300">
        <Info size={18} className="mt-0.5 shrink-0 text-neutral-500" />
        <p>
          {unavailable === 'no_agentic_account'
            ? 'No agentic account is configured in this environment, so there is no agent spend to report.'
            : 'The agentic tables are not present on this database yet, so there is no agent spend to report.'}
        </p>
      </section>
    );
  }

  const spenders = report.personas.filter((persona) => persona.operations > 0);
  const idle = report.personas.length - spenders.length;

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Spent by all personas"
          value={`${formatNumber(report.totalCoins)} coins`}
          hint={`${formatNumber(report.totalBeats)} beats`}
        />
        <SummaryCard
          label="Chargeable operations"
          value={formatNumber(report.totalOperations)}
          hint={`${formatNumber(spenders.length)} of ${formatNumber(report.personas.length)} personas have spent`}
        />
        <SummaryCard
          label="Never actually deducted"
          value={`${formatNumber(report.bypassedBeats)} beats`}
          hint={report.bypassedBeats > 0 ? 'Agent billing bypass is on' : 'Everything above was charged'}
        />
      </section>

      {report.unattributedBeats > 0 && (
        <section className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100">
          <Info size={18} className="mt-0.5 shrink-0" />
          <p>
            {formatNumber(report.unattributedBeats)} beats across{' '}
            {formatNumber(report.unattributedOperations)} operations could not be traced back to a
            persona &mdash; the story they were charged against is missing, or was not written by an
            agent. They are counted in the totals above but in no persona&rsquo;s row below.
          </p>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
        <table className="w-full text-sm">
          <thead className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-neutral-500">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Persona</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Stories</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Operations</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Coins</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {spenders.map((persona) => (
              <tr key={persona.personaId} className="align-top transition-colors hover:bg-white/[0.02]">
                <td className="px-4 py-3">
                  <div className="font-medium text-neutral-100">{persona.displayName}</div>
                  {persona.byAction.length > 0 && (
                    <div className="mt-1 text-xs text-neutral-500">
                      {persona.byAction
                        .map((action) => `${formatActionKey(action.actionKey)} ${formatNumber(action.beats)}`)
                        .join(' · ')}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                  {formatNumber(persona.storiesCharged)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                  {formatNumber(persona.operations)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-emerald-300">
                  {formatNumber(persona.coins)}
                  <div className="text-xs font-normal text-neutral-500">
                    {formatNumber(persona.beats)} beats
                  </div>
                </td>
              </tr>
            ))}
            {spenders.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-neutral-500">
                  <Coins size={20} className="mx-auto mb-2 text-neutral-600" />
                  No persona has spent anything yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {idle > 0 && spenders.length > 0 && (
        <p className="text-xs text-neutral-500">
          {formatNumber(idle)} {idle === 1 ? 'persona has' : 'personas have'} not spent anything yet
          and {idle === 1 ? 'is' : 'are'} not listed.
        </p>
      )}
    </div>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="text-xs uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-medium tabular-nums text-neutral-100">{value}</div>
      <div className="mt-0.5 text-xs text-neutral-500">{hint}</div>
    </div>
  );
}
