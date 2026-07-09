import { NextResponse, after } from 'next/server';
import { runNarrationJob } from '@/app/actions/narration-batch';

// Sequential narration is chatty (TTS + forced-alignment per beat); give it the
// full budget but stay bounded — the worker re-kicks itself if beats remain.
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
  // minutes; awaiting it here would hold the connection open and trip the
  // caller's fetch headers timeout. `after()` keeps the work alive on the
  // standalone Node/Cloud Run process past the 202.
  after(async () => {
    try {
      await runNarrationJob(jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Narration job failed.';
      console.error('Narration worker job failed:', message);
    }
  });

  return NextResponse.json({ ok: true, jobId, accepted: true }, { status: 202 });
}
