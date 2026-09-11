import { Info, Users } from 'lucide-react';
import type { ReviewerWorkloadReport } from '@/lib/agentic/review-workload.shared';

// ── Agentic Creator System: Unit 9k — reviewer workload, read-only ───────
//
// A server component on purpose, for the same reason PersonaSpend is one: it renders
// numbers and nothing else, so there is nothing for a client bundle to do, and a page
// with no locale-formatted values on it cannot reproduce the hydration class of bug
// that locale-aware formatting caused on the review queue. Nothing here is a date.
//
// It shows display_name, role and status only. It must never render the roster's
// `notes` column — admin-only commentary written ABOUT a reviewer, which the data
// module deliberately does not even select (245588e).
//
// The three counts are easy to misread, so the legend under the table states what each
// one means rather than leaving a reader to guess. See review-workload.shared.ts for
// the precise definitions the arithmetic actually implements.

const ROLE_STYLES: Record<string, string> = {
  editor: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300',
  reviewer: 'border-white/10 bg-white/5 text-neutral-400',
};

export default function ReviewerWorkload({
  report,
  rosterUnavailable,
}: {
  report: ReviewerWorkloadReport;
  rosterUnavailable: boolean;
}) {
  if (rosterUnavailable) {
    return (
      <section className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm text-neutral-300">
        <Info size={18} className="mt-0.5 shrink-0 text-neutral-500" />
        <p>
          The reviewer roster does not exist on this database yet, so there is no workload to
          report. This is the expected state anywhere the agentic migrations have not been
          applied.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-4">
        <SummaryCard label="On reviewers' desks" value={report.totalAssigned} hint="Active assignments" />
        <SummaryCard label="Still waiting" value={report.totalPending} hint="Assigned, not yet decided" />
        <SummaryCard label="Decided" value={report.totalCompleted} hint="Assigned and decided" />
        <SummaryCard label="Unassigned" value={report.unassigned} hint="Nobody is on these" />
      </section>

      {report.offRoster > 0 && (
        <section className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100">
          <Info size={18} className="mt-0.5 shrink-0" />
          <p>
            {report.offRoster} {report.offRoster === 1 ? 'assignment points' : 'assignments point'} at an
            account that is no longer on the reviewer roster. That work is on nobody&rsquo;s desk in
            practice &mdash; reassign it from the review queue.
          </p>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
        <table className="w-full text-sm">
          <thead className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-neutral-500">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Reviewer</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Assigned</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Pending</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Completed</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Decisions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {report.reviewers.map((row) => (
              <tr key={row.userId} className="align-top transition-colors hover:bg-white/[0.02]">
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-neutral-100">
                      {row.displayName ?? <span className="font-mono text-neutral-400">{row.userId.slice(0, 8)}</span>}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                        ROLE_STYLES[row.role] ?? ROLE_STYLES.reviewer
                      }`}
                    >
                      {row.role}
                    </span>
                    {row.status !== 'active' && (
                      <span className="inline-flex items-center rounded-full border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-300">
                        {row.status}
                      </span>
                    )}
                  </div>
                  {row.decisions > 0 && (
                    <div className="mt-1 text-xs text-neutral-500">
                      {(['approved', 'rewrite_requested', 'rejected', 'published'] as const)
                        .filter((kind) => row.decisionsByKind[kind] > 0)
                        .map((kind) => `${DECISION_WORD[kind]} ${row.decisionsByKind[kind]}`)
                        .join(' · ')}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-300">{row.assigned}</td>
                <td
                  className={`px-4 py-3 text-right tabular-nums ${
                    row.pending > 0 ? 'font-medium text-amber-300' : 'text-neutral-500'
                  }`}
                >
                  {row.pending}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-300">{row.completed}</td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-emerald-300">{row.decisions}</td>
              </tr>
            ))}
            {report.reviewers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                  <Users size={20} className="mx-auto mb-2 text-neutral-600" />
                  Nobody has reviewer standing yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="space-y-1.5 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-xs leading-relaxed text-neutral-500">
        <p>
          <span className="text-neutral-300">Assigned</span> is what is on a reviewer&rsquo;s desk right
          now, not a career total &mdash; a released or reassigned draft leaves this count.
        </p>
        <p>
          <span className="text-neutral-300">Completed</span> is how many of those have a decision
          recorded against them, by anyone. Assignment is advisory: nothing stops another reviewer
          deciding a draft sitting on this one&rsquo;s desk, and it would be wrong to credit that here.
        </p>
        <p>
          <span className="text-neutral-300">Decisions</span> is what this reviewer personally
          recorded, all time, whether or not the draft was ever assigned to them. It can differ from
          Completed in both directions, and that is the honest number for &ldquo;what has this person
          actually done&rdquo;.
        </p>
      </div>
    </div>
  );
}

const DECISION_WORD = {
  approved: 'approved',
  rewrite_requested: 'rewrites',
  rejected: 'rejected',
  published: 'published',
} as const;

function SummaryCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="text-xs uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-medium tabular-nums text-neutral-100">{value}</div>
      <div className="mt-0.5 text-xs text-neutral-500">{hint}</div>
    </div>
  );
}
