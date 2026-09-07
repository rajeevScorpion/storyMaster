import AdminPageHeader from '@/components/admin/AdminPageHeader';
import TestLab from '@/components/admin/agentic/TestLab';
import { listTestLabPersonasAction } from '@/app/actions/agentic-test-lab';
import { getAgenticFlags } from '@/lib/agentic/flags';

export const dynamic = 'force-dynamic';

// startTestLabRunAction / continueTestLabRunAction each drive the real headless
// pipeline through roughly 2N+2 sequential paid Gemini calls (lib/agentic/test-lab.ts),
// and a server action invoked from this page inherits this segment's duration budget.
// Each individual pass is itself capped at ~20s by RUN_TIME_BUDGET_MS -- see
// TestLab.tsx's auto-continue loop -- but a slower model, a cold path, or a persona at
// the top of its beat-count range is worth budgeting generously for, so one action call
// is never at risk of a platform-level 504 that would read as a pipeline bug rather than
// what it actually is (a timeout on the surrounding Next/Vercel request).
export const maxDuration = 300;

export default async function TestLabPage() {
  const [personas, flags] = await Promise.all([
    // listTestLabPersonas() already fails closed to [] when migration 103 is missing
    // (see lib/agentic/test-lab.ts), but the .catch here means an unexpected error of
    // any other kind still degrades to the same "no personas" empty state instead of
    // taking the whole page down -- this route must never 500 just because a persona
    // list failed to load.
    listTestLabPersonasAction().catch(() => []),
    getAgenticFlags(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminPageHeader
        title="Persona Test Lab"
        description="Run the real headless story pipeline against one persona with agent_tasks.is_test = true, and inspect everything it produced before anything is written to agent_story_memory or reaches the gallery."
      />
      <TestLab initialPersonas={personas} creatorEnabled={flags.creatorEnabled} />
    </div>
  );
}
