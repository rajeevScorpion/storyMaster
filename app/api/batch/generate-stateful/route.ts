import { NextResponse, after } from 'next/server';
import { runStatefulImageJob } from '@/app/actions/image-batch';

// Sequential stateful image generation is chatty (many chained provider calls);
// give it the full budget but stay bounded — the worker re-kicks itself if needed.
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
  const jobId = typeof body?.jobId === 'string' ? body.jobId : null;
  if (!jobId) {
    return NextResponse.json({ ok: false, error: 'Missing jobId.' }, { status: 400 });
  }

  // Run the job AFTER the response is flushed. The generation loop can take
  // minutes; awaiting it here would hold the connection open until it finished,
  // which trips the caller's fetch headers timeout (UND_ERR_HEADERS_TIMEOUT) and
  // makes the "kick" look failed. `after()` keeps the work alive on the standalone
  // Node/Cloud Run process past the 202 while headers go out immediately.
  after(async () => {
    try {
      await runStatefulImageJob(jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stateful job failed.';
      console.error('Stateful worker job failed:', message);
    }
  });

  return NextResponse.json({ ok: true, jobId, accepted: true }, { status: 202 });
}
