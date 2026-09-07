import AdminPageHeader from '@/components/admin/AdminPageHeader';
import RunMonitor from '@/components/admin/agentic/RunMonitor';
import { listRunsAction, getRunSchemaStatusAction } from '@/app/actions/agentic-runs';
import { getAgenticFlags } from '@/lib/agentic/flags';

export const dynamic = 'force-dynamic';

export default async function AgenticRunsPage() {
  const [schemaStatus, flags] = await Promise.all([getRunSchemaStatusAction(), getAgenticFlags()]);

  const initialRuns = schemaStatus.schemaApplied ? await listRunsAction() : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminPageHeader
        title="Run monitor"
        description="Execution runs for commissioned tasks: stage progress, checkpoints, retries, and a manual worker kick. Story generation itself doesn't exist yet (Phase 6) -- every run today defers on its first content-generation stage rather than completing."
      />
      <RunMonitor initialRuns={initialRuns} schemaApplied={schemaStatus.schemaApplied} creatorEnabled={flags.creatorEnabled} />
    </div>
  );
}
