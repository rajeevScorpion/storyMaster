import MediaPipelineSettingsPanel from '@/components/admin/MediaPipelineSettingsPanel';

export const dynamic = 'force-dynamic';

export default function MediaPipelineSettingsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-serif text-neutral-100">Media pipeline</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Server-side image processing mode, retention, variants, cleanup, publishing controls, and monitoring.
        </p>
      </div>
      <MediaPipelineSettingsPanel />
    </div>
  );
}
