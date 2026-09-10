import { ShieldAlert, UsersRound } from 'lucide-react';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { formatDateTime, shortId } from '@/components/admin/agentic/run-presentation';
import { getReviewerRosterSchemaStatusAction, listReviewersAction } from '@/app/actions/agentic-review';

export const dynamic = 'force-dynamic';

// Read-only roster of public.agent_reviewers (migration 111). There is no
// add/suspend/edit action on this page -- granting reviewer standing is not yet
// an admin-driven flow. Verified on dev (docs/agentic-creator-phase9-plan.md
// 1.7): migration 111 IS applied but the table holds zero rows, so the empty
// state below is the real, expected state today -- not a schema problem. That
// is still distinguished from the schema-not-applied case, because the two look
// identical from listReviewersAction() alone (both return []).
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
        ) : reviewers.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <UsersRound className="mx-auto h-8 w-8 text-neutral-700" />
            <p className="mt-3 text-sm text-neutral-400">No reviewers yet.</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-neutral-600">
              Migration 111 is applied but seeds no rows. process.env.ADMIN_USER_ID works as an implicit reviewer
              with every capability in the meantime — granting a real row here needs a future admin action that
              does not exist yet.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.12em] text-neutral-600">
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Display name</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Coverage</th>
                  <th className="px-4 py-3 font-medium">Added</th>
                </tr>
              </thead>
              <tbody>
                {reviewers.map((reviewer) => (
                  <tr key={reviewer.userId} className="border-b border-white/5">
                    <td className="px-4 py-4 font-mono text-xs text-neutral-400" title={reviewer.userId}>
                      {shortId(reviewer.userId)}
                    </td>
                    <td className="px-4 py-4 text-neutral-200">{reviewer.displayName ?? '—'}</td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                          reviewer.status === 'active'
                            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                            : 'border-neutral-500/25 bg-neutral-500/10 text-neutral-400'
                        }`}
                      >
                        {reviewer.status === 'active' ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-neutral-400">{reviewer.role === 'editor' ? 'Editor' : 'Reviewer'}</td>
                    <td className="px-4 py-4 text-neutral-500">
                      {reviewer.ageGroups.length === 0 && reviewer.languages.length === 0 && reviewer.genres.length === 0
                        ? '—'
                        : [...reviewer.languages, ...reviewer.ageGroups].join(', ') || '—'}
                    </td>
                    <td className="px-4 py-4 text-neutral-500">{formatDateTime(reviewer.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
