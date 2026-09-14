import { NextResponse, after } from 'next/server';
import { drainAgentRuns } from '@/lib/agentic/orchestrator';

// A drain pass claims and advances agent_runs rows; give the route the same
// generous ceiling the other worker routes use, even though drainAgentRuns's
// own RUN_TIME_BUDGET_MS keeps any single pass well under it.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Copied verbatim from app/api/batch/reconcile/route.ts:13 -- do not invent a
// different auth check for a worker route in this codebase.
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // If no secret is configured, only allow in non-production to avoid open access.
  if (!secret) return process.env.NODE_ENV !== 'production';
  const header = request.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

/**
 * CRON_SECRET-guarded worker for the Agentic Creator System's run queue.
 * Two callers: the admin "Run now" button (kickAgenticWorker in
 * app/actions/agentic-runs.ts) and, once agentic_scheduler_enabled is on, the
 * daily /api/batch/reconcile tick (see the comment at that call site for why
 * the two are kept independent rather than one calling the other).
 *
 * Returns 202 immediately and drains in after() -- same pattern as
 * /api/media/jobs/run: holding the connection open while a drain pass runs
 * would trip the kicker's own short fetch timeout.
 *
 * No flag check here on purpose: drainAgentRuns() already returns 0 without
 * touching agent_runs/agent_run_events when agentic_creator_enabled is off
 * (see its doc comment in lib/agentic/orchestrator.ts). Duplicating that
 * check here would just be a second place for the two to drift apart.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  after(async () => {
    try {
      const processed = await drainAgentRuns();
      if (processed > 0) {
        console.log(`Agentic run worker: processed=${processed}`);
      }
    } catch (error) {
      console.error('Agentic run worker failed:', error instanceof Error ? error.stack ?? error.message : error);
    }
  });

  return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}
