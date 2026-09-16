import Link from 'next/link';
import { Info } from 'lucide-react';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import ReviewerWorkload from '@/components/admin/agentic/ReviewerWorkload';
import { getAgenticFlags } from '@/lib/agentic/flags';
import { getReviewerWorkloadReport } from '@/lib/agentic/review-workload';

export const dynamic = 'force-dynamic';

// ── Agentic Creator System: Phase 9c, Unit 9k ───────────────────────────
//
// Who has what on their desk: assigned, pending and completed per reviewer, plus what
// each one has personally decided. Reached only through app/admin/layout.tsx's
// verifyAdmin() gate, like every other page under /admin — this is the admin half of
// 9k, and the reviewer half (their own history) lives at /review/history instead.
//
// Flag check first and fail closed (D8), with no fetch at all while the reviewer
// workflow is off — the same shape app/review/page.tsx uses. Unlike that page, this one
// links to /admin/agents to turn the flag on, because whoever is reading this page can
// actually get there.
//
// There is deliberately no server action behind this page: it only reads, on the
// server, so there is no separately-invocable endpoint needing a gate of its own.
export default async function ReviewerWorkloadPage() {
  const flags = await getAgenticFlags();

  if (!flags.reviewerWorkflowEnabled) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <AdminPageHeader
          title="Reviewer workload"
          description="Assigned, pending and completed drafts per reviewer."
        />
        <section className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm text-neutral-300">
          <Info size={18} className="mt-0.5 shrink-0 text-neutral-500" />
          <p>
            The reviewer workflow is switched off, so nothing is being assigned. Turn on
            &ldquo;Reviewer workflow&rdquo; on the{' '}
            <Link href="/admin/agents" className="font-medium text-emerald-300 underline underline-offset-2 hover:text-emerald-200">
              Agents Overview
            </Link>{' '}
            page to start recording assignments.
          </p>
        </section>
      </div>
    );
  }

  const { report, rosterUnavailable } = await getReviewerWorkloadReport();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AdminPageHeader
        title="Reviewer workload"
        description="What is on each reviewer's desk right now, how much of it is still waiting, and what each of them has decided. Read-only — assignment itself happens in the review queue."
      />
      <ReviewerWorkload report={report} rosterUnavailable={rosterUnavailable} />
    </div>
  );
}
