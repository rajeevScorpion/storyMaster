import AdminPageHeader from '@/components/admin/AdminPageHeader';
import ReviewQueue from '@/components/admin/agentic/ReviewQueue';
import {
  getReviewQueueSchemaStatusAction,
  listReviewQueueAction,
  type ReviewQueueListFilters,
} from '@/app/actions/agentic-review';
import { getAgenticFlags } from '@/lib/agentic/flags';
import { requireReviewer } from '@/lib/agentic/reviewers';
import { canAssignWork, canPublish } from '@/lib/agentic/reviewers.shared';
import { Info } from 'lucide-react';

export const dynamic = 'force-dynamic';

// Unit 9L: app/review/layout.tsx's "My assignments" sidebar link navigates here
// with `?assignment=mine` -- there is no separate route for it, so this page
// reads the query param itself and both (a) fetches initialRows already
// filtered server-side, so the first paint matches the sidebar link the reviewer
// just clicked, and (b) seeds ReviewQueue's dropdown to match. 'unassigned' is
// accepted too even though the sidebar does not link to it today, since it is
// already a value ReviewQueueListFilters.assignment understands -- no reason to
// silently drop a URL a reviewer might type or bookmark by hand.
function parseAssignmentParam(value: string | string[] | undefined): 'mine' | 'unassigned' | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'mine' || raw === 'unassigned' ? raw : undefined;
}

interface ReviewQueuePageProps {
  searchParams: Promise<{ assignment?: string | string[] }>;
}

// ── Agentic Creator System: Phase 9b, Unit 9h ───────────────────────────
//
// The reviewer-facing home for the review queue, reached through
// app/review/layout.tsx's requireReviewer() gate instead of
// app/admin/layout.tsx's verifyAdmin(). Per
// docs/agentic-creator-phase9b-plan.md section 4.2, this is deliberately the
// SAME body as app/admin/authors/page.tsx: flag check first (fail closed, no
// fetch at all while the flag is off), then schema status, then rows, then
// canPublish resolved from requireReviewer(). It renders the exact same
// ReviewQueue component -- no fork, no second copy of it.
//
// The duplication between this file and app/admin/authors/page.tsx is
// intentional, not an oversight: the two pages are reached through different
// gates and must never silently drift in what they show an editor-role
// reviewer, so a future change to one is a visible diff to carry over to the
// other rather than an invisible shared-helper edit. If a third such page
// ever appears, that would be the signal to extract one.
//
// One deliberate difference from admin/authors/page.tsx's disabled-flag
// copy: it links to /admin/agents to turn the flag on. A reviewer reaching
// THIS page is, by construction, not staff and cannot reach /admin/agents
// (verifyAdmin() would bar them) -- so this copy tells them to ask an admin
// instead of linking somewhere they cannot go.
export default async function ReviewQueuePage({ searchParams }: ReviewQueuePageProps) {
  const params = await searchParams;
  const assignmentFilter = parseAssignmentParam(params.assignment);

  const flags = await getAgenticFlags();

  // D8: fail closed, and honestly -- no 404, no throw, and no fetch at all
  // while the flag is off.
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
            The reviewer workflow is switched off. Ask an admin to turn on &ldquo;Reviewer
            workflow&rdquo; on the Agents Overview page to see agent drafts waiting on review here.
          </p>
        </section>
      </div>
    );
  }

  const schemaStatus = await getReviewQueueSchemaStatusAction();
  const listFilters: ReviewQueueListFilters = assignmentFilter ? { assignment: assignmentFilter } : {};
  const initialRows = schemaStatus.schemaApplied ? await listReviewQueueAction(listFilters) : [];

  // Resolves the CURRENT session's own reviewer standing so ReviewQueue can render its
  // Publish action disabled (not hidden) for a reviewer who lacks the editor role. See
  // app/admin/authors/page.tsx's identical block for the full reasoning -- this page is
  // already gated by app/review/layout.tsx's requireReviewer(), so this call should never
  // throw for anyone who reached this page today, but a thrown error here must still fail
  // closed (no Publish button) rather than 500 the whole queue.
  let canPublishDrafts = false;
  let canAssign = false;
  try {
    const { reviewer } = await requireReviewer();
    canPublishDrafts = canPublish(reviewer);
    canAssign = canAssignWork(reviewer);
  } catch {
    canPublishDrafts = false;
    canAssign = false;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminPageHeader
        title="Review queue"
        description="Every agent run sitting at stage 'awaiting_review', joined to its story, its latest evaluation, and any reviewer decision. Approve, reject, request-rewrite, and publish are all available below."
      />
      <ReviewQueue
        initialRows={initialRows}
        schemaApplied={schemaStatus.schemaApplied}
        canPublish={canPublishDrafts}
        canAssignWork={canAssign}
        initialAssignmentFilter={assignmentFilter}
      />
    </div>
  );
}
