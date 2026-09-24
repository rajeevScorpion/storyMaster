import { NextResponse, after } from 'next/server';
import { runBillingJobsOnce } from '@/lib/billing/notifications/runner';

/**
 * Payments Phase 6 (docs/payments/phase-6-plan.md §4 Unit C1): the billing job worker route.
 * Modelled on app/api/media/jobs/run/route.ts -- bearer CRON_SECRET auth, an immediate 202, and the
 * actual claim/process loop inside after() so the caller (Vercel Cron, or queue.ts's own kick) never
 * waits on it. GET exists for Vercel Cron (which issues GET with the bearer header); POST covers
 * queue.ts's self-kick and any manual trigger.
 */
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // If no secret is configured, only allow in non-production to avoid open access.
  if (!secret) return process.env.NODE_ENV !== 'production';
  const header = request.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

async function handle(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  after(async () => {
    try {
      const result = await runBillingJobsOnce();
      if (
        process.env.NEXT_PUBLIC_LOG_TIMING === '1' &&
        (result.processed > 0 || result.failed > 0 || result.remaining > 0)
      ) {
        console.log(
          `Billing job worker: processed=${result.processed} failed=${result.failed} remaining=${result.remaining}`
        );
      }
    } catch (error) {
      console.error('Billing job worker failed:', error instanceof Error ? error.stack ?? error.message : error);
    }
  });

  return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}

// Vercel Cron issues GET requests with the CRON_SECRET bearer header.
export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

// queue.ts's self-kick, and any manual/authorized trigger, use POST.
export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
