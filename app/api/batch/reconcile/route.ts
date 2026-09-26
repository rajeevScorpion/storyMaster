import { NextResponse } from 'next/server';
import { reconcileActiveImageBatches } from '@/app/actions/image-batch';
import { reconcileActiveNarrationJobs } from '@/app/actions/narration-batch';
import { runImageGenerationJobs } from '@/lib/media/image-job-runner';
import { runReferenceAdoptionJobs } from '@/lib/references/adoption-job-runner';
import { cleanupExpiredOriginals } from '@/lib/media/cleanup';
import { cleanupAbandonedReferenceSetups } from '@/lib/references/reference-cleanup';
import { drainAgentRuns } from '@/lib/agentic/orchestrator';
import { getAgenticFlags } from '@/lib/agentic/flags';
import { reconcilePendingRefunds, reconcileRazorpayBilling } from '@/lib/billing/razorpay-reconcile';
import { sweepMissingReceiptJobs, sweepRenewalReminders } from '@/lib/billing/notifications/sweeps';
import { runBillingJobsOnce } from '@/lib/billing/notifications/runner';

// Reconciliation downloads + compresses images; give it room but stay bounded.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // If no secret is configured, only allow in non-production to avoid open access.
  if (!secret) return process.env.NODE_ENV !== 'production';
  const header = request.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

// This route is live, runs daily on Vercel's only cron, and already reconciles
// narration/image work real users depend on. Everything below is wrapped so an
// agentic failure -- a thrown error, a rejected promise, or a hang -- can NEVER
// stop that work from completing:
//   1. getAgenticFlags() itself already fails closed (fallback = false) if the
//      feature_flags read errors, so a flags-table problem just reads as "off".
//   2. The flag is read through getAgenticFlags() (never getFeatureFlag directly
//      for agentic keys), per lib/agentic/flags.ts's own contract.
//   3. drainAgentRuns() is raced against a hard timeout so a stuck drain (e.g. a
//      future Phase 6 stage executor that never resolves) can't hold up the
//      route past this budget -- the route moves on regardless of which side
//      of the race finished.
//   4. The whole thing sits behind one try/catch that swallows and logs
//      concisely; nothing here is allowed to reject the outer Promise.all.
// Deliberately independent of /api/agentic/run rather than calling it: this
// keeps the reconcile route's failure surface identical to today's (it never
// makes an outbound fetch to itself) and needs no CRON_SECRET round-trip.
const AGENTIC_DRAIN_TIMEOUT_MS = 30_000;

async function runAgenticSchedulerDrain(): Promise<{ processed: number }> {
  try {
    const flags = await getAgenticFlags();
    if (!flags.schedulerEnabled) return { processed: 0 };

    const timeout = new Promise<{ processed: number }>((resolve) => {
      setTimeout(() => resolve({ processed: 0 }), AGENTIC_DRAIN_TIMEOUT_MS);
    });
    const drain = drainAgentRuns().then((processed) => ({ processed }));
    return await Promise.race([drain, timeout]);
  } catch (error) {
    console.error('Agentic scheduler drain failed (reconcile continues regardless):', error instanceof Error ? error.message : error);
    return { processed: 0 };
  }
}

async function handle(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const [images, narration, imageJobs, adoptionJobs, agenticRuns, billingReconcile] = await Promise.all([
      reconcileActiveImageBatches(),
      reconcileActiveNarrationJobs().catch((error) => {
        console.error('Narration reconcile failed:', error instanceof Error ? error.message : error);
        return { processed: 0 };
      }),
      // Backstop for interactive server-pipeline jobs: reclaims stale claims
      // and drains pending work within its own time budget (self re-kicks).
      runImageGenerationJobs({}).catch((error) => {
        console.error('Image job reconcile failed:', error instanceof Error ? error.message : error);
        return { processed: 0, failed: 0, remaining: 0 };
      }),
      // Backstop for reference adoption jobs (reclaims stale + drains pending).
      runReferenceAdoptionJobs({}).catch((error) => {
        console.error('Reference adoption reconcile failed:', error instanceof Error ? error.message : error);
        return { processed: 0, failed: 0, remaining: 0 };
      }),
      // Agentic Creator System: drains the run queue when agentic_scheduler_enabled
      // is on. runAgenticSchedulerDrain() already never throws -- see its own
      // comment above -- this .catch is a deliberate second layer, not redundancy:
      // an agentic failure reaching this Promise.all must be structurally
      // impossible, not just unlikely.
      runAgenticSchedulerDrain().catch((error) => {
        console.error('Agentic scheduler drain rejected unexpectedly (reconcile continues regardless):', error instanceof Error ? error.message : error);
        return { processed: 0 };
      }),
      // Razorpay money backstop: gated behind billing_reconcile_enabled inside the function itself, so
      // this is a zero-result no-op until the owner turns it on. Never allowed to reach this Promise.all.
      reconcileRazorpayBilling().catch((error) => {
        console.error('Razorpay billing reconcile failed:', error instanceof Error ? error.message : error);
        return { checkouts: 0, subscriptions: 0, topups: 0, webhooks: 0 };
      }),
    ]);
    // Retention cleanup after the reconcile work (no-ops when disabled).
    const cleanup = await cleanupExpiredOriginals().catch((error) => {
      console.error('Retention cleanup failed:', error instanceof Error ? error.message : error);
      return { scanned: 0, deleted: 0, failed: 0 };
    });
    // Delete abandoned reference setups (uploads whose story was never created).
    const referenceCleanup = await cleanupAbandonedReferenceSetups().catch((error) => {
      console.error('Reference cleanup failed:', error instanceof Error ? error.message : error);
      return { setupsScanned: 0, sourcesDeleted: 0, adoptionsDeleted: 0, objectsDeleted: 0 };
    });
    // Payments Phase 6 (docs/payments/phase-6-plan.md §4 Unit A2): the pending-refund backstop, run
    // after everything above. Gated behind billing_reconcile_enabled inside the function itself, so
    // this is a zero-result no-op until the owner turns it on -- and, like billingReconcile above,
    // never allowed to reach (or fail) this route.
    const pendingRefundsProcessed = await reconcilePendingRefunds().catch((error) => {
      console.error('Pending refund reconcile failed:', error instanceof Error ? error.message : error);
      return 0;
    });
    // Payments Phase 6 (docs/payments/phase-6-plan.md §10, Unit C2, "Sweeps"): the notification-job
    // backstops, run after the money reconciles above -- each independently .catch-wrapped so one
    // failing (or the worker run after them) never fails this route or blocks the others. Both
    // sweeps are themselves best-effort (never throw), but this route must never depend on that.
    const missingReceiptJobsSwept = await sweepMissingReceiptJobs().catch((error) => {
      console.error('Missing-receipt sweep failed:', error instanceof Error ? error.message : error);
      return 0;
    });
    const renewalRemindersSwept = await sweepRenewalReminders().catch((error) => {
      console.error('Renewal-reminder sweep failed:', error instanceof Error ? error.message : error);
      return 0;
    });
    const billingJobsRun = await runBillingJobsOnce().catch((error) => {
      console.error('Billing notification job run failed:', error instanceof Error ? error.message : error);
      return { processed: 0, failed: 0, remaining: 0 };
    });
    return NextResponse.json({
      ok: true,
      ...images,
      narrationProcessed: narration.processed,
      imageJobsProcessed: imageJobs.processed,
      imageJobsRemaining: imageJobs.remaining,
      adoptionJobsProcessed: adoptionJobs.processed,
      adoptionJobsRemaining: adoptionJobs.remaining,
      agenticRunsProcessed: agenticRuns.processed,
      originalsDeleted: cleanup.deleted,
      referenceSourcesDeleted: referenceCleanup.sourcesDeleted,
      billingReconcile,
      pendingRefundsProcessed,
      missingReceiptJobsSwept,
      renewalRemindersSwept,
      billingJobsRun,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reconcile failed.';
    console.error('Image batch reconcile route failed:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// Vercel Cron issues GET requests with the CRON_SECRET bearer header.
export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

// Allow manual/authorized POST triggering (e.g. after a submit) as well.
export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
