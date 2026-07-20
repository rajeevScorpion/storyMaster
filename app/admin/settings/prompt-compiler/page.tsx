import PromptCompilerSettingsPanel from '@/components/admin/PromptCompilerSettingsPanel';

export const dynamic = 'force-dynamic';

export default function PromptCompilerSettingsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-serif text-neutral-100">Image prompt compiler</h1>
        <p className="mt-1 text-sm text-neutral-400">
          JSON image prompt optimization: rollout mode, per-model capability status, and legacy-vs-compiled comparisons.
        </p>
      </div>
      <PromptCompilerSettingsPanel />
    </div>
  );
}
