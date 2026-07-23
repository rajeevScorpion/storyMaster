import MediaPipelineSettingsPanel from '@/components/admin/MediaPipelineSettingsPanel';
import AdminPageHeader from '@/components/admin/AdminPageHeader';

export const dynamic = 'force-dynamic';

export default function MediaPipelineSettingsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AdminPageHeader
        title="Media pipeline"
        description="Server-side image processing mode, retention, variants, cleanup, publishing controls, and monitoring."
      />
      <MediaPipelineSettingsPanel />
    </div>
  );
}
