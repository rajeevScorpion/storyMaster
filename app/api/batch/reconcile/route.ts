import { NextResponse } from 'next/server';
import { reconcileActiveImageBatches } from '@/app/actions/image-batch';

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

async function handle(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await reconcileActiveImageBatches();
    return NextResponse.json({ ok: true, ...result });
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
