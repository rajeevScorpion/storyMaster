import BillingAccountPage from '@/components/billing/BillingAccountPage';

export const dynamic = 'force-dynamic';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit F): a thin server shell -- the signed-out
 * state and every data fetch live in BillingAccountPage itself, same as how WalletPage already
 * degrades per-section rather than gating the whole route server-side.
 */
export default function AccountBillingPage() {
  return <BillingAccountPage />;
}
