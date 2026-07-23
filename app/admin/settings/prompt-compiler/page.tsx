import PromptCompilerSettingsPanel from '@/components/admin/PromptCompilerSettingsPanel';
import AdminPageHeader from '@/components/admin/AdminPageHeader';

export const dynamic = 'force-dynamic';

export default function PromptCompilerSettingsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AdminPageHeader
        title="Image prompt compiler"
        description="JSON image prompt optimization: rollout mode, per-model capability status, and legacy-vs-compiled comparisons."
      />
      <PromptCompilerSettingsPanel />
    </div>
  );
}
