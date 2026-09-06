import AdminPageHeader from '@/components/admin/AdminPageHeader';
import AgenticOverview from '@/components/admin/agentic/AgenticOverview';
import { getAgenticFlags } from '@/lib/agentic/flags';

export const dynamic = 'force-dynamic';

export default async function AgenticAdminPage() {
  const initialFlags = await getAgenticFlags();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AdminPageHeader
        title="Agentic Creator System"
        description="Feature flags for autonomous story creation. Nothing here generates a story yet — this is the kill switch and its subordinate gates."
      />
      <AgenticOverview initialFlags={initialFlags} />
    </div>
  );
}
