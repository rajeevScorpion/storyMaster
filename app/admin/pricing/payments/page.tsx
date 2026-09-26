import AdminPageHeader from '@/components/admin/AdminPageHeader';
import AdminPaymentsList from '@/components/admin/pricing/AdminPaymentsList';
import { getAdminPaymentsList } from '@/app/actions/admin-payments-list';

// Payments admin-wide list: the owner made a real test payment and couldn't find it anywhere in
// admin except the Billing section at the bottom of one user's record. This is the support
// entry point that starts from "a payment ID from Razorpay" or "someone's email" instead.
export const dynamic = 'force-dynamic';

export default async function AdminPaymentsPage() {
  const initialData = await getAdminPaymentsList({ page: 1 });

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <AdminPageHeader
        title="Payments"
        description="Every captured, failed, refunded, or disputed payment across every account, newest first. Read-only — refund, cancel, and re-sync actions live on the user's own Billing panel."
      />
      <AdminPaymentsList initialData={initialData} />
    </div>
  );
}
