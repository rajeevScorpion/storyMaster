import { NextResponse } from 'next/server';
import { reconcileActiveImageBatches } from '@/app/actions/image-batch';
import { reconcileActiveNarrationJobs } from '@/app/actions/narration-batch';
import { runImageGenerationJobs } from '@/lib/media/image-job-runner';
import { runReferenceAdoptionJobs } from '@/lib/references/adoption-job-runner';
import { cleanupExpiredOriginals } from '@/lib/media/cleanup';
import { cleanupAbandonedReferenceSetups } from '@/lib/references/reference-cleanup';

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
    const [images, narration, imageJobs, adoptionJobs] = await Promise.all([
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
    return NextResponse.json({
      ok: true,
      ...images,
      narrationProcessed: narration.processed,
      imageJobsProcessed: imageJobs.processed,
      imageJobsRemaining: imageJobs.remaining,
      adoptionJobsProcessed: adoptionJobs.processed,
      adoptionJobsRemaining: adoptionJobs.remaining,
      originalsDeleted: cleanup.deleted,
      referenceSourcesDeleted: referenceCleanup.sourcesDeleted,
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
