import AdminPageHeader from '@/components/admin/AdminPageHeader';
import OperationalPoliciesStudio from '@/components/admin/OperationalPoliciesStudio';
import { getOperationalPoliciesAdminState } from '@/app/actions/admin-policies';

export const dynamic = 'force-dynamic';

export default async function AdminPoliciesPage() {
  const initialState = await getOperationalPoliciesAdminState();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminPageHeader
        title="Operational policies"
        description="Store product decisions as versioned rules, see their enforcement points, and change them with a complete audit trail."
      />
      <OperationalPoliciesStudio initialState={initialState} />
    </div>
  );
}
