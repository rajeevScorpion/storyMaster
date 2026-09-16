import { ShieldAlert, UsersRound } from 'lucide-react';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import ReviewerRosterEditor from '@/components/admin/agentic/ReviewerRosterEditor';
import { getReviewerRosterSchemaStatusAction, listReviewersAction } from '@/app/actions/agentic-review';

export const dynamic = 'force-dynamic';

// Roster of public.agent_reviewers (migration 111). Unit 9g (Phase 9b) adds the
// actual grant/edit/suspend flow -- ReviewerRosterEditor below owns all of it
// (search-to-grant, the role/coverage drawer, and the table's row actions) as
// one client component, fed the initial rows fetched here. This page stays a
// server component and keeps ONLY the schema-status fetch and the
// "migration not applied at all" banner -- that branch is deliberately left
// exactly as it always has been: migration 111 IS applied on dev but not on
// production (docs/agentic-creator-phase9-plan.md 1.7), and the two states
// (table missing vs. table applied but genuinely empty) look identical from
// listReviewersAction() alone, which is why getReviewerRosterSchemaStatusAction
// exists as a separate probe.
export default async function ReviewerRosterPage() {
  const schemaStatus = await getReviewerRosterSchemaStatusAction();
  const reviewers = schemaStatus.schemaApplied ? await listReviewersAction() : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <AdminPageHeader
        title="Reviewers"
        description="Accounts with reviewer standing on agent-authored drafts (public.agent_reviewers, migration 111)."
      />

      <section className="rounded-2xl border border-white/10 bg-white/[0.035]">
        <div className="flex items-center gap-2 border-b border-white/10 p-4">
          <UsersRound className="h-4 w-4 text-emerald-300" />
          <h2 className="text-sm font-semibold text-neutral-100">Reviewer roster</h2>
        </div>

        {!schemaStatus.schemaApplied ? (
          <div className="flex gap-4 p-5">
            <ShieldAlert size={22} className="mt-0.5 shrink-0 text-amber-300" />
            <div className="space-y-1 text-sm text-neutral-200">
              <p className="font-medium text-amber-200">Migration 111 has not been applied to this environment yet.</p>
              <p className="text-neutral-300">
                The agent_reviewers table doesn&rsquo;t exist here. process.env.ADMIN_USER_ID still works as an
                implicit reviewer with every capability regardless (see requireReviewer() in
                lib/agentic/reviewers.ts) — but no other account can be granted reviewer standing until
                111_agent_reviewers.sql is applied.
              </p>
            </div>
          </div>
        ) : (
          <ReviewerRosterEditor initialReviewers={reviewers} />
        )}
      </section>
    </div>
  );
}
