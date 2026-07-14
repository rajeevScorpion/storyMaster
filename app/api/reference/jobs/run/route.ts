import { NextResponse, after } from 'next/server';
import { runReferenceAdoptionJobs } from '@/lib/references/adoption-job-runner';

// Adoption jobs chain a vision analysis call + an image generation call + sharp
// + R2 uploads; give the route the full budget but stay bounded — the runner
// re-kicks itself.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // If no secret is configured, only allow in non-production to avoid open access.
  if (!secret) return process.env.NODE_ENV !== 'production';
  const header = request.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const jobId = typeof body?.jobId === 'string' ? body.jobId : undefined;

  // Flush 202 immediately and run the claim loop in after() — same pattern as
  // /api/media/jobs/run (holding the connection open would trip the kicker's
  // fetch timeout).
  after(async () => {
    try {
      const result = await runReferenceAdoptionJobs({ jobId });
      if (result.processed > 0 || result.failed > 0 || result.remaining > 0) {
        console.log(
          `Reference adoption worker: processed=${result.processed} failed=${result.failed} remaining=${result.remaining}`
        );
      }
    } catch (error) {
      console.error('Reference adoption worker failed:', error instanceof Error ? error.stack ?? error.message : error);
    }
  });

  return NextResponse.json({ ok: true, accepted: true, jobId: jobId ?? null }, { status: 202 });
}
