import AdminPageHeader from '@/components/admin/AdminPageHeader';
import OperationalFlagsPanel from '@/components/admin/OperationalFlagsPanel';
import { findSettingsNavItem } from '@/lib/admin/nav';

export const dynamic = 'force-dynamic';

export default function BillingOperationsSettingsPage() {
  const meta = findSettingsNavItem('billing-operations');

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <AdminPageHeader title={meta?.label ?? 'Billing operations'} description={meta?.description} />
      </div>
      <OperationalFlagsPanel />
    </div>
  );
}
