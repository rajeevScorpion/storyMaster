import { notFound } from 'next/navigation';
import AdminUserDetail from '@/components/admin/users/AdminUserDetail';
import { getAdminUserDetail } from '@/app/actions/admin-users';
import { getBillingAdminActionsEnabled } from '@/app/actions/admin-billing-actions';

export const dynamic = 'force-dynamic';

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getAdminUserDetail(id);
  if (!detail) {
    notFound();
  }

  // Display-only read of the kill switch. A failure here (flag row or its migration missing) must
  // never blank the whole user record -- it degrades to the same "actions disabled" state the switch
  // itself produces when off. Every mutating action re-checks this server-side regardless.
  let billingActionsEnabled = false;
  try {
    billingActionsEnabled = await getBillingAdminActionsEnabled();
  } catch {
    billingActionsEnabled = false;
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <AdminUserDetail initialData={detail} billingActionsEnabled={billingActionsEnabled} />
    </div>
  );
}
