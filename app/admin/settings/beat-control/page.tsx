import BeatControlSettingsPanel from '@/components/admin/BeatControlSettingsPanel';
import AdminPageHeader from '@/components/admin/AdminPageHeader';

export const dynamic = 'force-dynamic';

export default function BeatControlSettingsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AdminPageHeader
        title="Beat control"
        description="Beat text editing, timeline rewrite protection, image/narration/options regeneration, custom options, and image version history."
      />
      <BeatControlSettingsPanel />
    </div>
  );
}
