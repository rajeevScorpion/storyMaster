import Link from 'next/link';
import { Info } from 'lucide-react';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import ReviewQueue from '@/components/admin/agentic/ReviewQueue';
import { getReviewQueueSchemaStatusAction, listReviewQueueAction } from '@/app/actions/agentic-review';
import { getAgenticFlags } from '@/lib/agentic/flags';
import { requireReviewer } from '@/lib/agentic/reviewers';
import { canPublish } from '@/lib/agentic/reviewers.shared';

export const dynamic = 'force-dynamic';

export default async function AuthorsReviewQueuePage() {
  const flags = await getAgenticFlags();

  // D8: fail closed, and honestly -- no 404, no throw, and no fetch at all
  // while the flag is off. Checking here, before either read action runs, is
  // what makes "no fetch while off" literally true rather than fetching and
  // then hiding the result.
  if (!flags.reviewerWorkflowEnabled) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <AdminPageHeader
          title="Review queue"
          description="Agent drafts waiting on a human, joined to their story and their latest evaluation."
        />
        <section className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm text-neutral-300">
          <Info size={18} className="mt-0.5 shrink-0 text-neutral-500" />
          <p>
            The reviewer workflow is switched off. Turn on &ldquo;Reviewer workflow&rdquo; on the{' '}
            <Link href="/admin/agents" className="text-emerald-300 underline underline-offset-2 hover:text-emerald-200">
              Agents Overview
            </Link>{' '}
            page to see agent drafts waiting on review here.
          </p>
        </section>
      </div>
    );
  }

  const schemaStatus = await getReviewQueueSchemaStatusAction();
  const initialRows = schemaStatus.schemaApplied ? await listReviewQueueAction() : [];

  // Resolves the CURRENT session's own reviewer standing so ReviewQueue can render its
  // Publish action disabled (not hidden -- see that component's header) for a reviewer who
  // lacks can_publish. This is purely a UX affordance: publishRunAction re-checks
  // canPublish(reviewer) itself against a freshly-fetched row, so a stale value read here
  // (a capability revoked mid-session, say) can make the button look enabled when the write
  // would still be refused -- it can never make the write succeed when it shouldn't.
  // Wrapped in try/catch and defaulting to false: this page is already gated by
  // app/admin/layout.tsx's verifyAdmin(), and requireReviewer() treats ADMIN_USER_ID as an
  // implicit reviewer with every capability, so this should never throw for anyone who
  // reached this page today -- but a thrown error here must fail closed (no Publish button)
  // rather than 500 the whole queue.
  let canPublishDrafts = false;
  try {
    const { reviewer } = await requireReviewer();
    canPublishDrafts = canPublish(reviewer);
  } catch {
    canPublishDrafts = false;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminPageHeader
        title="Review queue"
        description="Every agent run sitting at stage 'awaiting_review', joined to its story, its latest evaluation, and any reviewer decision. Approve, reject, request-rewrite, and publish are all available below."
      />
      <ReviewQueue initialRows={initialRows} schemaApplied={schemaStatus.schemaApplied} canPublish={canPublishDrafts} />
    </div>
  );
}
