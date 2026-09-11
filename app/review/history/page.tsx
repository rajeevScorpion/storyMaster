import { Info } from 'lucide-react';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import ReviewHistory from '@/components/review/ReviewHistory';
import { getAgenticFlags } from '@/lib/agentic/flags';
import { getReviewHistoryForReviewer } from '@/lib/agentic/review-history';
import { requireReviewer } from '@/lib/agentic/reviewers';

export const dynamic = 'force-dynamic';

// ── Agentic Creator System: Phase 9c, Unit 9k ───────────────────────────
//
// The reviewer's own decision history, reached from the third item in
// components/review/ReviewSidebar.tsx. A separate route rather than another
// `?view=` on /review, because this reads a different table entirely
// (agent_review_decisions, 112) and shows finished work, not a queue.
//
// Same shape as app/review/page.tsx: the flag check comes FIRST and fails closed
// (D8) with no fetch at all while the reviewer workflow is off, then the data.
// requireReviewer() runs here too, even though app/review/layout.tsx already gated
// this route -- the userId it returns is what scopes the read, and it must come
// from the session, never from anything a client could supply.
//
// There is deliberately no server action behind this page: it only reads, on the
// server, so there is no separately-invocable endpoint needing a gate of its own.
export default async function ReviewHistoryPage() {
  const flags = await getAgenticFlags();

  if (!flags.reviewerWorkflowEnabled) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <AdminPageHeader title="My review history" description="Every decision you have recorded on an agent draft." />
        <section className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm text-neutral-300">
          <Info size={18} className="mt-0.5 shrink-0 text-neutral-500" />
          <p>
            The reviewer workflow is switched off. Ask an admin to turn on &ldquo;Reviewer
            workflow&rdquo; on the Agents Overview page to see your review history here.
          </p>
        </section>
      </div>
    );
  }

  const { userId } = await requireReviewer();
  const entries = await getReviewHistoryForReviewer(userId);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <AdminPageHeader
        title="My review history"
        description="Every decision you have recorded on an agent draft, newest first — what you decided, on which story, and any note you left with it."
      />
      <ReviewHistory entries={entries} />
    </div>
  );
}
