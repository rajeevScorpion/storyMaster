import AdminPageHeader from '@/components/admin/AdminPageHeader';
import AdminPromotionalCohorts from '@/components/admin/users/AdminPromotionalCohorts';
import { getAdminPromotionalCohortRuns } from '@/app/actions/admin-users';

export const dynamic = 'force-dynamic';

export default async function AdminPromotionalCohortsPage() {
  const runs = await getAdminPromotionalCohortRuns();

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <AdminPageHeader
        title="Promotional cohorts"
        description="Preview transparent engagement rules, approve liability, and grant promotional coins once."
      />
      <AdminPromotionalCohorts initialRuns={runs} />
    </div>
  );
}
