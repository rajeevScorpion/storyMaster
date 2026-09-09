import Link from 'next/link';
import { Info } from 'lucide-react';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import ReviewQueue from '@/components/admin/agentic/ReviewQueue';
import { getReviewQueueSchemaStatusAction, listReviewQueueAction } from '@/app/actions/agentic-review';
import { getAgenticFlags } from '@/lib/agentic/flags';

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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminPageHeader
        title="Review queue"
        description="Every agent run sitting at stage 'awaiting_review', joined to its story, its latest evaluation, and any reviewer decision. Approve, reject, and request-rewrite are available below; publishing an approved draft is a separate step (Unit 9e-ii) and is not built yet."
      />
      <ReviewQueue initialRows={initialRows} schemaApplied={schemaStatus.schemaApplied} />
    </div>
  );
}
